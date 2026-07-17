// Pure logic for the Writing Tools playground: a small engine over the
// Writer, Rewriter, and Proofreader built-in AI APIs, plus the option
// catalogs and the proofread-highlight segmenter. Follows the ChatAgent
// pattern: no DOM access, hooks for UI notifications, async generators for
// streaming.

export type TWritingAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export type TTool = "write" | "rewrite" | "proofread";

export type TWriterOptions = {
	tone: WriterTone;
	format: WriterFormat;
	length: WriterLength;
};

export type TRewriterOptions = {
	tone: RewriterTone;
	format: RewriterFormat;
	length: RewriterLength;
};

// Option catalogs rendered as segmented pill controls.
export const WRITER_TONES: WriterTone[] = ["formal", "neutral", "casual"];
export const WRITER_LENGTHS: WriterLength[] = ["short", "medium", "long"];
export const WRITER_FORMATS: WriterFormat[] = ["markdown", "plain-text"];
export const REWRITER_TONES: RewriterTone[] = ["as-is", "more-formal", "more-casual"];
export const REWRITER_LENGTHS: RewriterLength[] = ["as-is", "shorter", "longer"];

export function optionLabel(value: string): string {
	switch (value) {
		case "as-is":
			return "As is";
		case "more-formal":
			return "More formal";
		case "more-casual":
			return "More casual";
		case "plain-text":
			return "Plain text";
		default:
			return value.charAt(0).toUpperCase() + value.slice(1);
	}
}

export type TWritingStreamEvent =
	| { type: "chunk"; content: string } // accumulated text so far
	| { type: "done"; content: string; latencyMs: number }
	| { type: "aborted"; content: string }
	| { type: "error"; message: string };

export type TProofreadEvent =
	| { type: "done"; result: ProofreadResult; latencyMs: number }
	| { type: "aborted" }
	| { type: "error"; message: string };

export type TWritingHooks = {
	onDownloadStart?: () => void;
	onDownloadProgress?: (fraction: number) => void;
	onDownloadEnd?: () => void;
};

function friendlyError(e: unknown): string {
	const err = e as DOMException;
	if (err?.name === "QuotaExceededError") {
		return "The text is too long for the on-device model. Try a shorter passage.";
	}
	if (err?.name === "NotSupportedError") {
		return "The model couldn't handle this request. Try different text or options.";
	}
	return err?.message || "Something went wrong.";
}

export class WritingEngine {
	private readonly hooks: TWritingHooks;
	// One live instance per tool; options are baked in at create() time, so a
	// change of options destroys and recreates behind a new cache key.
	private writer: { key: string; instance: Writer } | null = null;
	private rewriter: { key: string; instance: Rewriter } | null = null;
	private proofreader: Proofreader | null = null;

	constructor(hooks: TWritingHooks = {}) {
		this.hooks = hooks;
	}

	static supported(tool: TTool): boolean {
		try {
			if (tool === "write") return typeof Writer !== "undefined";
			if (tool === "rewrite") return typeof Rewriter !== "undefined";
			return typeof Proofreader !== "undefined";
		} catch {
			return false;
		}
	}

	async availability(tool: TTool): Promise<TWritingAvailability> {
		if (!WritingEngine.supported(tool)) return "unavailable";
		try {
			if (tool === "write") return await Writer.availability();
			if (tool === "rewrite") return await Rewriter.availability();
			return await Proofreader.availability();
		} catch {
			return "unavailable";
		}
	}

	private monitor(): CreateMonitorCallback {
		return (m) => {
			m.addEventListener("downloadprogress", (e: ProgressEvent) => {
				this.hooks.onDownloadProgress?.(typeof e.loaded === "number" ? e.loaded : 0);
			});
		};
	}

	// Wrap a create() call with the download start/end hooks when the model
	// isn't resident yet.
	private async withDownload<T>(tool: TTool, create: () => Promise<T>): Promise<T> {
		const availability = await this.availability(tool);
		const needsDownload = availability === "downloadable" || availability === "downloading";
		if (needsDownload) this.hooks.onDownloadStart?.();
		try {
			return await create();
		} finally {
			if (needsDownload) this.hooks.onDownloadEnd?.();
		}
	}

	private async ensureWriter(options: TWriterOptions, signal?: AbortSignal): Promise<Writer> {
		const key = `${options.tone}:${options.format}:${options.length}`;
		if (this.writer?.key === key) return this.writer.instance;
		this.writer?.instance.destroy();
		this.writer = null;
		const instance = await this.withDownload("write", () =>
			Writer.create({ ...options, signal, monitor: this.monitor() }),
		);
		this.writer = { key, instance };
		return instance;
	}

