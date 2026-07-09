// Typed localStorage-backed UI preferences. These are per-machine viewing
// habits (language, layout, sort), so they live in the webview's storage
// rather than the library database.

import type { SortSpec } from "./types";
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

/** Last explicit sort choice; null = each view's own default order. */
export function loadSort(): SortSpec | null {
  const raw = read(SORT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (SORT_KEYS.includes(v?.key) && typeof v?.asc === "boolean") {
      return { key: v.key, asc: v.asc };
    }
  } catch {
    /* corrupt value — fall back to the default */
  }
  return null;
}

export function saveSort(v: SortSpec | null) {
  write(SORT_KEY, v === null ? null : JSON.stringify(v));
}
