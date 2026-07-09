import { locale, t } from "./i18n";

export function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Friendly relative time for unix-seconds timestamps. */
export function formatTime(secs: number | null): string {
  if (!secs) return "";
  const ms = secs * 1000;
  const diff = Date.now() - ms;
  const min = 60_000,
    hour = 3_600_000,
    day = 86_400_000;
  if (diff < min) return t("justNow");
  if (diff < hour) return t("minutesAgo")(Math.floor(diff / min));
  if (diff < day) return t("hoursAgo")(Math.floor(diff / hour));
  if (diff < 7 * day) return t("daysAgo")(Math.floor(diff / day));
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Parent directory of an absolute path, for display. */
export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Last path segment (folder name) for sidebar labels. */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}
