import { generateOpenGraphImage } from "astro-og-canvas";
import { ogImageOptions } from "../lib/og";
import { siteConfig } from "../lib/seo";

// Site-wide OG card for the chat page.
export async function GET() {
	const png = await generateOpenGraphImage(
		ogImageOptions({ title: siteConfig.title, description: siteConfig.description }),
	);
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
