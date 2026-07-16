// Structured Output Playground — demonstrates the Prompt API `responseConstraint`
// option (Chrome 137+) which constrains the on-device model's reply to JSON that
// conforms to a JSON Schema. See https://developer.chrome.com/docs/ai/prompt-api

import { icon } from "../lib/icons";

type Availability = "unavailable" | "downloadable" | "downloading" | "available";

interface Preset {
	id: string;
	label: string;
	instruction: string;
	input: string;
	schema: Record<string, unknown>;
}

const PRESETS: Preset[] = [
	{
		id: "pottery",
		label: "Boolean",
		instruction:
			"Is the following social media post about pottery? Reply strictly according to the response schema.",
		input:
			"Mugs and ramen bowls, both a bit smaller than intended—but that's how it goes with reclaim. Glaze crawled the first time around, but pretty happy with it after refiring.",
		schema: { type: "boolean" },
	},
	{
		id: "hashtags",
		label: "Array + pattern",
		instruction: "Suggest at most three hashtags for the following social media post.",
		input:
			"Spent the weekend finally fixing the dripping kitchen faucet. New cartridge in, no more percussion solo at 3am. Small wins matter.",
		schema: {
			type: "object",
			properties: {
				hashtags: {
					type: "array",
					maxItems: 3,
					items: { type: "string", pattern: "^#[^\\s#]+$" },
				},
			},
			required: ["hashtags"],
			additionalProperties: false,
		},
	},
	{
		id: "sentiment",
		label: "Enum",
		instruction: "Classify the overall sentiment of the following review.",
		input:
			"The headphones sound great and the battery lasts forever, but the ear cushions started peeling after a month. I'd still recommend them on sale.",
		schema: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
	},
	{
		id: "review",
		label: "Object",
		instruction: "Extract structured details from the following product review.",
		input:
			"I've had this coffee grinder for about six weeks. It's surprisingly quiet and grinds evenly, though the hopper is small so I refill it daily. Cleanup is easy. Overall I'd buy it again.",
		schema: {
			type: "object",
			properties: {
				rating: { type: "integer", minimum: 1, maximum: 5 },
				summary: { type: "string", maxLength: 120 },
				pros: { type: "array", items: { type: "string" }, maxItems: 5 },
				cons: { type: "array", items: { type: "string" }, maxItems: 5 },
				recommends: { type: "boolean" },
			},
			required: ["rating", "summary", "pros", "cons", "recommends"],
			additionalProperties: false,
		},
	},
	{
		id: "palette",
		label: "Nested",
		instruction: "Design a small color palette that matches the mood described below.",
		input: "A calm, rainy autumn afternoon spent reading by the window with a cup of tea.",
		schema: {
			type: "object",
			properties: {
				name: { type: "string", maxLength: 40 },
				mood: { type: "string", enum: ["calm", "energetic", "cozy", "mysterious", "playful"] },
				colors: {
					type: "array",
					minItems: 3,
					maxItems: 5,
					items: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
				},
			},
			required: ["name", "mood", "colors"],
			additionalProperties: false,
		},
	},
];

interface Issue {
	path: string;
	msg: string;
}

type CardStatus = "idle" | "running" | "done" | "error";

interface StructuredResult {
	status: CardStatus;
	raw?: string;
	parsed?: unknown;
	parseError?: boolean;
	issues?: Issue[];
	latencyMs?: number;
	error?: string;
}

interface FreeformResult {
	status: CardStatus;
	raw?: string;
	latencyMs?: number;
	error?: string;
}

