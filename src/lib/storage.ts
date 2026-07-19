// Thin localStorage wrappers that never throw. Centralizes the "storage may
// be disabled / full" handling so call sites don't each wrap a try/catch.

/** Read a localStorage key; returns null when storage is unavailable. */
export function readLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Write a localStorage key, ignoring quota / disabled-storage failures. */
export function writeLocal(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Storage full or disabled; value stays in-memory only.
	}
}