	private async ensureRewriter(options: TRewriterOptions, signal?: AbortSignal): Promise<Rewriter> {
		const key = `${options.tone}:${options.format}:${options.length}`;
		if (this.rewriter?.key === key) return this.rewriter.instance;
		this.rewriter?.instance.destroy();
		this.rewriter = null;
		const instance = await this.withDownload("rewrite", () =>
			Rewriter.create({ ...options, signal, monitor: this.monitor() }),
		);
		this.rewriter = { key, instance };
		return instance;
	}

	private async ensureProofreader(signal?: AbortSignal): Promise<Proofreader> {
		if (this.proofreader) return this.proofreader;
		this.proofreader = await this.withDownload("proofread", () =>
			Proofreader.create({ includeCorrectionTypes: true, signal, monitor: this.monitor() }),
		);
		return this.proofreader;
	}

	// Shared streaming core for write/rewrite.
	private async *streamFrom(
		started: number,
		make: () => Promise<ReadableStream<string>>,
	): AsyncGenerator<TWritingStreamEvent, void, void> {
		let acc = "";
		try {
			const reader = (await make()).getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					acc += value;
					yield { type: "chunk", content: acc };
				}
			}
		} catch (err) {
			const e = err as DOMException;
			if (e?.name === "AbortError") {
				yield { type: "aborted", content: acc };
				return;
			}
			yield { type: "error", message: friendlyError(e) };
			return;
		}
		yield { type: "done", content: acc, latencyMs: Math.round(performance.now() - started) };
	}

	writeStream(input: {
		prompt: string;
		context?: string;
		options: TWriterOptions;
		signal?: AbortSignal;
	}): AsyncGenerator<TWritingStreamEvent, void, void> {
		return this.streamFrom(performance.now(), async () => {
			const writer = await this.ensureWriter(input.options, input.signal);
			return writer.writeStreaming(input.prompt, {
				context: input.context || undefined,
				signal: input.signal,
			});
		});
	}

	rewriteStream(input: {
		text: string;
		context?: string;
		options: TRewriterOptions;
		signal?: AbortSignal;
	}): AsyncGenerator<TWritingStreamEvent, void, void> {
		return this.streamFrom(performance.now(), async () => {
			const rewriter = await this.ensureRewriter(input.options, input.signal);
			return rewriter.rewriteStreaming(input.text, {
				context: input.context || undefined,
				signal: input.signal,
			});
		});
	}

	async proofread(input: { text: string; signal?: AbortSignal }): Promise<TProofreadEvent> {
		const started = performance.now();
		try {
			const proofreader = await this.ensureProofreader(input.signal);
			const result = await proofreader.proofread(input.text, { signal: input.signal });
			return { type: "done", result, latencyMs: Math.round(performance.now() - started) };
		} catch (err) {
			const e = err as DOMException;
			if (e?.name === "AbortError") return { type: "aborted" };
			return { type: "error", message: friendlyError(e) };
		}
	}

	destroy(): void {
		for (const d of [this.writer?.instance, this.rewriter?.instance, this.proofreader]) {
			try {
				d?.destroy();
			} catch {
				/* ignore */
			}
		}
		this.writer = null;
		this.rewriter = null;
		this.proofreader = null;
	}
}

// ---------------------------------------------------------------------------
// Proofread highlighting
// ---------------------------------------------------------------------------

export type TProofreadSegment =
	| { kind: "text"; text: string }
	| { kind: "correction"; original: string; correction: string; types: string[]; explanation?: string };

// Split the proofread input into plain and corrected segments so the UI can
// highlight each fix in place. Corrections are sorted and clamped defensively;
// overlapping or out-of-range entries are dropped.
export function buildProofreadSegments(input: string, corrections: ProofreadCorrection[]): TProofreadSegment[] {
	const segments: TProofreadSegment[] = [];
	const sorted = [...corrections].sort((a, b) => a.startIndex - b.startIndex);
	let cursor = 0;
	for (const c of sorted) {
		if (c.startIndex < cursor || c.endIndex > input.length || c.endIndex < c.startIndex) continue;
		if (c.startIndex > cursor) segments.push({ kind: "text", text: input.slice(cursor, c.startIndex) });
		segments.push({
			kind: "correction",
			original: input.slice(c.startIndex, c.endIndex),
			correction: c.correction,
			types: c.types ?? [],
			explanation: c.explanation,
		});
		cursor = c.endIndex;
	}
	if (cursor < input.length) segments.push({ kind: "text", text: input.slice(cursor) });
	return segments;
}