const state = {
	availability: null as Availability | null,
	baseSession: null as LanguageModel | null,
	activePreset: "pottery",
	running: false,
	abort: null as AbortController | null,
	tab: "parsed" as "parsed" | "raw",
	structured: { status: "idle" } as StructuredResult,
	freeform: { status: "idle" } as FreeformResult,
};

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const els = {
	modelStatus: () => $("#pg-model-status") as HTMLElement,
	modelDot: () => $("#pg-model-dot") as HTMLElement,
	modelLabel: () => $("#pg-model-label") as HTMLElement,
	unavailable: () => $("#pg-unavailable") as HTMLElement,
	presets: () => $("#pg-presets") as HTMLElement,
	instruction: () => $("#pg-instruction") as HTMLInputElement,
	inputText: () => $("#pg-input") as HTMLTextAreaElement,
	schema: () => $("#pg-schema") as HTMLTextAreaElement,
	schemaError: () => $("#pg-schema-error") as HTMLElement,
	formatBtn: () => $("#pg-format") as HTMLButtonElement,
	runBtn: () => $("#pg-run") as HTMLButtonElement,
	runLabel: () => $("#pg-run-label") as HTMLElement,
	runIcon: () => $("#pg-run-icon") as HTMLElement,
	compareBtn: () => $("#pg-compare") as HTMLButtonElement,
	downloadBanner: () => $("#pg-download") as HTMLElement,
	downloadBar: () => $("#pg-download-bar") as HTMLElement,
	downloadStatus: () => $("#pg-download-status") as HTMLElement,
	sCard: () => $("#pg-s-card") as HTMLElement,
	sBadge: () => $("#pg-s-badge") as HTMLElement,
	sLatency: () => $("#pg-s-latency") as HTMLElement,
	sTabs: () => $("#pg-s-tabs") as HTMLElement,
	sParsed: () => $("#pg-s-parsed") as HTMLElement,
	sRaw: () => $("#pg-s-raw") as HTMLElement,
	sBody: () => $("#pg-s-body") as HTMLElement,
	fCard: () => $("#pg-f-card") as HTMLElement,
	fBadge: () => $("#pg-f-badge") as HTMLElement,
	fLatency: () => $("#pg-f-latency") as HTMLElement,
	fBody: () => $("#pg-f-body") as HTMLElement,
};

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
	);
}

function realType(v: unknown): string {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	return typeof v;
}

function fmt(v: unknown): string {
	return JSON.stringify(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
	}
	if (a && b && typeof a === "object") {
		const ka = Object.keys(a as Record<string, unknown>);
		const kb = Object.keys(b as Record<string, unknown>);
		return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
	}
	return false;
}

function typeMatches(value: unknown, type: string): boolean {
	switch (type) {
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		case "array":
			return Array.isArray(value);
		case "string":
			return typeof value === "string";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "number":
			return typeof value === "number";
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		default:
			return true;
	}
}

function validate(schema: Record<string, unknown>, value: unknown): Issue[] {
	const issues: Issue[] = [];
	walk(schema, value, "$", issues);
	return issues;
}

function walk(schema: Record<string, unknown>, value: unknown, path: string, issues: Issue[]): void {
	if (typeof schema !== "object" || schema === null) return;

	if (Array.isArray(schema.enum)) {
		if (!schema.enum.some((e) => deepEqual(e, value))) {
			issues.push({ path, msg: `must be one of ${fmt(schema.enum)}` });
		}
	}

	const type = typeof schema.type === "string" ? (schema.type as string) : undefined;
	if (type && !typeMatches(value, type)) {
		issues.push({ path, msg: `expected ${type}, got ${realType(value)}` });
		return;
	}

	if (type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		const propsRaw = schema.properties;
		const props = propsRaw && typeof propsRaw === "object" ? (propsRaw as Record<string, Record<string, unknown>>) : null;
		const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
		for (const key of required) {
			if (!(key in obj)) issues.push({ path: `${path}.${key}`, msg: "required property is missing" });
		}
		const allowExtra = schema.additionalProperties !== false;
		for (const [key, sub] of Object.entries(obj)) {
			const subSchema = props?.[key];
			if (subSchema) {
				walk(subSchema, sub, `${path}.${key}`, issues);
			} else if (!allowExtra) {
				issues.push({ path: `${path}.${key}`, msg: "additional property is not allowed" });
			}
		}
	}

	if (type === "array" && Array.isArray(value)) {
		const itemsRaw = schema.items;
		const items = itemsRaw && typeof itemsRaw === "object" ? (itemsRaw as Record<string, unknown>) : null;
		const max = typeof schema.maxItems === "number" ? schema.maxItems : Infinity;
		const min = typeof schema.minItems === "number" ? schema.minItems : 0;
		if (value.length > max) issues.push({ path, msg: `has ${value.length} items (max ${max})` });
		if (value.length < min) issues.push({ path, msg: `has ${value.length} items (min ${min})` });
		if (items) value.forEach((v, i) => walk(items, v, `${path}[${i}]`, issues));
	}

	if (type === "string" && typeof value === "string") {
		const pat = typeof schema.pattern === "string" ? (schema.pattern as string) : null;
		if (pat) {
			let re: RegExp;
			try {
				re = new RegExp(pat);
			} catch {
				issues.push({ path, msg: `declares an invalid pattern ${pat}` });
				re = /$./;
			}
			if (!re.test(value)) issues.push({ path, msg: `does not match pattern ${pat}` });
		}
		if (typeof schema.minLength === "number" && value.length < schema.minLength) {
			issues.push({ path, msg: `is too short (min ${schema.minLength} chars)` });
		}
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
			issues.push({ path, msg: `is too long (max ${schema.maxLength} chars)` });
		}
	}

	if ((type === "number" || type === "integer") && typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) {
			issues.push({ path, msg: `must be ≥ ${schema.minimum}` });
		}
		if (typeof schema.maximum === "number" && value > schema.maximum) {
			issues.push({ path, msg: `must be ≤ ${schema.maximum}` });
		}
	}
}

