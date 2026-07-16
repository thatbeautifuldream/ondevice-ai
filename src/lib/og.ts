// Shared Open Graph card style (black background, white title, muted
// description, Inter), same pattern as the portfolio site's OG cards.
export function ogImageOptions(page: { title: string; description?: string }) {
	return {
		title: page.title,
		description: page.description ?? "",
		bgGradient: [
			[10, 10, 10],
			[10, 10, 10],
		] as [number, number, number][],
		border: {
			color: [38, 38, 38] as [number, number, number],
			width: 2,
			side: "inline-start" as const,
		},
		padding: 64,
		font: {
			title: {
				color: [250, 250, 250] as [number, number, number],
				size: 64,
				weight: "SemiBold" as const,
				lineHeight: 1.2,
				families: ["Inter Variable"],
			},
			description: {
				color: [163, 163, 163] as [number, number, number],
				size: 30,
				lineHeight: 1.4,
				families: ["Inter Variable"],
			},
		},
		// CanvasKit can't read woff2, so OG cards use raw TTF Inter instances.
		fonts: ["./src/assets/fonts/Inter-400.ttf", "./src/assets/fonts/Inter-600.ttf"],
	};
}
