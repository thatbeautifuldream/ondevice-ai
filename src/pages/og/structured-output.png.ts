import { generateOpenGraphImage } from "astro-og-canvas";
import { ogImageOptions } from "../../lib/og";

// OG card for the structured output playground.
export async function GET() {
	const png = await generateOpenGraphImage(
		ogImageOptions({
			title: "Structured Output Playground",
			description:
				"Force Chrome's on-device model to reply with valid JSON using the Prompt API's responseConstraint option.",
		}),
	);
	return new Response(png, {
		headers: { "Content-Type": "image/png" },
	});
}