function highlightJson(value: unknown): string {
	const json = JSON.stringify(value, null, 2);
	const re = /("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
	const tokens: { t: string; cls: string }[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(json)) !== null) {
		if (m.index > last) tokens.push({ t: json.slice(last, m.index), cls: "" });
		const tok = m[0];
		let cls = "text-amber-300";
		if (tok.startsWith('"')) {
			cls = /:$/.test(tok) ? "text-sky-300" : "text-emerald-300";
		} else if (tok === "true" || tok === "false") {
			cls = "text-fuchsia-300";
		} else if (tok === "null") {
			cls = "text-zinc-500";
		}
		tokens.push({ t: tok, cls });
		last = re.lastIndex;
	}
	if (last < json.length) tokens.push({ t: json.slice(last), cls: "" });
	return tokens
		.map((tk) => (tk.cls ? `<span class="${tk.cls}">${escapeHtml(tk.t)}</span>` : escapeHtml(tk.t)))
		.join("");
}

const CODE_PANEL =
	"scrollbar-thin overflow-x-auto rounded-xl bg-zinc-900 p-3.5 font-mono text-[0.8125rem]/6 text-zinc-100 ring-1 ring-white/10";

function spinnerHtml(label: string): string {
	return (
		`<div class="flex items-center gap-2 py-6 text-sm text-zinc-400 dark:text-zinc-500">` +
		`<span class="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-500 dark:border-zinc-600 dark:border-t-emerald-400"></span>` +
		`${escapeHtml(label)}</div>`
	);
}

function applyPreset(id: string): void {
	const preset = PRESETS.find((p) => p.id === id);
	if (!preset) return;
	state.activePreset = id;
	els.instruction().value = preset.instruction;
	els.inputText().value = preset.input;
	els.schema().value = JSON.stringify(preset.schema, null, 2);
	els.schemaError().textContent = "";
	for (const btn of els.presets().querySelectorAll<HTMLButtonElement>("button")) {
		const active = btn.dataset.id === id;
		btn.setAttribute("aria-pressed", String(active));
		btn.className = presetBtnClass(active);
	}
}

function presetBtnClass(active: boolean): string {
	const base =
		"relative rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors sm:text-sm";
	return active
		? `${base} bg-emerald-600 text-white ring-emerald-600`
		: `${base} bg-white text-zinc-600 ring-zinc-950/10 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white`;
}

function parseSchema(): Record<string, unknown> | null {
	const raw = els.schema().value.trim();
	if (!raw) return null;
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Schema must be a JSON object (or `{ \"type\": \"boolean\" }`).");
	}
	return parsed as Record<string, unknown>;
}

function tryParseSchema(): { schema: Record<string, unknown> | null; error?: string } {
	try {
		return { schema: parseSchema() };
	} catch (e) {
		return { schema: null, error: (e as Error).message };
	}
}

