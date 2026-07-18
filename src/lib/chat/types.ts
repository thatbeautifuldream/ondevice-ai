export type TChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	streaming?: boolean;
	error?: boolean;
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
};
