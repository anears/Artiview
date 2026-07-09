import { useState } from "react";
import { t } from "../i18n";
import type { LangSetting, ThemeSetting } from "../settings";
import { loadLang, loadTheme, saveLang, saveTheme } from "../settings";

interface Props {
  onClose: () => void;
}

/** App preferences. Deliberately tiny — every knob is a maintenance surface.
 * Choices are staged locally and only saved when the user confirms; Cancel
 * (or Esc) discards them. */
export default function SettingsModal({ onClose }: Props) {
  const [lang, setLang] = useState<LangSetting>(loadLang);
  const [theme, setTheme] = useState<ThemeSetting>(loadTheme);

  // Language names are shown in their own language on purpose (a user stuck
  // in the wrong locale must be able to find their way back).
  const langOptions: [LangSetting, string][] = [
    ["auto", t("langAuto")],
    ["en", "English"],
    ["ko", "한국어"],
  ];

  const themeOptions: [ThemeSetting, string][] = [
    ["auto", t("themeAuto")],
    ["light", t("themeLight")],
    ["dark", t("themeDark")],
  ];

  const apply = () => {
    const changed = lang !== loadLang() || theme !== loadTheme();
    if (!changed) return onClose();
    saveLang(lang);
    saveTheme(theme);
    // Both settings are resolved once at module load (dictionary, palette,
    // rendered markdown frames), so a reload is the simplest correct way to
    // re-render everything coherently. It also closes the modal.
    location.reload();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>⚙ {t("settings")}</span>
          <button className="mini-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="form-field">
          <label className="form-label">{t("settingsLanguage")}</label>
          <div className="radio-row">
            {langOptions.map(([value, label]) => (
              <label key={value} className="radio-opt">
                <input
                  type="radio"
                  name="language"
                  checked={lang === value}
                  onChange={() => setLang(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">{t("settingsTheme")}</label>
          <div className="radio-row">
            {themeOptions.map(([value, label]) => (
              <label key={value} className="radio-opt">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === value}
                  onChange={() => setTheme(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="form-hint">{t("settingsReloadHint")}</div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            {t("ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
