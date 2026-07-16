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
