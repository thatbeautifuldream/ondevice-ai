import * as store from "./store";
import type { TChatMessage, TConversation, TInitialPrompt, TPromptTurn, TSettings } from "./types";

export type TAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export type TModelParams = {
	defaultTemperature: number;
	maxTemperature: number;
	defaultTopK: number;
	maxTopK: number;
};

export type TContextInfo = { usage: number; window: number };

// UI notifications. The agent never touches the DOM; the app layer wires
// these to whatever rendering it wants.
export type TAgentHooks = {
	onAvailabilityChange?: (availability: TAvailability) => void;
	onDownloadStart?: () => void;
	onDownloadProgress?: (fraction: number) => void;
	onDownloadEnd?: () => void;
	onContextChange?: () => void;
	onCompactingChange?: (compacting: boolean) => void;
	onCompactStatus?: (message: string, autoHideMs?: number) => void;
};

// Events yielded by the agent loop (`ChatAgent.run()`). The loop follows the
// yield/pause/process/resume cycle: the agent pauses at each yield while the
// consumer processes the event, and all agent-side state for an event is
// committed BEFORE it is yielded, so consumers can rely on settled state.
export type TAgentEvent =
	| { type: "chunk"; content: string } // accumulated text so far
	| { type: "done"; content: string } // response complete, session committed
	| { type: "aborted"; content: string } // stopped by user; partial text (may be empty)
	| { type: "error"; message: string } // failed; human-readable message
	| { type: "compacted"; success: boolean }; // post-turn auto-compaction outcome

// Events yielded by the one-shot primitives (`streamText` / `streamObject`).
// These share the agent loop's streaming core but run on a throwaway clone of
// a scratch session, so they never touch conversation history.
export type TTextStreamEvent =
	| { type: "chunk"; content: string }
	| { type: "done"; content: string; latencyMs: number }
	| { type: "aborted"; content: string }
	| { type: "error"; message: string };

export type TObjectStreamEvent =
	| { type: "chunk"; content: string } // raw model text so far
	| { type: "done"; raw: string; object?: unknown; parseError?: string; latencyMs: number }
	| { type: "aborted"; content: string }
	| { type: "error"; message: string };

// A live Prompt API session plus how many of the conversation's stored
// messages its context reflects. A session is only ever reused when
// `consumed` exactly matches the stored history it should contain; otherwise
// it is destroyed and rebuilt from storage via initialPrompts (the Prompt API
// "restore past session" pattern). This keeps model state deterministic.
type TSessionRecord = {
	session: LanguageModel;
	consumed: number;
};

// Each live session holds memory and keeps the model loaded. Cap concurrent
// sessions; least-recently-used idle ones are destroyed and can be rebuilt
// from stored history on demand (the "restore past session" pattern).
const MAX_SESSIONS = 3;

// When context usage crosses this ratio after a response, auto-compact the
// session by summarizing older turns into initialPrompts.
const AUTO_COMPACT_THRESHOLD = 0.8;

function friendlyError(e: unknown): string {
	const err = e as DOMException;
	if (err?.name === "QuotaExceededError") {
		return "The conversation exceeded the model's context window. Try starting a new chat.";
	}
	if (err?.name === "NotSupportedError") {
		return "The model couldn't handle this request. Try rephrasing or starting a new chat.";
	}
	return err?.message || "Something went wrong while generating a response.";
}

export class ChatAgent {
	private readonly getSettings: () => TSettings;
	private readonly hooks: TAgentHooks;

	private readonly sessions = new Map<string, TSessionRecord>();
	// History-free base session for one-shot runs; each streamText/streamObject
	// call clones it so runs stay independent (the Prompt API clone pattern).
	private scratch: LanguageModel | null = null;
	// Summarizers are shared across conversations, cached by `${format}:${lang}`.
	private readonly summarizers = new Map<string, Summarizer>();
	private languageDetector: LanguageDetector | null = null;

	private _availability: TAvailability | null = null;
	private _params: TModelParams | null = null;
	private _compacting = false;
	private overflowed = false;
	private supportsSummarizer = false;
	private supportsLanguageDetector = false;

