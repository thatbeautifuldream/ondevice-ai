import { generateOpenGraphImage } from "astro-og-canvas";
import { ogImageOptions } from "../../lib/og";

// OG card for the writing tools playground.
export async function GET() {
	const png = await generateOpenGraphImage(
		ogImageOptions({
			title: "Writing Tools Playground",
			description:
				"Draft, rework, and proofread on-device with Chrome's Writer, Rewriter, and Proofreader APIs.",
		}),
	);
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
