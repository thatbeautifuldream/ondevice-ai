export type TTheme = "light" | "dark";
export type TThemePreference = TTheme | "system";

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

// Theme switch via the View Transition API: the new theme wipes in behind a
// soft-edged diagonal band sweeping from the bottom-left corner to the
// top-right. The band is a gradient mask (see global.css); animating its
// position slides the blurred edge across the viewport.
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

	const styles = getComputedStyle(root);
	const duration = parseFloat(styles.getPropertyValue("--theme-wipe-dur")) || 900;
	const easing =
		styles.getPropertyValue("--theme-wipe-ease").trim() ||
		"cubic-bezier(0.22, 1, 0.36, 1)";

	root.classList.add("theme-transition");
	const transition = document.startViewTransition(apply);
	transition.ready.then(() => {
		root.animate(
			{ maskPosition: ["100% 0%", "0% 100%"] },
			{
				duration,
				easing,
				fill: "forwards",
				pseudoElement: "::view-transition-new(root)",
			},
		);
	});
	transition.finished.finally(() => root.classList.remove("theme-transition"));
	return next;
}

export function toggleTheme(): TTheme {
	return setTheme(getTheme() === "dark" ? "light" : "dark");
}
