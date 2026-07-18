export type TTheme = "light" | "dark";
export type TThemePreference = TTheme | "system";

let activeTransition: ViewTransition | null = null;

function systemTheme(): TTheme {
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getTheme(): TTheme {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

// "system" is stored as the absence of a value, so the pre-paint script in
// Layout.astro and its change listener keep following the OS.
export function getThemePreference(): TThemePreference {
	const stored = localStorage.getItem("theme");
	return stored === "light" || stored === "dark" ? stored : "system";
}

// Theme switch via the View Transition API. The wipe animation lives in
// global.css; the theme-transition class selects its diagonal variant over
// the left-to-right one used for page navigations.
export function setTheme(preference: TThemePreference): TTheme {
	const root = document.documentElement;
	const next: TTheme = preference === "system" ? systemTheme() : preference;
	const apply = () => {
		root.classList.toggle("dark", next === "dark");
		if (preference === "system") localStorage.removeItem("theme");
		else localStorage.setItem("theme", preference);
		window.dispatchEvent(new Event("themechange"));
	};

	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (!document.startViewTransition || reduced || next === getTheme()) {
		apply();
		return next;
	}

	root.classList.add("theme-transition");
	const transition = document.startViewTransition(apply);
	activeTransition = transition;
	// A rapid second toggle skips this transition and fires its finished
	// callback while the new one is still running — only the latest
	// transition may clean up the class, or the page-transition CSS takes
	// over mid-wipe.
	transition.finished.finally(() => {
		if (activeTransition === transition) {
			activeTransition = null;
			root.classList.remove("theme-transition");
		}
	});
	return next;
}

export function toggleTheme(): TTheme {
	return setTheme(getTheme() === "dark" ? "light" : "dark");
}
