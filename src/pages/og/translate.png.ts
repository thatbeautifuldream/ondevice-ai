import { generateOpenGraphImage } from "astro-og-canvas";
import { ogImageOptions } from "../../lib/og";

// OG card for the translate playground.
export async function GET() {
	const png = await generateOpenGraphImage(
		ogImageOptions({
			title: "Translate Playground",
			description:
				"On-device translation with Chrome's Translator and Language Detector APIs. Auto-detects as you type, streams the result.",
		}),
	);
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
