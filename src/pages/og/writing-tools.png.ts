import { renderOgImage } from "../../lib/og";
import { pageSeo } from "../../lib/seo";

// OG card for the writing tools playground.
export async function GET() {
	const png = await renderOgImage({
		title: pageSeo.writingTools.ogTitle,
		description: pageSeo.writingTools.ogDescription,
	});
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
