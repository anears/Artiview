// Theme resolution: the stored setting ("auto" | "light" | "dark") becomes a
// data-theme attribute on <html>, which switches the CSS variable palette in
// styles.css. In auto mode the app chrome follows live system changes;
// already-rendered markdown iframes keep their theme until reopened.

import { loadTheme } from "./settings";

export type ResolvedTheme = "light" | "dark";

const setting = loadTheme();

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** The theme in effect right now (auto resolves against the system). */
export function resolvedTheme(): ResolvedTheme {
  return setting === "auto" ? systemTheme() : setting;
}

/** Stamp the palette on <html>. Call once before the first render. */
export function initTheme() {
  const apply = () =>
    document.documentElement.setAttribute("data-theme", resolvedTheme());
  apply();
  if (setting === "auto") {
    window
      .matchMedia("(prefers-color-scheme: light)")
      .addEventListener("change", apply);
  }
}
