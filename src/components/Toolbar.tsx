import { t } from "../i18n";
import type { SortKey, SortSpec } from "../types";
import { SORT_KEYS } from "../types";

interface Props {
  title: string;
  count: number;
  query: string;
  setQuery: (q: string) => void;
  layout: "grid" | "list";
  setLayout: (l: "grid" | "list") => void;
  sort: SortSpec;
  onSortKey: (key: SortKey) => void;
  onSortDir: () => void;
  onOpenFile: () => void;
  onRescan: () => void;
  scanning: boolean;
}

export default function Toolbar({
  title,
  count,
  query,
  setQuery,
  layout,
  setLayout,
  sort,
  onSortKey,
  onSortDir,
  onOpenFile,
  onRescan,
  scanning,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <h1>{title}</h1>
        <span className="count">{t("fileCount")(count)}</span>
      </div>

      <div className="search">
        <span className="search-ico">⌕</span>
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery("")} title={t("clear")}>
            ×
          </button>
        )}
      </div>

      <div className="toolbar-actions">
        <div className="sort" title={t("sortTip")}>
          <select value={sort.key} onChange={(e) => onSortKey(e.target.value as SortKey)}>
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t("sortLabels")[k]}
              </option>
            ))}
          </select>
          <button
            className="sort-dir"
            title={sort.asc ? t("sortAscTip") : t("sortDescTip")}
            onClick={onSortDir}
          >
            {sort.asc ? "↑" : "↓"}
          </button>
        </div>
        <div className="seg">
          <button
            className={layout === "grid" ? "on" : ""}
            title={t("gridViewTip")}
            onClick={() => setLayout("grid")}
          >
            ▦
          </button>
          <button
            className={layout === "list" ? "on" : ""}
            title={t("listViewTip")}
            onClick={() => setLayout("list")}
          >
            ☰
          </button>
        </div>
        <button className="btn" onClick={onRescan} disabled={scanning} title={t("rescanTip")}>
          <span className={scanning ? "spin" : ""}>↻</span> {scanning ? t("scanning") : t("refresh")}
        </button>
        <button className="btn primary" onClick={onOpenFile} title={t("openFileTip")}>
          {t("openFile")}
        </button>
      </div>
    </header>
  );
}
