import { useEffect, useState } from 'react';
import { set, toastError, useStore } from '../../store';
import { LOCALES, LOCALE_LABELS, getLocale, setLocale, t, type Locale } from '../../i18n';
import { fetchChatOptions, type ChatModel, type ChatService } from '../../lib/service';
import { chooseAiModel, getAiModel } from '../../lib/ai';
import type { FloatWin } from '../../types';

/** そのモデルが受け付ける「思考の深さ」 */
function effortsOf(service: ChatService | undefined, model: string | undefined) {
  const option = service?.models.find((m) => m.model === model);
  return option?.supportedReasoningEfforts ?? service?.supportedReasoningEfforts ?? [];
}

function effortLabel(effort: string) {
  const key = `effort.${effort}` as Parameters<typeof t>[0];
  const label = t(key);
  return label === key ? effort : label;
}

function modelLabel(m: ChatModel) {
  const name = m.displayName ?? m.model;
  if (!m.pricing) return name;
  const price = `$${m.pricing.inputUsdPer1M} / $${m.pricing.outputUsdPer1M}`;
  return `${name} · ${m.pricing.estimated ? t('settings.priceEstimated', { price }) : price}`;
}

export function SettingsWindow(_: { win: FloatWin }) {
  const theme = useStore((s) => s.theme);
  const previewFirst = useStore((s) => s.previewFirst);
  const costNotice = useStore((s) => s.costNotice);
  const session = useStore((s) => s.session);
  const [services, setServices] = useState<ChatService[] | null>(null);
  const [choice, setChoice] = useState(getAiModel());
  const signedIn = session.mode === 'hosted' && session.authenticated;

  useEffect(() => {
    if (session.mode === 'hosted' && !session.authenticated) return;
    void fetchChatOptions()
      .then(setServices)
      .catch(() => setServices([]));
  }, [session.mode, session.authenticated]);

  // 別の端末や旧 MindAtlas で選び直したモデルがセッション更新で届いたら表示も合わせる
  useEffect(() => setChoice(getAiModel()), [session.aiPreference]);

  const pick = (provider: string, model?: string) => {
    const service = services?.find((s) => s.id === provider);
    const efforts = effortsOf(service, model);
    const current = getAiModel();
    const next = {
      ...current,
      provider,
      model,
      // モデルを変えたら、そのモデルが受け付ける深さに合わせる
      reasoningEffort: current.reasoningEffort && efforts.includes(current.reasoningEffort) ? current.reasoningEffort : undefined,
    };
    setChoice(next);
    void chooseAiModel(next, signedIn).catch(toastError);
  };

  const pickEffort = (effort: string) => {
    const next = { ...getAiModel(), reasoningEffort: effort || undefined };
    setChoice(next);
    void chooseAiModel(next, signedIn).catch(toastError);
  };

  const service = services?.find((s) => s.id === choice.provider);
  const effortOptions = effortsOf(service, choice.model ?? service?.defaultModel);

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
      <label
        className="toggle"
        onClick={() => {
          const next = !costNotice;
          set({ costNotice: next });
          try {
            localStorage.setItem('mindatlas-spatial-cost-notice', next ? '1' : '0');
          } catch {
            // この画面の間だけ有効
          }
        }}
      >
        <span className={`switch ${costNotice ? 'on' : ''}`} />
        {t('settings.costNotice')}
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
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {effortOptions.length > 1 && (
            <label className="field">
              <span>{t('settings.effort')}</span>
              <select className="input" value={choice.reasoningEffort ?? ''} onChange={(e) => pickEffort(e.target.value)}>
                <option value="">{t('effort.default')}</option>
                {effortOptions
                  .filter((effort) => effort !== 'default')
                  .map((effort) => (
                    <option key={effort} value={effort}>
                      {effortLabel(effort)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p className="muted small">{t('settings.aiNote')}</p>
          {signedIn && <p className="muted small">{t('settings.aiAccount')}</p>}
        </>
      )}
    </div>
  );
}
