// Protocol-agnostic tool registry. Tools know nothing about models or
// providers; the tool-call protocol layer describes them to whatever model is
// active and routes calls back here.
export type TTool = {
	name: string;
	description: string;
	// JSON Schema for the tool's arguments object.
	argsSchema: Record<string, unknown>;
	execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
};

export type TToolResult = {
	tool: string;
	args: Record<string, unknown>;
	ok: boolean;
	content: string;
};

// Execute a named tool, normalizing every failure except aborts into an
// ok:false result so the agent loop can always feed something back to the
// model instead of crashing the turn.
export async function executeTool(
	tools: TTool[],
	name: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<TToolResult> {
	const tool = tools.find((t) => t.name === name);
	if (!tool) {
		const available = tools.map((t) => t.name).join(", ");
		return { tool: name, args, ok: false, content: `Unknown tool "${name}". Available tools: ${available}.` };
	}
	try {
		const content = await tool.execute(args ?? {}, signal);
		return { tool: name, args, ok: true, content };
	} catch (err) {
		if ((err as DOMException)?.name === "AbortError") throw err;
		const message = err instanceof Error ? err.message : "unknown error";
		return { tool: name, args, ok: false, content: `Tool "${name}" failed: ${message}` };
	}
}