function buildPrompt(): string {
	const instruction = els.instruction().value.trim();
	const input = els.inputText().value.trim();
	return [instruction, input].filter(Boolean).join("\n\n");
}

async function ensureBaseSession(): Promise<LanguageModel> {
	if (state.baseSession) return state.baseSession;
	const needsDownload = state.availability === "downloadable" || state.availability === "downloading";
	if (needsDownload) {
		state.availability = "downloading";
		updateModelStatus();
		els.downloadBanner().classList.remove("hidden");
	}
	const session = await LanguageModel.create({
		monitor: (m) => {
			m.addEventListener("downloadprogress", (e: ProgressEvent) => {
				setDownloadProgress(typeof e.loaded === "number" ? e.loaded : 0);
			});
		},
	});
	state.baseSession = session;
	if (state.availability !== "available") {
		state.availability = "available";
	}
	els.downloadBanner().classList.add("hidden");
	updateModelStatus();
	return session;
}

function setDownloadProgress(fraction: number): void {
	const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
	els.downloadBar().style.width = `${pct}%`;
	els.downloadStatus().textContent = pct > 0 ? `${pct}% downloaded` : "Starting download…";
}

async function refreshAvailability(): Promise<void> {
	let avail: Availability;
	try {
		avail = await LanguageModel.availability();
	} catch {
		avail = "unavailable";
	}
	state.availability = avail;
	updateModelStatus();
	updateRunEnabled();
}

function updateModelStatus(): void {
	const map: Record<Availability, { dot: string; text: string }> = {
		available: { dot: "bg-emerald-500", text: "Ready · Gemini Nano" },
		downloadable: { dot: "bg-amber-500", text: "Model ready to download" },
		downloading: { dot: "bg-amber-500 animate-pulse", text: "Downloading model…" },
		unavailable: { dot: "bg-red-500", text: "Unavailable in this browser" },
	};
	const info = state.availability ? map[state.availability] : { dot: "bg-zinc-400", text: "Checking model…" };
	els.modelDot().className = `size-2 shrink-0 rounded-full ${info.dot}`;
	els.modelLabel().textContent = info.text;
	const unavailable = state.availability === "unavailable";
	els.unavailable().classList.toggle("hidden", !unavailable);
}

function updateRunEnabled(): void {
	const blocked = state.availability === "unavailable";
	if (state.running) {
		els.runBtn().disabled = false;
		els.runLabel().textContent = "Stop";
		els.runIcon().innerHTML = icon("stop", "size-4");
		els.compareBtn().disabled = true;
		return;
	}
	els.runLabel().textContent = "Run";
	els.runIcon().innerHTML = icon("play", "size-4");
	els.runBtn().disabled = blocked;
	els.compareBtn().disabled = blocked;
}

function abortCurrent(): void {
	state.abort?.abort();
}

async function runOnce(useSchema: boolean): Promise<{ raw: string; latencyMs: number }> {
	const prompt = buildPrompt();
	const session = await ensureBaseSession();
	const clone = await session.clone();
	const ac = new AbortController();
	state.abort = ac;
	const options: LanguageModelPromptOptions = { signal: ac.signal };
	if (useSchema) {
		const { schema, error } = tryParseSchema();
		if (error) throw new SchemaError(error);
		if (schema) options.responseConstraint = schema;
	}
	const started = performance.now();
	try {
		const raw = await clone.prompt(prompt, options);
		return { raw, latencyMs: Math.round(performance.now() - started) };
	} finally {
		try {
			clone.destroy();
		} catch {
			/* ignore */
		}
		state.abort = null;
	}
}

class SchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SchemaError";
	}
}

function badgeHtml(tone: "ok" | "warn" | "err" | "muted", label: string): string {
	const map = {
		ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20",
		warn: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
		err: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20",
		muted: "bg-zinc-100 text-zinc-500 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10",
	} as const;
	return (
		`<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${map[tone]}">${label}</span>`
	);
}

function setTabsVisible(visible: boolean): void {
	const tabs = els.sTabs();
	tabs.classList.toggle("hidden", !visible);
	tabs.classList.toggle("flex", visible);
}

