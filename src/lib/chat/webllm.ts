import {
	WebWorkerMLCEngine,
	hasModelInCache,
	prebuiltAppConfig,
	type ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";
import type { TAvailability, TModelParams } from "./agent";
import type { TModelInfo } from "./models";
import type { TCreateSessionOptions, TModelProvider, TModelSession, TSessionPromptOptions } from "./provider";
import type { TInitialPrompt } from "./types";

// Every prebuilt model WebLLM ships, with its browser-cache state resolved so
// the picker can mark models that are already downloaded.
export async function listModels(): Promise<TModelInfo[]> {
	return Promise.all(
		prebuiltAppConfig.model_list.map(
			async (m): Promise<TModelInfo> => ({
				id: m.model_id,
				kind: "webllm",
				label: m.model_id.replace(/-MLC$/, ""),
				downloadMB: typeof m.vram_required_MB === "number" ? Math.round(m.vram_required_MB) : undefined,
				lowResource: m.low_resource_required,
				cached: await hasModelInCache(m.model_id, prebuiltAppConfig).catch(() => false),
			}),
		),
	);
}

// One engine (and worker) for the whole page; switching models reloads it so
// only one set of weights occupies GPU memory at a time.
let engineState: { modelId: string; engine: WebWorkerMLCEngine } | null = null;
let onProgress: ((fraction: number) => void) | null = null;

async function ensureEngine(modelId: string): Promise<WebWorkerMLCEngine> {
	if (engineState?.modelId === modelId) return engineState.engine;
	if (!engineState) {
		const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
		const engine = new WebWorkerMLCEngine(worker, {
			initProgressCallback: (report) => onProgress?.(Math.max(0, Math.min(1, report.progress))),
		});
		engineState = { modelId: "", engine };
	}
	await engineState.engine.reload(modelId);
	engineState.modelId = modelId;
	return engineState.engine;
}

function abortError(): DOMException {
	return new DOMException("The request was aborted.", "AbortError");
}

// WebLLM's chat API is stateless (full message list per request), so the
// session adapter carries the conversation turns and appends each committed
// exchange, mirroring the Prompt API's stateful session semantics.
class WebLLMSession implements TModelSession {
	oncontextoverflow: (() => void) | null = null;

	constructor(
		private readonly modelId: string,
		private turns: TInitialPrompt[],
		private readonly temperature?: number,
	) {}

	promptStreaming(prompt: string, options?: TSessionPromptOptions): ReadableStream<string> {
		const { modelId, temperature } = this;
		const turns = this.turns;
		const commit = (assistant: string) => {
			this.turns = [...turns, { role: "user", content: prompt }, { role: "assistant", content: assistant }];
		};
		const signal = options?.signal;
		const responseConstraint = options?.responseConstraint;
		return new ReadableStream<string>({
			async start(controller) {
				try {
					if (signal?.aborted) throw abortError();
					const engine = await ensureEngine(modelId);
					const chunks = await engine.chat.completions.create({
						stream: true,
						messages: [...turns, { role: "user", content: prompt }] as ChatCompletionMessageParam[],
						...(typeof temperature === "number" ? { temperature } : {}),
						...(responseConstraint
							? { response_format: { type: "json_object" as const, schema: JSON.stringify(responseConstraint) } }
							: {}),
					});
					let aborted = false;
					const onAbort = () => {
						aborted = true;
						void engine.interruptGenerate();
					};
					signal?.addEventListener("abort", onAbort, { once: true });
					let acc = "";
					try {
						for await (const chunk of chunks) {
							const delta = chunk.choices[0]?.delta?.content;
							if (delta) {
								acc += delta;
								controller.enqueue(delta);
							}
						}
					} finally {
						signal?.removeEventListener("abort", onAbort);
					}
					if (aborted || signal?.aborted) throw abortError();
					commit(acc);
					controller.close();
				} catch (err) {
					controller.error(signal?.aborted ? abortError() : err);
				}
			},
		});
	}

	async clone(): Promise<TModelSession> {
		return new WebLLMSession(this.modelId, [...this.turns], this.temperature);
	}

	destroy(): void {
		// Sessions are plain message lists; the shared engine stays loaded.
	}
}

export class WebLLMProvider implements TModelProvider {
	constructor(private readonly modelId: string) {}

	async availability(): Promise<TAvailability> {
		if (typeof navigator === "undefined" || !("gpu" in navigator)) return "unavailable";
		if (engineState?.modelId === this.modelId) return "available";
		try {
			return (await hasModelInCache(this.modelId, prebuiltAppConfig)) ? "available" : "downloadable";
		} catch {
			return "downloadable";
		}
	}

	async params(): Promise<TModelParams | null> {
		return null;
	}

	async createSession(options: TCreateSessionOptions): Promise<TModelSession> {
		onProgress = options.onDownloadProgress ?? null;
		try {
			await ensureEngine(this.modelId);
		} finally {
			onProgress = null;
		}
		return new WebLLMSession(this.modelId, [...options.initialPrompts], options.temperature);
	}
}
