import type { SortKey, SortSpec } from "../types";
import { SORT_LABELS } from "../types";

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
        <span className="count">{count}개</span>
      </div>

      <div className="search">
        <span className="search-ico">⌕</span>
        <input
          type="text"
          placeholder="파일명 · 내용 전문 검색…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery("")} title="지우기">
            ×
          </button>
        )}
      </div>

      <div className="toolbar-actions">
        <div className="sort" title="정렬 기준">
          <select value={sort.key} onChange={(e) => onSortKey(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            className="sort-dir"
            title={sort.asc ? "오름차순 (누르면 내림차순)" : "내림차순 (누르면 오름차순)"}
            onClick={onSortDir}
          >
            {sort.asc ? "↑" : "↓"}
          </button>
        </div>
        <div className="seg">
          <button
            className={layout === "grid" ? "on" : ""}
            title="그리드 보기"
            onClick={() => setLayout("grid")}
          >
            ▦
          </button>
          <button
            className={layout === "list" ? "on" : ""}
            title="목록 보기"
            onClick={() => setLayout("list")}
          >
            ☰
          </button>
        </div>
        <button className="btn" onClick={onRescan} disabled={scanning} title="등록 폴더 다시 스캔">
          <span className={scanning ? "spin" : ""}>↻</span> {scanning ? "스캔 중…" : "새로고침"}
        </button>
        <button className="btn primary" onClick={onOpenFile} title="HTML 파일 열기">
          파일 열기
        </button>
      </div>
    </header>
  );
}
