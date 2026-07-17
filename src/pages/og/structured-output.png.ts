import { generateOpenGraphImage } from "astro-og-canvas";
import { ogImageOptions } from "../../lib/og";
import { pageSeo } from "../../lib/seo";

// OG card for the structured output playground.
export async function GET() {
	const png = await generateOpenGraphImage(
		ogImageOptions({
			title: pageSeo.structuredOutput.ogTitle,
			description: pageSeo.structuredOutput.ogDescription,
		}),
	);
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
