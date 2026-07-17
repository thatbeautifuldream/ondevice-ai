import { renderOgImage } from "../../lib/og";
import { pageSeo } from "../../lib/seo";

// OG card for the translate playground.
export async function GET() {
	const png = await renderOgImage({
		title: pageSeo.translate.ogTitle,
		description: pageSeo.translate.ogDescription,
	});
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
