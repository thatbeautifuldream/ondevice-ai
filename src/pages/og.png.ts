import { renderOgImage } from "../lib/og";
import { siteConfig } from "../lib/seo";

// Site-wide OG card for the chat page.
export async function GET() {
	const png = await renderOgImage({
		title: "Chat with Gemini Nano",
		description: siteConfig.description,
	});
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
