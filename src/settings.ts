// Typed localStorage-backed UI preferences. These are per-machine viewing
// habits, so they live in the webview's storage rather than the library
// database.

export type LangSetting = "auto" | "en" | "ko";

const LANG_KEY = "artiview.lang";

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
