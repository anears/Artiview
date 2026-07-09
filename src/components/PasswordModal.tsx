import { useState } from "react";
import { t } from "../i18n";

interface Props {
  hostkey: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** Prompt for an SSH password (kept in memory for this app run only). */
export default function PasswordModal({ hostkey, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState("");

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{t("passwordModalTitle")}</span>
          <button className="mini-btn" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="modal-sub">{hostkey}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) onSubmit(password);
          }}
        >
          <div className="form-field">
            <input
              className="form-input"
              type="password"
              autoFocus
              placeholder={t("passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn primary" disabled={!password}>
              {t("ok")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
