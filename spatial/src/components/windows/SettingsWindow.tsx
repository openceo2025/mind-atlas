import { useEffect, useState } from 'react';
import { set, useStore } from '../../store';
import { LOCALES, LOCALE_LABELS, getLocale, setLocale, t, type Locale } from '../../i18n';
import { fetchChatOptions, type ChatService } from '../../lib/service';
import { getAiModel, setAiModel } from '../../lib/ai';
import type { FloatWin } from '../../types';

const MODEL_KEY = 'mindatlas-spatial-model';

export function loadSavedModel() {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (raw) setAiModel(JSON.parse(raw));
  } catch {
    // 既定のモデルを使う
  }
}

export function SettingsWindow(_: { win: FloatWin }) {
  const theme = useStore((s) => s.theme);
  const previewFirst = useStore((s) => s.previewFirst);
  const session = useStore((s) => s.session);
  const [services, setServices] = useState<ChatService[] | null>(null);
  const [choice, setChoice] = useState(getAiModel());

  useEffect(() => {
    if (session.mode === 'hosted' && !session.authenticated) return;
    void fetchChatOptions()
      .then(setServices)
      .catch(() => setServices([]));
  }, [session.mode, session.authenticated]);

  const pick = (provider: string, model?: string) => {
    const next = { provider, model };
    setChoice(next);
    setAiModel(next);
    try {
      localStorage.setItem(MODEL_KEY, JSON.stringify(next));
    } catch {
      // この画面の間だけ有効
    }
  };

  const service = services?.find((s) => s.id === choice.provider);

  return (
    <div className="fwin-body">
      <label className="field">
        <span>{t('settings.language')}</span>
        <select className="input" value={getLocale()} onChange={(e) => void setLocale(e.target.value as Locale)}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('settings.theme')}</span>
        <select className="input" value={theme} onChange={(e) => set({ theme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">{t('settings.dark')}</option>
          <option value="light">{t('settings.light')}</option>
        </select>
      </label>
      <label className="toggle" onClick={() => set({ previewFirst: !previewFirst })}>
        <span className={`switch ${previewFirst ? 'on' : ''}`} />
        {t('axis.previewFirst')}
      </label>
      <div className="sec-title">{t('settings.ai')}</div>
      {services === null ? (
        <p className="muted small">{session.mode === 'hosted' && !session.authenticated ? t('settings.aiLogin') : t('common.loading')}</p>
      ) : services.length === 0 ? (
        <p className="muted small">{t('settings.aiNone')}</p>
      ) : (
        <>
          <label className="field">
            <span>{t('settings.provider')}</span>
            <select className="input" value={choice.provider} onChange={(e) => pick(e.target.value, services.find((s) => s.id === e.target.value)?.defaultModel)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {service && (
            <label className="field">
              <span>{t('settings.model')}</span>
              <select className="input" value={choice.model ?? service.defaultModel} onChange={(e) => pick(choice.provider, e.target.value)}>
                {service.models.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.displayName ?? m.model}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted small">{t('settings.aiNote')}</p>
        </>
      )}
    </div>
  );
}
