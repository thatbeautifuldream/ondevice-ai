// Shared defensive helpers used across the on-device engines. Centralizing
// these keeps call sites readable and gives slop scanners one place to look.

/**
 * Invoke `destroy()` on a session / translator / summarizer without surfacing
 * a teardown failure. Used in finally blocks and error paths where a secondary
 * error must never mask the original one.
 */
export function destroyQuiet(target: { destroy(): void } | null | undefined): void {
	if (!target) return;
	try {
		target.destroy();
	} catch {
		// Best-effort disposal.
	}
}

/**
 * Map a thrown value to a user-facing message using the caller's DOMException
 * name → copy table, falling back to the thrown message and then a generic.
 */
export function describeDomError(e: unknown, messages: Record<string, string>, fallback: string): string {
	const name = (e as DOMException | undefined)?.name;
	return (name && messages[name]) || (e as Error | undefined)?.message || fallback;
}
