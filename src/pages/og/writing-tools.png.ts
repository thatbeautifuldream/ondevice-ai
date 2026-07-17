import { generateOpenGraphImage } from "astro-og-canvas";
import { ogImageOptions } from "../../lib/og";
import { pageSeo } from "../../lib/seo";

// OG card for the writing tools playground.
export async function GET() {
	const png = await generateOpenGraphImage(
		ogImageOptions({
			title: pageSeo.writingTools.ogTitle,
			description: pageSeo.writingTools.ogDescription,
		}),
	);
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
