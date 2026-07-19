// Tiny shared className helpers for the playground React apps, so the
// active/inactive pill styling doesn't drift between pages.

/** Build the class for a rounded pill button from its base + active state. */
export function pillClass(base: string, active: boolean): string {
	return active
		? `${base} bg-zinc-950/5 text-zinc-900 ring-zinc-950/15 dark:bg-white/10 dark:text-white dark:ring-white/20`
		: `${base} bg-white text-zinc-600 ring-zinc-950/10 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-white`;
}
