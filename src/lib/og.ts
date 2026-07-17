import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import type { CanvasKit, FontMgr } from "canvaskit-wasm";
import { ICONS } from "./icons";
import { siteConfig } from "./seo";

// Custom OG card renderer (CanvasKit, same engine astro-og-canvas uses).
// Layout: brand header pinned top-left on every card, title + description
// anchored to the bottom-left. astro-og-canvas can't do this — it clamps
// all text to the top of the card and has no text-brand slot.

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 64;
const BORDER_WIDTH = 2;
const TEXT_WIDTH = 1000;

const BG: RGB = [10, 10, 10];
const BORDER: RGB = [38, 38, 38];
const WHITE: RGB = [250, 250, 250];
const MUTED: RGB = [163, 163, 163];

const FAMILY = ["Inter Variable"];
// CanvasKit can't read woff2, so OG cards use raw TTF Inter instances.
const FONT_FILES = ["./src/assets/fonts/Inter-400.ttf", "./src/assets/fonts/Inter-600.ttf"];

type RGB = [number, number, number];

const { resolve } = createRequire(import.meta.url);

let engine: Promise<{ ck: CanvasKit; fontMgr: FontMgr }> | undefined;

function getEngine() {
	engine ??= (async () => {
		const { default: init } = await import("canvaskit-wasm/full");
		const ck = await init({
			locateFile: (file) => resolve(`canvaskit-wasm/bin/full/${file}`),
		});
		const fontData = await Promise.all(
			FONT_FILES.map(async (file) => new Uint8Array(await fs.readFile(file)).buffer),
		);
		const fontMgr = ck.FontMgr.FromData(...fontData);
		if (!fontMgr) throw new Error("Failed to load OG card fonts.");
		return { ck, fontMgr };
	})();
	return engine;
}

export async function renderOgImage(page: { title: string; description?: string }) {
	const { ck, fontMgr } = await getEngine();

	const surface = ck.MakeSurface(WIDTH, HEIGHT);
	if (!surface) throw new Error("Failed to create OG card surface.");
	const canvas = surface.getCanvas();

	const bgPaint = new ck.Paint();
	bgPaint.setColor(ck.Color(...BG));
	canvas.drawRect(ck.XYWHRect(0, 0, WIDTH, HEIGHT), bgPaint);

	const borderPaint = new ck.Paint();
	borderPaint.setColor(ck.Color(...BORDER));
	canvas.drawRect(ck.XYWHRect(0, 0, BORDER_WIDTH, HEIGHT), borderPaint);

	const left = PADDING + BORDER_WIDTH;

	const textStyle = (color: RGB, size: number, semibold: boolean, lineHeight: number) => ({
		color: ck.Color(...color),
		fontFamilies: FAMILY,
		fontSize: size,
		fontStyle: { weight: semibold ? ck.FontWeight.SemiBold : ck.FontWeight.Normal },
		heightMultiplier: lineHeight,
	});

	// Brand header, identical on every card: sparkles mark (same SVG paths as
	// the sidebar icon, 16px grid) followed by the site name and tagline.
	const iconSize = 38;
	const iconScale = iconSize / 16;
	const iconPaint = new ck.Paint();
	iconPaint.setColor(ck.Color(...WHITE));
	iconPaint.setAntiAlias(true);
	canvas.save();
	canvas.translate(left, PADDING - 1);
	canvas.scale(iconScale, iconScale);
	for (const [, d] of ICONS.sparkles.matchAll(/d="([^"]+)"/g)) {
		const path = ck.Path.MakeFromSVGString(d);
		if (!path) continue;
		canvas.drawPath(path, iconPaint);
		path.delete();
	}
	canvas.restore();

	const brandBuilder = ck.ParagraphBuilder.Make(
		new ck.ParagraphStyle({ textAlign: ck.TextAlign.Left, textStyle: textStyle(WHITE, 30, true, 1.2) }),
		fontMgr,
	);
	brandBuilder.addText(siteConfig.name);
	brandBuilder.pushStyle(new ck.TextStyle(textStyle(MUTED, 30, false, 1.2)));
	brandBuilder.addText(`  ·  ${siteConfig.tagline}`);
	const brand = brandBuilder.build();
	brand.layout(TEXT_WIDTH);
	canvas.drawParagraph(brand, left + iconSize + 16, PADDING);

	// Title + description block, anchored to the bottom of the card.
	const bodyBuilder = ck.ParagraphBuilder.Make(
		new ck.ParagraphStyle({ textAlign: ck.TextAlign.Left, textStyle: textStyle(WHITE, 76, true, 1.1) }),
		fontMgr,
	);
	bodyBuilder.addText(page.title);
	if (page.description) {
		bodyBuilder.pushStyle(new ck.TextStyle({ fontSize: 26, heightMultiplier: 1 }));
		bodyBuilder.addText("\n\n");
		bodyBuilder.pushStyle(new ck.TextStyle(textStyle(MUTED, 33, false, 1.45)));
		bodyBuilder.addText(page.description);
	}
	const body = bodyBuilder.build();
	body.layout(TEXT_WIDTH);
	const bodyTop = Math.max(PADDING + brand.getHeight() + 48, HEIGHT - PADDING - body.getHeight());
	canvas.drawParagraph(body, left, bodyTop);

	const image = surface.makeImageSnapshot();
	const bytes = image.encodeToBytes(ck.ImageFormat.PNG, 100) ?? new Uint8Array();
	surface.dispose();
	return Buffer.from(bytes);
}