function renderStructured(): void {
	const r = state.structured;
	const badge = els.sBadge();
	const latency = els.sLatency();
	const body = els.sBody();
	const parsed = els.sParsed();
	const raw = els.sRaw();

	body.innerHTML = "";
	parsed.innerHTML = "";
	raw.innerHTML = "";
	latency.textContent = "";

	if (r.status === "idle") {
		badge.innerHTML = badgeHtml("muted", "Awaiting run");
		setTabsVisible(false);
		body.innerHTML = `<p class="py-6 text-sm text-zinc-400 dark:text-zinc-500">Pick a preset, edit the schema, then choose <span class="font-medium text-zinc-600 dark:text-zinc-300">Run</span> to constrain the model's reply.</p>`;
		return;
	}
	if (r.status === "running") {
		badge.innerHTML = badgeHtml("muted", "Generating");
		setTabsVisible(false);
		body.innerHTML = spinnerHtml("Calling the on-device model…");
		return;
	}
	if (r.status === "error") {
		badge.innerHTML = badgeHtml("err", `${icon("exclamation-triangle", "size-3.5")} Error`);
		setTabsVisible(false);
		body.innerHTML = `<div class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">${escapeHtml(r.error || "Something went wrong.")}</div>`;
		return;
	}

	setTabsVisible(true);
	if (r.latencyMs !== undefined) latency.textContent = `Done in ${r.latencyMs} ms`;

	if (r.parseError) {
		badge.innerHTML = badgeHtml("err", `${icon("exclamation-triangle", "size-3.5")} Not valid JSON`);
		parsed.innerHTML = `<div class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">${escapeHtml(r.error || "The response could not be parsed as JSON.")}</div>`;
	} else {
		const issues = r.issues ?? [];
		const tone = issues.length === 0 ? "ok" : "warn";
		const label =
			issues.length === 0
				? `${icon("check", "size-3.5")} Valid · matches schema`
				: `${icon("exclamation-triangle", "size-3.5")} ${issues.length} schema violation${issues.length === 1 ? "" : "s"}`;
		badge.innerHTML = badgeHtml(tone, label);
		parsed.innerHTML =
			`<pre class="${CODE_PANEL}">${highlightJson(r.parsed)}</pre>` +
			(issues.length
				? `<ul class="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-400" role="list">${issues
						.map(
							(i) =>
								`<li class="flex gap-2"><span class="font-mono text-amber-500">${escapeHtml(i.path)}</span><span>${escapeHtml(i.msg)}</span></li>`,
						)
						.join("")}</ul>`
				: "");
	}
	raw.innerHTML = `<pre class="${CODE_PANEL}">${escapeHtml(r.raw || "")}</pre>`;
	applyTab();
}

function renderFreeform(): void {
	const r = state.freeform;
	const badge = els.fBadge();
	const latency = els.fLatency();
	const body = els.fBody();

	if (r.status === "idle") {
		badge.innerHTML = badgeHtml("muted", "No constraint");
		latency.textContent = "";
		body.innerHTML = `<p class="py-6 text-sm text-zinc-400 dark:text-zinc-500">Run <span class="font-medium text-zinc-600 dark:text-zinc-300">Compare without constraint</span> to see the model's free-form reply — often chatty and hard to parse.</p>`;
		return;
	}
	if (r.status === "running") {
		badge.innerHTML = badgeHtml("muted", "Generating");
		latency.textContent = "";
		body.innerHTML = spinnerHtml("Calling the on-device model…");
		return;
	}
	if (r.latencyMs !== undefined) latency.textContent = `Done in ${r.latencyMs} ms`;
	if (r.status === "error") {
		badge.innerHTML = badgeHtml("err", `${icon("exclamation-triangle", "size-3.5")} Error`);
		latency.textContent = "";
		body.innerHTML = `<div class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">${escapeHtml(r.error || "Something went wrong.")}</div>`;
		return;
	}
	badge.innerHTML = badgeHtml("muted", "No constraint");
	body.innerHTML = `<pre class="${CODE_PANEL} whitespace-pre-wrap">${escapeHtml(r.raw || "")}</pre>`;
}

