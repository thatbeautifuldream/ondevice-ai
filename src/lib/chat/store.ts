import { resolveModelId } from "./models";
import type { TConversation, TInitialPrompt, TSettings } from "./types";

const STORAGE_CONVOS = "oda.conversations.v1";
const STORAGE_SETTINGS = "oda.settings.v1";

export const DEFAULT_SYSTEM =
	"You are a helpful, friendly assistant running entirely on the user's device. Keep responses concise and clear. Use Markdown when it helps readability.";

let conversations: TConversation[] = [];
let currentId: string | null = null;

export function uid(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadSettings(): TSettings {
	try {
		const raw = localStorage.getItem(STORAGE_SETTINGS);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<TSettings>;
			return {
				systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : DEFAULT_SYSTEM,
				temperature: typeof parsed.temperature === "number" ? parsed.temperature : 1,
				topK: typeof parsed.topK === "number" ? parsed.topK : 3,
				modelId: resolveModelId(typeof parsed.modelId === "string" ? parsed.modelId : ""),
				toolsEnabled: typeof parsed.toolsEnabled === "boolean" ? parsed.toolsEnabled : true,
			};
		}
	} catch {
		/* ignore */
	}
	return { systemPrompt: DEFAULT_SYSTEM, temperature: 1, topK: 3, modelId: resolveModelId(), toolsEnabled: true };
}

export function saveSettings(settings: TSettings): void {
	try {
		localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
	} catch {
		/* ignore */
	}
}

export function load(): void {
	try {
		const raw = localStorage.getItem(STORAGE_CONVOS);
		conversations = raw ? (JSON.parse(raw) as TConversation[]) : [];
	} catch {
		conversations = [];
	}
}

export function save(): void {
	try {
		localStorage.setItem(STORAGE_CONVOS, JSON.stringify(conversations));
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export function list(): TConversation[] {
	return conversations;
}

export function getCurrentId(): string | null {
	return currentId;
}

export function setCurrent(id: string | null): void {
	currentId = id;
}

export function current(): TConversation | null {
	return conversations.find((c) => c.id === currentId) ?? null;
}

export function create(): TConversation {
	const conv: TConversation = {
		id: uid(),
		title: "New chat",
		messages: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	conversations.unshift(conv);
	currentId = conv.id;
	save();
	return conv;
}

// Switch to a fresh chat. No conversation is created until the first message
// is sent (sendMessage calls create() then), so empty drafts never appear in
// the sidebar. Any stale empty conversations from storage are pruned here.
export function startNew(): void {
	conversations = conversations.filter((c) => c.messages.length > 0);
	currentId = null;
	save();
}

export function remove(id: string): void {
	const idx = conversations.findIndex((c) => c.id === id);
	if (idx === -1) return;
	conversations.splice(idx, 1);
	if (currentId === id) currentId = conversations[0]?.id ?? null;
	save();
}

// ---------------------------------------------------------------------------
// Prompt derivation
// ---------------------------------------------------------------------------

// Derive the initialPrompts payload for a Prompt API session from stored
// history: system prompt, compaction summaries anchoring the oldest turns,
// then verbatim messages (excluding the trailing `excludeLastN`).
export function buildInitialPrompts(
	conv: TConversation,
	systemPrompt: string,
	excludeLastN = 0,
): TInitialPrompt[] {
	const msgs: TInitialPrompt[] = [];
	const sys = systemPrompt.trim();
	if (sys) msgs.push({ role: "system", content: sys });
	// Compacted summaries replace the oldest turns; they are never evicted at
	// runtime, so they stay permanently anchored in context.
	const rawStart = conv.compaction?.upTo ?? 0;
	const start = Math.min(rawStart, conv.messages.length);
	if (conv.compaction) {
		for (const p of conv.compaction.prompts) msgs.push({ role: p.role, content: p.content });
	}
	const end = Math.max(start, conv.messages.length - excludeLastN);
	for (let i = start; i < end; i++) {
		const m = conv.messages[i];
		// Error bubbles and empty placeholders are UI artifacts, never model turns.
		if (m.error || !m.content.trim()) continue;
		msgs.push({ role: m.role, content: m.content });
	}
	return msgs;
}
