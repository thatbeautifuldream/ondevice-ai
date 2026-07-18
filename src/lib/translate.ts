// Pure logic for the Translate playground: the language catalog and a small
// engine over the stable Translator + Language Detector APIs (Chrome 138+).
// Follows the ChatAgent pattern: no DOM access, hooks for UI notifications,
// async generators for streaming.

export type TTranslateAvailability = "unavailable" | "downloadable" | "downloading" | "available";

// Target languages offered in the picker. The Translator API supports 40+
// languages; this is a curated set of common BCP 47 codes.
export const TARGET_LANGUAGES = [
	"en",
	"es",
	"fr",
	"de",
	"it",
	"pt",
	"nl",
	"pl",
	"tr",
	"ru",
	"uk",
	"ar",
	"hi",
	"bn",
	"id",
	"vi",
	"th",
	"ja",
	"ko",
	"zh",
	"zh-Hant",
] as const;

const displayNames = typeof Intl !== "undefined" ? new Intl.DisplayNames(["en"], { type: "language" }) : null;

export function languageName(code: string): string {
	try {
		return displayNames?.of(code) ?? code;
	} catch {
		return code;
	}
}

export type TDetection = {
	language: string | null; // null = undetermined
	confidence: number;
};

export type TTranslateEvent =
	| { type: "chunk"; content: string } // accumulated translation so far
	| { type: "done"; content: string; latencyMs: number }
	| { type: "aborted"; content: string }
	| { type: "error"; message: string };

export type TTranslateHooks = {
	onDownloadStart?: () => void;
	onDownloadProgress?: (fraction: number) => void;
	onDownloadEnd?: () => void;
};

function friendlyError(e: unknown): string {
	const err = e as DOMException;
	if (err?.name === "NotSupportedError") {
		return "This language pair isn't supported by the on-device translator.";
	}
	if (err?.name === "QuotaExceededError") {
		return "The text is too long for the on-device translator. Try a shorter passage.";
	}
	return err?.message || "Something went wrong while translating.";
}

export class TranslateEngine {
	private readonly hooks: TTranslateHooks;
	private detector: LanguageDetector | null = null;
	// Translators are cached per language pair; each holds a downloaded pack.
	private readonly translators = new Map<string, Translator>();

	constructor(hooks: TTranslateHooks = {}) {
		this.hooks = hooks;
	}

	static supported(): boolean {
		try {
			return typeof Translator !== "undefined" && typeof LanguageDetector !== "undefined";
		} catch {
			return false;
		}
	}

	// -------------------------------------------------------------------------
	// Language detection
	// -------------------------------------------------------------------------

	private async ensureDetector(): Promise<LanguageDetector | null> {
		if (this.detector) return this.detector;
		try {
			this.detector = await LanguageDetector.create({
				monitor: (m) => {
					m.addEventListener("downloadprogress", (e: ProgressEvent) => {
						this.hooks.onDownloadProgress?.(typeof e.loaded === "number" ? e.loaded : 0);
					});
				},
			});
			return this.detector;
		} catch {
			return null;
		}
	}

	async detect(text: string): Promise<TDetection> {
		const detector = await this.ensureDetector();
		if (!detector) return { language: null, confidence: 0 };
		try {
			const results = await detector.detect(text);
			const top = results[0];
			// The detector reports "und" when it can't tell.
			if (!top?.detectedLanguage || top.detectedLanguage === "und") return { language: null, confidence: 0 };
			return { language: top.detectedLanguage, confidence: top.confidence ?? 0 };
		} catch {
			return { language: null, confidence: 0 };
		}
	}

	// -------------------------------------------------------------------------
	// Translation
	// -------------------------------------------------------------------------

	async pairAvailability(sourceLanguage: string, targetLanguage: string): Promise<TTranslateAvailability> {
		if (this.translators.has(`${sourceLanguage}:${targetLanguage}`)) return "available";
		try {
			return await Translator.availability({ sourceLanguage, targetLanguage });
		} catch {
			return "unavailable";
		}
	}

	// Create (downloading the language pack if needed) and cache the translator
	// for a pair. Chrome requires a user gesture to start a download, so the UI
	// only calls this for "downloadable" pairs from a click handler.
	// The run's abort signal is deliberately NOT forwarded to create():
	// aborting a creation signal destroys the translator it created, which
	// would poison the cache for every later run that reuses this pair.
	async ensureTranslator(sourceLanguage: string, targetLanguage: string, signal?: AbortSignal): Promise<Translator> {
		const key = `${sourceLanguage}:${targetLanguage}`;
		const cached = this.translators.get(key);
		if (cached) return cached;
		signal?.throwIfAborted();

		const availability = await this.pairAvailability(sourceLanguage, targetLanguage);
		const needsDownload = availability === "downloadable" || availability === "downloading";
		if (needsDownload) this.hooks.onDownloadStart?.();
		try {
			const translator = await Translator.create({
				sourceLanguage,
				targetLanguage,
				monitor: (m) => {
					m.addEventListener("downloadprogress", (e: ProgressEvent) => {
						this.hooks.onDownloadProgress?.(typeof e.loaded === "number" ? e.loaded : 0);
					});
				},
			});
			this.translators.set(key, translator);
			return translator;
		} finally {
			if (needsDownload) this.hooks.onDownloadEnd?.();
		}
	}

	// Stream one translation, yielding the accumulated text per chunk.
	async *translateStream(options: {
		text: string;
		sourceLanguage: string;
		targetLanguage: string;
		signal?: AbortSignal;
	}): AsyncGenerator<TTranslateEvent, void, void> {
		const started = performance.now();
		const key = `${options.sourceLanguage}:${options.targetLanguage}`;
		let acc = "";
		for (let attempt = 0; attempt < 2; attempt++) {
			acc = "";
			try {
				const translator = await this.ensureTranslator(options.sourceLanguage, options.targetLanguage, options.signal);
				const reader = translator.translateStreaming(options.text, { signal: options.signal }).getReader();
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
				// A cached translator that was destroyed (e.g. by an aborted or
				// unmounted earlier run) throws InvalidStateError: evict it and
				// retry once with a fresh instance.
				if (attempt === 0 && e?.name === "InvalidStateError") {
					this.translators.delete(key);
					continue;
				}
				yield { type: "error", message: friendlyError(e) };
				return;
			}
			yield { type: "done", content: acc, latencyMs: Math.round(performance.now() - started) };
			return;
		}
	}

	destroy(): void {
		for (const [, t] of this.translators) {
			try {
				t.destroy();
			} catch {
				/* ignore */
			}
		}
		this.translators.clear();
		if (this.detector) {
			try {
				this.detector.destroy();
			} catch {
				/* ignore */
			}
			this.detector = null;
		}
	}
}
