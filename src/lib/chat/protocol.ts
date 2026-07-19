import type { TTool, TToolResult } from "./tools";

// Provider-agnostic tool-call protocol: Hermes/Qwen-style <tool_call> tags
// over unconstrained generation — the format small local models are actually
// trained on. Plain replies stream through untouched; malformed calls get one
// constrained repair turn (responseConstraint / WebLLM JSON mode). Swapping
// this protocol out (e.g. for the Prompt API's future native `tools`) touches
// nothing but this file.

export const MAX_TOOL_STEPS = 5;

const OPEN_TAG = "<tool_call>";

function stripReasoning(text: string): string {
	return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "");
}

// Opening-tag prefixes held back from the visible stream: tool calls,
// reasoning blocks from thinking models (Qwen3 etc.), fabricated
// tool-response markup, and XML-style pseudo-calls some models (Llama
// family) emit using the tool's own name as a tag.
function hiddenPrefixes(toolNames: string[]): string[] {
	return ["<tool_call", "<think", "<tool_response", ...toolNames.map((n) => `<${n}`)];
}

export type TParsedTurn =
	| { kind: "reply"; text: string }
	| { kind: "tool_call"; tool: string; args: Record<string, unknown> }
	| { kind: "malformed"; raw: string };

export function toolSystemPrompt(tools: TTool[]): string {
	const defs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.argsSchema }));
	const first = tools[0];
	const firstArg = Object.keys((first?.argsSchema as { properties?: Record<string, unknown> })?.properties ?? {})[0];
	const example = JSON.stringify({
		name: first?.name ?? "tool_name",
		arguments: firstArg ? { [firstArg]: "current president of Iceland" } : {},
	});
	return [
		"You have access to tools.",
		"",
		"<tools>",
		JSON.stringify(defs),
		"</tools>",
		"",
		"To call a tool, output exactly one tool call and nothing else:",
		`${OPEN_TAG}${example}</tool_call>`,
		"Then stop. The result arrives in a <tool_response> block; answer the user based on it.",
		"",
		"Rules:",
		"- Use a tool whenever the question involves specific facts, numbers, people, places, dates, or events — anything you might misremember.",
		"- If the question needs no facts (writing, coding, opinions, chit-chat), answer directly in plain text with no tags.",
		"- Call at most one tool per turn.",
		"- Never write a <tool_response> block yourself — tool results are provided to you, not invented by you.",
		"",
		"Examples:",
		'User: "Who is the president of Iceland?" → you output:',
		`${OPEN_TAG}${example}</tool_call>`,
		'User: "Write a haiku about rain." → you answer directly, no tool call.',
	].join("\n");
}

