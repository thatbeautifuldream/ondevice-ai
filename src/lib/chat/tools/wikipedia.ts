import type { TTool } from "./index";

// Both endpoints send `access-control-allow-origin: *` for anonymous
// requests, so they work from the browser with no key and no proxy.
const SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page";
const EXTRACT_URL = "https://en.wikipedia.org/w/api.php";

const MAX_EXTRACT_CHARS = 4000;

// Wikimedia etiquette: identify the client, or anonymous requests get
// throttled. The header is allowlisted in their CORS preflight.
const FETCH_HEADERS = { "Api-User-Agent": "ondevice-ai-chat/1.0 (https://chat.milind.app)" };

function stripTags(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

type TSearchPage = { title: string; description?: string | null; excerpt?: string | null };

async function searchPages(query: string, signal?: AbortSignal): Promise<TSearchPage[] | null> {
	const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=5`, { signal, headers: FETCH_HEADERS });
	if (!res.ok) return null;
	const data = (await res.json()) as { pages?: TSearchPage[] };
	return data.pages ?? [];
}

async function readExtract(title: string, signal?: AbortSignal): Promise<{ title: string; extract: string } | null> {
	const params = new URLSearchParams({
		action: "query",
		prop: "extracts",
		explaintext: "1",
		exintro: "1",
		redirects: "1",
		format: "json",
		origin: "*",
		titles: title,
	});
	const res = await fetch(`${EXTRACT_URL}?${params}`, { signal, headers: FETCH_HEADERS });
	if (!res.ok) return null;
	const data = (await res.json()) as {
		query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string }> };
	};
	const page = Object.values(data.query?.pages ?? {})[0];
	if (!page || page.missing !== undefined || !page.extract) return null;
	const extract = page.extract.length > MAX_EXTRACT_CHARS ? `${page.extract.slice(0, MAX_EXTRACT_CHARS)}…` : page.extract;
	return { title: page.title ?? title, extract };
}

function formatResults(pages: TSearchPage[]): string {
	return pages
		.map((p, i) => {
			const desc = p.description || stripTags(p.excerpt ?? "");
			return `${i + 1}. ${p.title}${desc ? ` — ${desc}` : ""}`;
		})
		.join("\n");
}

// One tool, one decision: search + read the top article in a single call.
// Small models pick wrong tools and confuse search queries with exact
// titles; collapsing the pair removes that failure mode entirely.
export const wikipedia: TTool = {
	name: "wikipedia",
	description:
		"Look up facts on Wikipedia. Give it a search query (a topic, person, place, or event); it returns the most relevant article's introduction plus other matching article titles.",
	argsSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "What to look up, e.g. \"population of India\"" },
		},
		required: ["query"],
	},
	async execute(args, signal) {
		const query = String(args.query ?? args.title ?? args.q ?? "").trim();
		if (!query) return "Error: query must not be empty.";
		const pages = await searchPages(query, signal);
		if (pages === null) return "Wikipedia is unreachable right now. Answer from what you know and say so.";
		if (pages.length === 0) return `No Wikipedia articles found for "${query}". Try a broader or simpler query.`;
		for (const page of pages) {
			const article = await readExtract(page.title, signal);
			if (article) {
				const others = pages.filter((p) => p.title !== article.title).map((p) => p.title);
				return [
					`# ${article.title}`,
					"",
					article.extract,
					...(others.length > 0 ? ["", `Other matching articles: ${others.join("; ")}`] : []),
				].join("\n");
			}
		}
		return formatResults(pages);
	},
};

export const wikipediaSearch: TTool = {
	name: "wikipedia_search",
	description:
		"Search Wikipedia for articles. Returns up to 5 matching article titles with short descriptions. Use this to find the exact article title before reading it.",
	argsSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Search terms, e.g. a topic, person, place, or event" },
		},
		required: ["query"],
	},
	async execute(args, signal) {
		const query = String(args.query ?? "").trim();
		if (!query) return "Error: query must not be empty.";
		const pages = await searchPages(query, signal);
		if (pages === null) return "Wikipedia search failed. Try again or answer from what you know.";
		if (pages.length === 0) return `No Wikipedia articles found for "${query}". Try a broader or simpler query.`;
		return formatResults(pages);
	},
};

export const wikipediaRead: TTool = {
	name: "wikipedia_read",
	description:
		"Read the introduction of a Wikipedia article by its exact title. Use wikipedia_search first if you don't know the exact title.",
	argsSchema: {
		type: "object",
		properties: {
			title: { type: "string", description: "Exact Wikipedia article title, e.g. \"Alan Turing\"" },
		},
		required: ["title"],
	},
	async execute(args, signal) {
		const title = String(args.title ?? args.query ?? "").trim();
		if (!title) return "Error: title must not be empty.";
		const exact = await readExtract(title, signal);
		if (exact) return `# ${exact.title}\n\n${exact.extract}`;
		// Not an exact title — fall back to searching it and reading the top hit.
		const pages = await searchPages(title, signal);
		const top = pages?.[0];
		if (top) {
			const article = await readExtract(top.title, signal);
			if (article) return `# ${article.title} (closest match for "${title}")\n\n${article.extract}`;
		}
		return `No Wikipedia article found for "${title}". Try a broader or simpler query.`;
	},
};

// The chat agent ships the single combined tool; the granular pair stays
// exported for callers that want finer control.
export const WIKIPEDIA_TOOLS: TTool[] = [wikipedia];
