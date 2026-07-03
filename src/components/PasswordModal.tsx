import { useState } from "react";

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
          <span>🔒 SSH 비밀번호</span>
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
              placeholder="앱 실행 중에만 기억되며 저장되지 않습니다"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel}>
              취소
            </button>
            <button type="submit" className="btn primary" disabled={!password}>
              확인
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
