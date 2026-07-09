import { useState } from "react";
// Aliased: `t` is taken by the tag variable in the map callbacks below.
import { t as i18nT } from "../i18n";

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export default function TagEditor({ tags, onChange }: Props) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  };

  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="chip">
          {t}
          <button className="chip-x" onClick={() => remove(t)} title={i18nT("removeTagTip")}>
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={draft}
        placeholder={i18nT("tagPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            remove(tags[tags.length - 1]);
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
