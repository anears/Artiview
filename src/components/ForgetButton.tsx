import type { ReactNode } from "react";
import type { FileEntry } from "../types";

/**
 * Whether forgetting this file actually sticks. Forgetting a healthy
 * folder-managed file is silently undone by the next rescan (the folder walk
 * re-indexes it from disk, minus its tags and favorite flag), so always-visible
 * remove affordances should gate on this. Contexts that already know the file
 * is unreadable (broken cards) can render the button unconditionally.
 */
export function canForget(f: FileEntry): boolean {
  return f.missing || f.folder_id === null;
}

interface Props {
  file: FileEntry;
  className: string;
  onForget: (f: FileEntry) => void;
  children: ReactNode;
}

/** Remove-from-library button: never touches the file on disk. */
export default function ForgetButton({ file, className, onForget, children }: Props) {
  return (
    <button
      className={className}
      title="라이브러리에서 제거 (원본 파일은 삭제되지 않음)"
      onClick={(e) => {
        e.stopPropagation();
        onForget(file);
      }}
    >
      {children}
    </button>
  );
}
