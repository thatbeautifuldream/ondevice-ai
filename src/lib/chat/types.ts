export type TToolUse = {
	tool: string;
	args: Record<string, unknown>;
	// Undefined while the tool is still running.
	ok?: boolean;
	result?: string;
};

export type TChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	streaming?: boolean;
	error?: boolean;
	tools?: TToolUse[];
	// Model id that produced this assistant message.
	model?: string;
};

// A prompt turn as fed to the Prompt API (compaction summaries, history replay).
export type TPromptTurn = {
	role: "user" | "assistant";
	content: string;
};

export type TInitialPrompt = {
	role: "system" | "user" | "assistant";
	content: string;
};

export type TCompaction = {
	// messages[0..upTo) are represented by `prompts` (summaries); the rest are
	// carried verbatim. The original messages always remain in `messages`.
	upTo: number;
	prompts: TPromptTurn[];
};

export type TConversation = {
	id: string;
	title: string;
	messages: TChatMessage[];
	createdAt: number;
	updatedAt: number;
	compaction?: TCompaction;
};

export type TSettings = {
	systemPrompt: string;
	temperature: number;
	topK: number;
	modelId: string;
	toolsEnabled: boolean;
};
