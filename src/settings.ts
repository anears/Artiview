// Typed localStorage-backed UI preferences. These are per-machine viewing
// habits (language, layout, sort), so they live in the webview's storage
// rather than the library database.

import type { NavKind, SortSpec } from "./types";
import { SORT_KEYS } from "./types";

export type LangSetting = "auto" | "en" | "ko";
export type ThemeSetting = "auto" | "light" | "dark";

const LANG_KEY = "artiview.lang";
const THEME_KEY = "artiview.theme";
const LAYOUT_KEY = "artiview.layout";
const SORT_KEY = "artiview.sort";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preferences just don't stick */
  }
}

export function loadLang(): LangSetting {
  const v = read(LANG_KEY);
  return v === "en" || v === "ko" ? v : "auto";
}

export function saveLang(v: LangSetting) {
  write(LANG_KEY, v === "auto" ? null : v);
}

export function loadTheme(): ThemeSetting {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

export function saveTheme(v: ThemeSetting) {
  write(THEME_KEY, v === "auto" ? null : v);
}

export function loadLayout(): "grid" | "list" {
  return read(LAYOUT_KEY) === "list" ? "list" : "grid";
}

export function saveLayout(v: "grid" | "list") {
  write(LAYOUT_KEY, v);
}

/** Per-view sort choices. A view absent from the map uses its own default
 *  order (recent → last opened, others → modified), which is why the recent
 *  view must not share a single global sort with the rest. */
export type SortMap = Partial<Record<NavKind, SortSpec>>;

function isSortSpec(v: unknown): v is SortSpec {
  return (
    typeof v === "object" &&
    v !== null &&
    SORT_KEYS.includes((v as SortSpec).key) &&
    typeof (v as SortSpec).asc === "boolean"
  );
}

export function loadSort(): SortMap {
  const raw = read(SORT_KEY);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    // Ignore anything that isn't a plain object — including the old single-spec
    // format ({key, asc}) from before per-view sorts, which just resets to
    // defaults rather than crashing.
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const out: SortMap = {};
      for (const [k, spec] of Object.entries(v)) {
        if (isSortSpec(spec)) out[k as NavKind] = spec;
      }
      return out;
    }
  } catch {
    /* corrupt value — fall back to the defaults */
  }
  return {};
}

export function saveSort(v: SortMap) {
  write(SORT_KEY, Object.keys(v).length === 0 ? null : JSON.stringify(v));
}
