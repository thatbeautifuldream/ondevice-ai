import { PromptApiProvider, type TModelProvider } from "./provider";

export type TModelKind = "prompt-api" | "webllm";

export type TModelInfo = {
	id: string; // For WebLLM models this is the exact MLC model id.
	kind: TModelKind;
	label: string;
	description?: string;
	downloadMB?: number;
	lowResource?: boolean;
	cached?: boolean;
};

export const BUILT_IN_MODEL_ID = "built-in";

// The Prompt API never reports which model backs it, so the name is derived
// from the browser: Chrome ships Gemini Nano, Edge ships Phi-4-mini.
export function builtInModelName(): string {
	if (typeof navigator === "undefined") return "Browser built-in";
	const ua = navigator.userAgent;
	if (ua.includes("Edg/")) return "Phi-4-mini";
	if (ua.includes("Chrome/")) return "Gemini Nano";
	return "Browser built-in";
}

export const BUILT_IN_MODEL: TModelInfo = {
	id: BUILT_IN_MODEL_ID,
	kind: "prompt-api",
	label: builtInModelName(),
	description: "The browser's own model, downloaded and managed by the browser itself.",
};

export function supportsWebGPU(): boolean {
	return typeof navigator !== "undefined" && "gpu" in navigator;
}

// The selectable catalog: the built-in model plus every prebuilt model WebLLM
// ships. The WebLLM runtime is imported lazily so the chat page only pays for
// it when the catalog is listed or a downloadable model is selected.
export async function loadCatalog(): Promise<TModelInfo[]> {
	if (!supportsWebGPU()) return [BUILT_IN_MODEL];
	try {
		const webllm = await import("./webllm");
		return [BUILT_IN_MODEL, ...(await webllm.listModels())];
	} catch {
		return [BUILT_IN_MODEL];
	}
}

export function modelLabel(id: string): string {
	return id === BUILT_IN_MODEL_ID ? BUILT_IN_MODEL.label : id.replace(/-MLC$/, "");
}

const providers = new Map<string, Promise<TModelProvider>>();

export function getProvider(modelId: string): Promise<TModelProvider> {
	let cached = providers.get(modelId);
	if (!cached) {
		cached =
			modelId === BUILT_IN_MODEL_ID
				? Promise.resolve(new PromptApiProvider())
				: import("./webllm").then((m) => new m.WebLLMProvider(modelId));
		providers.set(modelId, cached);
	}
	return cached;
}