	constructor(config: { settings: () => TSettings; hooks?: TAgentHooks }) {
		this.getSettings = config.settings;
		this.hooks = config.hooks ?? {};
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	async boot(): Promise<void> {
		this.detectCompactionSupport();
		await this.detectParamSupport();
		await this.refreshAvailability();
	}

	get availability(): TAvailability | null {
		return this._availability;
	}

	get modelParams(): TModelParams | null {
		return this._params;
	}

	get compacting(): boolean {
		return this._compacting;
	}

	private setAvailability(next: TAvailability): void {
		if (this._availability === next) return;
		this._availability = next;
		this.hooks.onAvailabilityChange?.(next);
	}

	private async refreshAvailability(): Promise<void> {
		let avail: TAvailability;
		try {
			avail = await LanguageModel.availability();
		} catch {
			avail = "unavailable";
		}
		this.setAvailability(avail);
	}

	private async detectParamSupport(): Promise<void> {
		// params() is restricted to extension / origin-trial contexts.
		try {
			if (typeof LanguageModel.params === "function") {
				const p = await LanguageModel.params();
				if (p && typeof p.defaultTemperature === "number") {
					this._params = {
						defaultTemperature: p.defaultTemperature,
						maxTemperature: p.maxTemperature ?? 2,
						defaultTopK: p.defaultTopK ?? 3,
						maxTopK: p.maxTopK ?? 128,
					};
				}
			}
		} catch {
			this._params = null;
		}
	}

	private detectCompactionSupport(): void {
		try {
			this.supportsSummarizer = typeof Summarizer !== "undefined";
		} catch {
			this.supportsSummarizer = false;
		}
		try {
			this.supportsLanguageDetector = typeof LanguageDetector !== "undefined";
		} catch {
			this.supportsLanguageDetector = false;
		}
	}

	// -------------------------------------------------------------------------
	// The agent loop
	// -------------------------------------------------------------------------

	// Run one turn of the conversation as an async generator. Expects the new
	// user message + assistant placeholder to already be the last two entries of
	// `conv.messages` (they are excluded from session restoration). Yields
	// progress events; terminal events (`done` / `aborted` / `error`) are always
	// yielded after the agent's session bookkeeping has been settled.
	async *run(conv: TConversation, prompt: string, signal?: AbortSignal): AsyncGenerator<TAgentEvent, void, void> {
		// Phase 1: restore or create a session that provably matches the stored
		// history before this exchange.
		let session: LanguageModel;
		try {
			session = await this.ensureSession(conv, 2, signal);
		} catch (err) {
			const e = err as DOMException;
			if (e?.name === "AbortError") {
				yield { type: "aborted", content: "" };
				return;
			}
			yield {
				type: "error",
				message:
					e?.name === "NotSupportedError"
						? "The on-device model isn't available in this browser. Use a recent Chrome version on a supported device."
						: friendlyError(e),
			};
			return;
		}

		// Phase 2: stream the response, yielding accumulated text per chunk.
		let acc = "";
		try {
			const chunks = this.streamChunks(session, prompt, { signal });
			while (true) {
				const next = await chunks.next();
				if (next.done) {
					acc = next.value;
					break;
				}
				acc = next.value;
				yield { type: "chunk", content: acc };
			}
		} catch (err) {
			// Aborted prompts are rolled back by the browser and failed ones are
			// indeterminate — either way the session's context no longer matches
			// stored history, so drop it and let the next turn rebuild.
			this.destroySession(conv.id);
			const e = err as DOMException;
			if (e?.name === "AbortError") {
				yield { type: "aborted", content: acc };
				return;
			}
			yield { type: "error", message: friendlyError(e) };
			return;
		}

		// Phase 3: commit — the session now reflects the full stored history,
		// including the exchange the consumer is about to persist.
		this.markConsumed(conv.id, conv.messages.length);
		yield { type: "done", content: acc };

		// Phase 4: auto-compact when the context window is filling up or the
		// browser signalled an overflow during the turn.
		if (this.overflowed && !this.supportsSummarizer) {
			this.hooks.onCompactStatus?.("Context window is full. Older messages may be dropped.", 4000);
			this.overflowed = false;
			return;
		}
		const total = typeof session.contextWindow === "number" ? session.contextWindow : 0;
		const used = typeof session.contextUsage === "number" ? session.contextUsage : 0;
		const ratio = total > 0 ? used / total : 0;
		if (this.overflowed || ratio >= AUTO_COMPACT_THRESHOLD) {
			const success = await this.compactConversation(conv);
			yield { type: "compacted", success };
		}
	}

	// -------------------------------------------------------------------------
	// One-shot primitives
	// -------------------------------------------------------------------------

	// Stream a single free-form completion, independent of any conversation.
	async *streamText(options: {
		prompt: string;
		signal?: AbortSignal;
	}): AsyncGenerator<TTextStreamEvent, void, void> {
		const started = performance.now();
		let acc = "";
		let clone: LanguageModel | null = null;
		try {
			const base = await this.ensureScratchSession(options.signal);
			clone = await base.clone();
			const chunks = this.streamChunks(clone, options.prompt, { signal: options.signal });
			while (true) {
				const next = await chunks.next();
				if (next.done) {
					acc = next.value;
					break;
				}
				acc = next.value;
				yield { type: "chunk", content: acc };
			}
		} catch (err) {
			const e = err as DOMException;
			if (e?.name === "AbortError") {
				yield { type: "aborted", content: acc };
				return;
			}
			yield { type: "error", message: friendlyError(e) };
			return;
		} finally {
			try {
				clone?.destroy();
			} catch {
				/* ignore */
			}
		}
		yield { type: "done", content: acc, latencyMs: Math.round(performance.now() - started) };
	}

	// Stream a single completion constrained to a JSON Schema via the Prompt
	// API's `responseConstraint`, then parse the result. With no schema the run
	// is unconstrained but the reply is still parsed as JSON.
	async *streamObject(options: {
		prompt: string;
		schema?: Record<string, unknown>;
		signal?: AbortSignal;
	}): AsyncGenerator<TObjectStreamEvent, void, void> {
		const started = performance.now();
		let acc = "";
		let clone: LanguageModel | null = null;
		try {
			const base = await this.ensureScratchSession(options.signal);
			clone = await base.clone();
			const promptOptions: LanguageModelPromptOptions = { signal: options.signal };
			if (options.schema) promptOptions.responseConstraint = options.schema;
			const chunks = this.streamChunks(clone, options.prompt, promptOptions);
			while (true) {
				const next = await chunks.next();
				if (next.done) {
					acc = next.value;
					break;
				}
				acc = next.value;
				yield { type: "chunk", content: acc };
			}
		} catch (err) {
			const e = err as DOMException;
			if (e?.name === "AbortError") {
				yield { type: "aborted", content: acc };
				return;
			}
			yield { type: "error", message: friendlyError(e) };
			return;
		} finally {
			try {
				clone?.destroy();
			} catch {
				/* ignore */
			}
		}
		const latencyMs = Math.round(performance.now() - started);
		try {
			yield { type: "done", raw: acc, object: JSON.parse(acc), latencyMs };
		} catch {
			yield { type: "done", raw: acc, parseError: "The model returned text that isn't valid JSON.", latencyMs };
		}
	}

	// -------------------------------------------------------------------------
	// Sessions
	// -------------------------------------------------------------------------

	destroySession(id: string): void {
		const record = this.sessions.get(id);
		if (!record) return;
		this.sessions.delete(id);
		try {
			record.session.destroy();
		} catch {
			/* ignore */
		}
	}

	invalidateSessions(): void {
		for (const id of [...this.sessions.keys()]) this.destroySession(id);
		if (this.scratch) {
			try {
				this.scratch.destroy();
			} catch {
				/* ignore */
			}
			this.scratch = null;
		}
		this.hooks.onContextChange?.();
	}

	contextInfo(convId: string): TContextInfo | null {
		const session = this.sessions.get(convId)?.session;
		if (session && typeof session.contextWindow === "number" && session.contextWindow > 0) {
			return { usage: session.contextUsage, window: session.contextWindow };
		}
		return null;
	}

	// Mark a session as most-recently-used (Map preserves insertion order, so
	// delete + re-set moves it to the end).
	private touchSession(id: string): void {
		const record = this.sessions.get(id);
		if (!record) return;
		this.sessions.delete(id);
		this.sessions.set(id, record);
	}

	// Record that the session's context now reflects the first `count` stored
	// messages of its conversation.
	private markConsumed(id: string, count: number): void {
		const record = this.sessions.get(id);
		if (record) record.consumed = count;
	}

	// Evict least-recently-used idle sessions when we exceed the cap. Safe to
	// call during a run: generation is serialized, so every other session in
	// the map is idle.
	private evictIdleSessions(): void {
		while (this.sessions.size > MAX_SESSIONS) {
			const oldestId = this.sessions.keys().next().value;
			if (!oldestId) break;
			this.destroySession(oldestId);
		}
	}

	// Return a session whose context provably matches the stored history up to
	// (but excluding) the last `excludeLastN` messages. A cached session is only
	// reused when its `consumed` marker agrees; any divergence (abort, error,
	// external edits) destroys it and rebuilds from storage.
	private async ensureSession(conv: TConversation, excludeLastN = 0, signal?: AbortSignal): Promise<LanguageModel> {
		const expected = Math.max(0, conv.messages.length - excludeLastN);
		const existing = this.sessions.get(conv.id);
		if (existing && existing.consumed === expected) {
			this.touchSession(conv.id);
			return existing.session;
		}
		if (existing) this.destroySession(conv.id);
		return this.createSessionFor(conv, excludeLastN, signal);
	}

	// Conversation session creation: raw create seeded from stored history,
	// then bookkeeping (consumed marker, LRU eviction, overflow early-warning).
	private async createSessionFor(conv: TConversation, excludeLastN = 0, signal?: AbortSignal): Promise<LanguageModel> {
		const settings = this.getSettings();
		const initialPrompts = store.buildInitialPrompts(conv, settings.systemPrompt, excludeLastN);
		const session = await this.createRawSession(initialPrompts, signal);
		this.sessions.set(conv.id, { session, consumed: Math.max(0, conv.messages.length - excludeLastN) });
		session.oncontextoverflow = () => this.onContextOverflow();
		this.evictIdleSessions();
		this.hooks.onContextChange?.();
		return session;
	}

	// Bare Prompt API session creation shared by conversation and scratch
	// sessions: download monitor, sampling params, availability bookkeeping.
	private async createRawSession(initialPrompts: TInitialPrompt[], signal?: AbortSignal): Promise<LanguageModel> {
		const settings = this.getSettings();
		const options: Record<string, unknown> = {
			initialPrompts,
			signal,
			monitor: (m: CreateMonitor) => {
				m.addEventListener("downloadprogress", (e: ProgressEvent) => {
					const loaded = typeof e.loaded === "number" ? e.loaded : 0;
					this.hooks.onDownloadProgress?.(loaded);
				});
			},
		};
		if (this._params) {
			options.temperature = settings.temperature;
			options.topK = settings.topK;
		}

		const needsDownload = this._availability === "downloadable" || this._availability === "downloading";
		if (needsDownload) {
			this.setAvailability("downloading");
			this.hooks.onDownloadStart?.();
		}

		try {
			const session = await LanguageModel.create(options as LanguageModelCreateOptions);
			this.setAvailability("available");
			this.hooks.onDownloadEnd?.();
			return session;
		} catch (err) {
			this.hooks.onDownloadEnd?.();
			throw err;
		}
	}

	private async ensureScratchSession(signal?: AbortSignal): Promise<LanguageModel> {
		if (this.scratch) return this.scratch;
		this.scratch = await this.createRawSession([], signal);
		return this.scratch;
	}

	// Read a prompt stream to completion, yielding the accumulated text after
	// each chunk and returning the final text. Shared streaming core for the
	// agent loop and the one-shot primitives.
	private async *streamChunks(
		session: LanguageModel,
		prompt: string,
		options: LanguageModelPromptOptions,
	): AsyncGenerator<string, string, void> {
		const stream = session.promptStreaming(prompt, options);
		let acc = "";
		const reader = stream.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				// Robust to both delta-style and cumulative-style streams.
				acc = acc === "" || value.startsWith(acc) ? value : acc + value;
				yield acc;
			}
		}
		return acc;
	}

	// The browser fires this when it starts evicting oldest message pairs to fit
	// an incoming prompt. Flag it so we auto-compact as soon as the current
	// response finishes, instead of letting history be silently dropped.
	private onContextOverflow(): void {
		this.overflowed = true;
		this.hooks.onContextChange?.();
	}

	// -------------------------------------------------------------------------
	// Session compaction (Summarizer API + Language Detector API)
	// -------------------------------------------------------------------------

	private async ensureLanguageDetector(): Promise<LanguageDetector | null> {
		if (!this.supportsLanguageDetector) return null;
		if (this.languageDetector) return this.languageDetector;
		try {
			this.languageDetector = await LanguageDetector.create();
			return this.languageDetector;
		} catch {
			return null;
		}
	}

	private async detectLanguage(text: string): Promise<string> {
		const detector = await this.ensureLanguageDetector();
		if (!detector) return navigator.language;
		try {
			const results = await detector.detect(text);
			if (results.length > 0 && (results[0].confidence ?? 0) >= 0.7) {
				return results[0].detectedLanguage ?? navigator.language;
			}
		} catch {
			/* ignore */
		}
		return navigator.language;
	}

	// Cache summarizers per format+lang. Prefer the smaller, faster model and
	// fall back to the default if it doesn't support the detected language.
	private async getSummarizer(format: SummarizerFormat, lang: string): Promise<Summarizer | null> {
		const key = `${format}:${lang}`;
		const cached = this.summarizers.get(key);
		if (cached) return cached;

		const baseOptions = {
			type: "tldr" as const,
			format,
			length: "short" as const,
			expectedInputLanguages: [lang],
			expectedContextLanguages: [lang],
			outputLanguage: lang,
		};

		let options: SummarizerCreateCoreOptions = { ...baseOptions, preference: "speed" };
		let avail: TAvailability;
		try {
			avail = await Summarizer.availability(options);
		} catch {
			avail = "unavailable";
		}
		if (avail === "unavailable") {
			options = { ...baseOptions, preference: "auto" };
			try {
				avail = await Summarizer.availability(options);
			} catch {
				avail = "unavailable";
			}
		}
		// Only compact when the summarizer model is already downloaded; never
		// trigger a surprise download mid-conversation.
		if (avail !== "available") return null;

		const summarizer = await Summarizer.create(options);
		this.summarizers.set(key, summarizer);
		return summarizer;
	}

	private async summarizeOne(msg: TChatMessage): Promise<TPromptTurn> {
		const lang = await this.detectLanguage(msg.content);
		const parts = splitByCodeFences(msg.content);
		let result = "";
		for (const part of parts) {
			if (part.type === "code") {
				result += part.content;
				continue;
			}
			const trimmed = part.content.trim();
			if (!trimmed) {
				result += part.content;
				continue;
			}
			try {
				const summarizer = await this.getSummarizer(looksLikeMarkdown(trimmed) ? "markdown" : "plain-text", lang);
				if (!summarizer) {
					result += part.content;
					continue;
				}
				const summary = (
					await summarizer.summarize(trimmed, {
						context: `This is a ${msg.role} turn from a chat conversation. Preserve its key meaning as concisely as possible.`,
					})
				).trim();
				result += summary && summary.length < trimmed.length ? summary : part.content;
			} catch {
				result += part.content;
			}
		}
		const compacted = result.trim();
		return { role: msg.role, content: compacted || msg.content };
	}

	// Summarize only the turns not already covered by a previous compaction,
	// then merge with the existing summaries.
	private async summarizeMessages(conv: TConversation): Promise<TPromptTurn[]> {
		const start = conv.compaction?.upTo ?? 0;
		const out: TPromptTurn[] = conv.compaction ? [...conv.compaction.prompts] : [];
		for (let i = start; i < conv.messages.length; i++) {
			const msg = conv.messages[i];
			if (msg.error || !msg.content.trim()) continue;
			out.push(await this.summarizeOne(msg));
		}
		return out;
	}

	private async compactConversation(conv: TConversation): Promise<boolean> {
		if (this._compacting || !this.supportsSummarizer) return false;
		if (conv.messages.length === 0) return false;

		this._compacting = true;
		this.hooks.onCompactingChange?.(true);
		this.hooks.onCompactStatus?.("Summarizing older messages to free up context…");
		try {
			const prompts = await this.summarizeMessages(conv);
			conv.compaction = { upTo: conv.messages.length, prompts };
			conv.updatedAt = Date.now();
			store.save();

			// Destroy the old session and seed a fresh one anchored on the summaries.
			this.destroySession(conv.id);
			try {
				await this.createSessionFor(conv, 0);
				this.hooks.onCompactStatus?.("Context compacted. Conversation continues.", 2500);
				return true;
			} catch {
				// New session creation failed (e.g. summaries still too large). Roll
				// back; the next message rebuilds lazily from the full history.
				conv.compaction = undefined;
				store.save();
				this.hooks.onCompactStatus?.("Couldn't compact context right now.", 3000);
				return false;
			}
		} catch {
			this.hooks.onCompactStatus?.("Couldn't compact context right now.", 3000);
			return false;
		} finally {
			this._compacting = false;
			this.overflowed = false;
			this.hooks.onCompactingChange?.(false);
		}
	}

	destroySummarizers(): void {
		for (const [, s] of this.summarizers) {
			try {
				s.destroy();
			} catch {
				/* ignore */
			}
		}
		this.summarizers.clear();
		if (this.languageDetector) {
			try {
				this.languageDetector.destroy();
			} catch {
				/* ignore */
			}
			this.languageDetector = null;
		}
	}
}

function looksLikeMarkdown(text: string): boolean {
	return /(?:^#{1,6} |^[-*+] |\d+\. |\*\*|__|\[.+?\]\(|^> |^```)/m.test(text);
}

type TTextSegment = { type: "prose" | "code"; content: string };

// Split a message into alternating prose and fenced-code segments so code
// blocks pass through compaction untouched while prose is summarized.
function splitByCodeFences(text: string): TTextSegment[] {
	const parts: TTextSegment[] = [];
	const re = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		if (match.index > lastIndex) parts.push({ type: "prose", content: text.slice(lastIndex, match.index) });
		parts.push({ type: "code", content: match[0] });
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) parts.push({ type: "prose", content: text.slice(lastIndex) });
	return parts;
}