function applyTab(): void {
	const parsed = state.tab === "parsed";
	for (const btn of els.sTabs().querySelectorAll<HTMLButtonElement>("button")) {
		const isActive = btn.dataset.tab === state.tab;
		btn.setAttribute("aria-selected", String(isActive));
		btn.className = tabBtnClass(isActive);
	}
	els.sParsed().classList.toggle("hidden", !parsed);
	els.sRaw().classList.toggle("hidden", parsed);
}

function tabBtnClass(active: boolean): string {
	return active
		? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
		: "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200";
}

function friendlyError(e: unknown): string {
	const err = e as DOMException;
	if (err?.name === "AbortError") return "Run aborted.";
	if (err?.name === "NotSupportedError") return "The on-device model isn't available in this browser.";
	if (err?.name === "QuotaExceededError") return "The context window was exceeded.";
	return err?.message || "Something went wrong while generating a response.";
}

async function runStructured(): Promise<void> {
	if (state.running) {
		abortCurrent();
		return;
	}
	const { error } = tryParseSchema();
	els.schemaError().textContent = error ?? "";
	if (error) return;

	state.running = true;
	updateRunEnabled();
	state.structured = { status: "running" };
	renderStructured();

	try {
		const { raw, latencyMs } = await runOnce(true);
		let parsed: unknown;
		let parseError = false;
		let parseErrMsg: string | undefined;
		try {
			parsed = JSON.parse(raw);
		} catch {
			parseError = true;
			parseErrMsg = "The model returned text that isn't valid JSON.";
		}
		const schema = tryParseSchema().schema;
		const issues = parseError || !schema ? [] : validate(schema, parsed);
		state.structured = { status: "done", raw, parsed, parseError, error: parseErrMsg, issues, latencyMs };
	} catch (e) {
		if ((e as DOMException)?.name === "AbortError") {
			state.structured = state.structured.status === "running" ? { status: "idle" } : state.structured;
			state.running = false;
			updateRunEnabled();
			renderStructured();
			return;
		}
		state.structured = { status: "error", error: friendlyError(e) };
	} finally {
		if (state.structured.status === "running") {
			state.structured = { status: "idle" };
		}
		state.running = false;
		updateRunEnabled();
		renderStructured();
	}
}

async function runFreeform(): Promise<void> {
	if (state.running) return;
	state.running = true;
	updateRunEnabled();
	state.freeform = { status: "running" };
	renderFreeform();
	try {
		const { raw, latencyMs } = await runOnce(false);
		state.freeform = { status: "done", raw, latencyMs };
	} catch (e) {
		if ((e as DOMException)?.name === "AbortError") {
			state.freeform = { status: "idle" };
			state.running = false;
			updateRunEnabled();
			renderFreeform();
			return;
		}
		state.freeform = { status: "error", error: friendlyError(e) };
	} finally {
		state.running = false;
		updateRunEnabled();
		renderFreeform();
	}
}

function formatSchema(): void {
	const { schema, error } = tryParseSchema();
	els.schemaError().textContent = "";
	if (error || !schema) {
		els.schemaError().textContent = error || "Nothing to format.";
		return;
	}
	els.schema().value = JSON.stringify(schema, null, 2);
}

function wireEvents(): void {
	els.presets().addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
		if (btn) applyPreset(btn.dataset.id as string);
	});

	els.formatBtn().addEventListener("click", formatSchema);
	els.schema().addEventListener("input", () => {
		els.schemaError().textContent = "";
	});

	els.runBtn().addEventListener("click", () => void runStructured());
	els.compareBtn().addEventListener("click", () => void runFreeform());

	els.sTabs().addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
		if (!btn) return;
		state.tab = btn.dataset.tab as "parsed" | "raw";
		applyTab();
	});

	els.instruction().addEventListener("keydown", (e) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void runStructured();
		}
	});
	els.inputText().addEventListener("keydown", (e) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void runStructured();
		}
	});
}

export function startPlayground(): void {
	wireEvents();
	applyPreset(state.activePreset);
	renderStructured();
	renderFreeform();
	updateRunEnabled();
	void refreshAvailability();
}
