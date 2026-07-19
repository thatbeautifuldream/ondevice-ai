import type { TAvailability, TModelParams } from "./agent";
import type { TInitialPrompt } from "./types";

export type TSessionPromptOptions = {
	signal?: AbortSignal;
	responseConstraint?: Record<string, unknown>;
};

// The subset of a model session the agent depends on. Each runtime (Prompt
// API, WebLLM) adapts its own session shape to this interface.
export type TModelSession = {
	promptStreaming(prompt: string, options?: TSessionPromptOptions): ReadableStream<string>;
	clone(): Promise<TModelSession>;
	destroy(): void;
	readonly contextUsage?: number;
	readonly contextWindow?: number;
	oncontextoverflow: (() => void) | null;
};

export type TCreateSessionOptions = {
	initialPrompts: TInitialPrompt[];
	temperature?: number;
	topK?: number;
	signal?: AbortSignal;
	onDownloadProgress?: (fraction: number) => void;
};

export type TModelProvider = {
	availability(): Promise<TAvailability>;
	params(): Promise<TModelParams | null>;
	createSession(options: TCreateSessionOptions): Promise<TModelSession>;
};

class PromptApiSession implements TModelSession {
	oncontextoverflow: (() => void) | null = null;

	constructor(private readonly inner: LanguageModel) {
		this.inner.oncontextoverflow = () => this.oncontextoverflow?.();
	}

	promptStreaming(prompt: string, options?: TSessionPromptOptions): ReadableStream<string> {
		const promptOptions: LanguageModelPromptOptions = { signal: options?.signal };
		if (options?.responseConstraint) promptOptions.responseConstraint = options.responseConstraint;
		return this.inner.promptStreaming(prompt, promptOptions);
	}

	async clone(): Promise<TModelSession> {
		return new PromptApiSession(await this.inner.clone());
	}

	destroy(): void {
		this.inner.destroy();
	}

	get contextUsage(): number | undefined {
		return typeof this.inner.contextUsage === "number" ? this.inner.contextUsage : undefined;
	}

	get contextWindow(): number | undefined {
		return typeof this.inner.contextWindow === "number" ? this.inner.contextWindow : undefined;
	}
}

// The browser's built-in model behind the Prompt API (Gemini Nano in Chrome,
// Phi in Edge). The browser manages the download and session state natively.
export class PromptApiProvider implements TModelProvider {
	async availability(): Promise<TAvailability> {
		try {
			return await LanguageModel.availability();
		} catch {
			return "unavailable";
		}
	}

	async params(): Promise<TModelParams | null> {
		// params() is restricted to extension / origin-trial contexts.
		if (typeof LanguageModel.params === "function") {
			try {
				const p = await LanguageModel.params();
				if (p && typeof p.defaultTemperature === "number") {
					return {
						defaultTemperature: p.defaultTemperature,
						maxTemperature: p.maxTemperature ?? 2,
						defaultTopK: p.defaultTopK ?? 3,
						maxTopK: p.maxTopK ?? 128,
					};
				}
			} catch {
				// Restricted context: fall through to defaults.
			}
		}
		return null;
	}

	async createSession(options: TCreateSessionOptions): Promise<TModelSession> {
		const createOptions: Record<string, unknown> = {
			initialPrompts: options.initialPrompts,
			signal: options.signal,
			monitor: (m: CreateMonitor) => {
				m.addEventListener("downloadprogress", (e: ProgressEvent) => {
					const loaded = typeof e.loaded === "number" ? e.loaded : 0;
					options.onDownloadProgress?.(loaded);
				});
			},
		};
		if (typeof options.temperature === "number") createOptions.temperature = options.temperature;
		if (typeof options.topK === "number") createOptions.topK = options.topK;
		const session = await LanguageModel.create(createOptions as LanguageModelCreateOptions);
		return new PromptApiSession(session);
	}
}