/** Parse JSON without throwing; returns null on any failure. */
function tryParseJson(raw: string): Record<string, unknown> | null {
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function tolerantJson(raw: string): Record<string, unknown> | null {
	return tryParseJson(raw) ?? tryParseJson(raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
}

// Parse a completed model turn. Tolerant across the wire formats small
// models actually emit: a tagged JSON call (with or without the closing
// tag), a bare JSON call object with a `name` field, or an XML-style
// pseudo-call using the tool's name as a tag with attribute args
// (`<wikipedia_read title="...">`). A turn containing fabricated tool
// markup that doesn't parse as a call is malformed, never a reply.
export function parseTurn(text: string, toolNames: string[] = []): TParsedTurn {
	const trimmed = stripReasoning(text).trim();
	const tag = trimmed.match(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/);
	const raw = tag ? tag[1] : trimmed.startsWith("{") ? trimmed : null;
	if (raw !== null) {
		const obj = tolerantJson(raw);
		const name = obj && typeof obj.name === "string" ? obj.name : null;
		if (!obj || !name) {
			// A bare object that isn't a call is just a reply; an empty or broken
			// tagged call needs repair.
			return tag ? { kind: "malformed", raw } : { kind: "reply", text: stripToolMarkup(trimmed, toolNames) };
		}
		const args = obj.arguments ?? obj.args ?? obj.parameters ?? {};
		return {
			kind: "tool_call",
			tool: name,
			args: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
		};
	}
	for (const name of toolNames) {
		const xml = trimmed.match(new RegExp(`<${name}\\b([^>]*)>`));
		if (xml) {
			const args: Record<string, unknown> = {};
			for (const attr of xml[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) args[attr[1]] = attr[2];
			if (Object.keys(args).length > 0) return { kind: "tool_call", tool: name, args };
			return { kind: "malformed", raw: xml[0] };
		}
	}
	if (trimmed.includes("<tool_response")) return { kind: "malformed", raw: trimmed.slice(0, 200) };
	return { kind: "reply", text: stripToolMarkup(trimmed, toolNames) };
}

// What to show the user while a turn streams: everything before a (possibly
// still incomplete) tool-call tag, and nothing when the turn looks like a
// bare JSON call.
export function visibleText(acc: string, toolNames: string[] = []): string {
	if (/^\s*\{/.test(acc)) return "";
	let text = stripReasoning(acc);
	const prefixes = hiddenPrefixes(toolNames);
	for (const prefix of prefixes) {
		const idx = text.indexOf(prefix);
		if (idx !== -1) text = text.slice(0, idx);
	}
	// Hold back a partially streamed opening tag at the tail.
	outer: for (const prefix of prefixes) {
		for (let k = Math.min(text.length, prefix.length); k > 0; k--) {
			if (text.endsWith(prefix.slice(0, k))) {
				text = text.slice(0, text.length - k);
				break outer;
			}
		}
	}
	return text;
}

// Remove tool markup from a turn that must be treated as the final reply,
// including XML-style pseudo-tags named after the tools themselves.
export function stripToolMarkup(text: string, toolNames: string[] = []): string {
	let out = stripReasoning(text)
		.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "")
		.replace(/<\/?tool_(?:call|response)[^>]*>/g, "");
	for (const name of toolNames) {
		out = out.replace(new RegExp(`</?${name}\\b[^>]*>`, "g"), "");
	}
	return out.trim();
}

// Tool results go back as a user turn in the format Qwen/Hermes chat
// templates render the tool role as, with an explicit directive so small
// models answer from the result instead of re-calling.
export function toolResponsePrompt(result: TToolResult): string {
	return [
		`<tool_response name="${result.tool}">`,
		result.content,
		"</tool_response>",
		"",
		"Using the tool result above, answer the user's question in plain text. Only call another tool if this result is insufficient.",
	].join("\n");
}

export function repeatedCallPrompt(tool: string): string {
	return `You already called ${tool} with those exact arguments; its result is above. Answer the user's question now in plain text without calling any tools.`;
}

export function forceAnswerPrompt(): string {
	return "Answer the user's question now in plain text using the information above. Do not call any more tools.";
}

export function repairPrompt(): string {
	return 'Your last message contained invalid tool markup. Do not invent tool results. Emit only the JSON object for the tool call you want to make, in the form {"name": "...", "arguments": {...}}. The real result will be provided to you.';
}

// Constraint schema for the guaranteed-answer turn: when free-form forcing
// still yields markup-only output, one JSON-constrained turn extracts a
// plain reply the model cannot wrap in tags.
export function replySchema(): Record<string, unknown> {
	return {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
		additionalProperties: false,
	};
}

export function extractReplyText(raw: string): string {
	const obj = tolerantJson(raw);
	return obj && typeof obj.text === "string" ? obj.text.trim() : "";
}

// Constraint schema for the repair turn — a single flat object with the
// discriminating `name` first, inside both engines' supported subsets.
export function toolCallSchema(tools: TTool[]): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			name: { type: "string", enum: tools.map((t) => t.name) },
			arguments: { type: "object" },
		},
		required: ["name", "arguments"],
		additionalProperties: false,
	};
}
