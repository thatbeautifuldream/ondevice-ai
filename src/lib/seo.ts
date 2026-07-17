export const siteConfig = {
	name: "Chat",
	title: "Chat - Private, on-device AI",
	tagline: "Private, on-device AI chat",
	description:
		"A private chat app powered by Chrome's built-in Prompt API and Gemini Nano. Everything runs locally on your device.",
	url: "https://chat.milind.app",
	language: "en",
	locale: "en_US",
	themeColor: "#0a0a0a",
	defaultImage: "/og.png",
	twitter: "@milindmishra_",
	author: {
		name: "Milind Kumar Mishra",
		url: "https://milindmishra.com",
	},
} as const;

// Per-page SEO copy, shared by the page meta tags and the OG card endpoints
// so titles and descriptions never drift apart. No em dashes in any copy.
export const pageSeo = {
	writingTools: {
		path: "/writing-tools",
		title: "Writing Tools Playground - Chat",
		ogTitle: "Writing Tools Playground",
		description:
			"Draft, rework, and proofread text with Chrome's on-device Writer, Rewriter, and Proofreader APIs. Tone and length controls, streamed output, inline corrections.",
		ogDescription:
			"Draft, rework, and proofread on-device with Chrome's Writer, Rewriter, and Proofreader APIs.",
		keywords: [
			"Chrome Writer API",
			"Chrome Rewriter API",
			"Chrome Proofreader API",
			"on-device writing assistant",
			"AI proofreading",
			"built-in AI",
			"Gemini Nano",
		],
	},
	translate: {
		path: "/translate",
		title: "Translate Playground - Chat",
		ogTitle: "Translate Playground",
		description:
			"Type in any language and Chrome's on-device Language Detector API identifies it while the Translator API streams the translation. Nothing leaves your device.",
		ogDescription:
			"On-device translation with Chrome's Translator and Language Detector APIs. Auto-detects as you type, streams the result.",
		keywords: [
			"Chrome Translator API",
			"Language Detector API",
			"on-device translation",
			"offline translation",
			"private translation",
			"built-in AI",
		],
	},
	structuredOutput: {
		path: "/structured-output",
		title: "Structured Output Playground - Chat",
		ogTitle: "Structured Output Playground",
		description:
			"Experiment with the Prompt API responseConstraint option to force Chrome's on-device model to reply with JSON that matches a JSON Schema.",
		ogDescription:
			"Force Chrome's on-device model to reply with valid JSON using the Prompt API's responseConstraint option.",
		keywords: [
			"Chrome Prompt API",
			"responseConstraint",
			"structured output",
			"JSON Schema",
			"Gemini Nano",
			"on-device AI",
			"built-in AI",
		],
	},
} as const;

export type TPageSeo = (typeof pageSeo)[keyof typeof pageSeo];

export function buildWebPageSchema(page: TPageSeo, site?: URL | null) {
	const origin = getSiteOrigin(site);
	return {
		"@context": "https://schema.org",
		"@type": "WebPage",
		"@id": `${origin}${page.path}#webpage`,
		name: page.title,
		url: `${origin}${page.path}`,
		description: page.description,
		inLanguage: siteConfig.language,
		isPartOf: { "@id": `${origin}/#website` },
	};
}

export const defaultKeywords = [
	"on-device AI",
	"Chrome Prompt API",
	"Gemini Nano",
	"private AI chat",
	"local LLM",
	"built-in AI",
	"structured output",
];

export function getSiteOrigin(site?: URL | null) {
	return new URL(site?.toString() ?? siteConfig.url).origin;
}

export function absoluteUrl(path: string, site?: URL | null) {
	return new URL(path, `${getSiteOrigin(site)}/`).toString();
}

export function buildWebsiteSchema(site?: URL | null) {
	const origin = getSiteOrigin(site);
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		"@id": `${origin}/#website`,
		name: siteConfig.name,
		url: `${origin}/`,
		description: siteConfig.description,
		inLanguage: siteConfig.language,
		author: {
			"@type": "Person",
			name: siteConfig.author.name,
			url: siteConfig.author.url,
		},
	};
}

export function buildWebApplicationSchema(site?: URL | null) {
	const origin = getSiteOrigin(site);
	return {
		"@context": "https://schema.org",
		"@type": "WebApplication",
		"@id": `${origin}/#webapplication`,
		name: siteConfig.title,
		url: `${origin}/`,
		description: siteConfig.description,
		applicationCategory: "UtilitiesApplication",
		operatingSystem: "Any",
		browserRequirements: "Requires Chrome 137+ with the built-in Prompt API",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
		},
		image: absoluteUrl(siteConfig.defaultImage, site),
		isPartOf: { "@id": `${origin}/#website` },
	};
}
