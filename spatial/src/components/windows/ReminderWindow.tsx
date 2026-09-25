import { useState } from 'react';
import { closeWindow, formatReminderTime, requireAi, setBusy, setCardReminder, toast, toastError, useStore } from '../../store';
import { parseReminder } from '../../lib/ai';
import { EMBEDDED } from '../../lib/embed';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { useAiBlock } from './common';

const HOUR = 60 * 60 * 1000;

/** datetime-local の値（端末の時刻） */
function toLocalInput(at: number) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tomorrowAt(hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * リマインダーをセットする。「明日の朝」「締切の前日」のように言葉で頼めば AI が時刻を決め、
 * 時刻を直接選ぶこともできる。発火すると、宇宙ではこの空間を内包する惑星に波紋が出る。
 */
export function ReminderWindow({ win }: { win: FloatWin }) {
  const card = useStore((s) => s.cards[win.cardIds[0]]);
  const readOnly = useStore((s) => s.readOnly);
  const anchored = useStore((s) => Boolean(s.anchor));
  const busy = useStore((s) => s.busy.reminderAi);
  const block = useAiBlock();
  const [request, setRequest] = useState('');
  const [reply, setReply] = useState('');
  const [manual, setManual] = useState(() => toLocalInput(card?.reminder?.at ?? tomorrowAt(9)));

  if (!card) return <div className="fwin-body">{t('common.cardMissing')}</div>;
  const reminder = card.reminder;

  const apply = (at: number) => {
    if (!Number.isFinite(at)) return;
    if (at < Date.now() - 60_000 && !window.confirm(t('reminder.pastConfirm', { time: formatReminderTime(at) }))) return;
    setCardReminder(card.id, at);
    setManual(toLocalInput(at));
    toast(t('reminder.setToast', { title: card.title, time: formatReminderTime(at) }));
  };

  const ask = () => {
    const text = request.trim();
    if (!text || busy || !requireAi()) return;
    setBusy('reminderAi', true);
    setReply('');
    void parseReminder(text, card)
      .then((r) => {
        setReply(r.reply);
        if (r.at !== null) {
          apply(r.at);
          setRequest('');
        }
      })
      .catch(toastError)
      .finally(() => setBusy('reminderAi', false));
  };

  return (
    <>
      <div className="fwin-body reminder-win">
        <div className={`reminder-now${reminder?.firedAt ? ' fired' : ''}`}>
          <Icon name="bell" size={16} />
          {reminder ? (
            <div>
              <b>{formatReminderTime(reminder.at)}</b>
              <div className="reminder-note" style={{ marginTop: 2 }}>
                {reminder.firedAt ? t('reminder.statusFired') : t('reminder.statusWaiting')}
              </div>
            </div>
          ) : (
            <span>{t('reminder.none')}</span>
          )}
        </div>
        {!readOnly && (
          <>
            <div className="sec-title">{t('reminder.askTitle')}</div>
            <div className="reminder-ask">
              <input
                className="input"
                value={request}
                autoFocus
                placeholder={t('reminder.askPlaceholder')}
                disabled={Boolean(block) || busy}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.stopPropagation();
                    ask();
                  }
                }}
              />
              <button className="btn small primary" disabled={Boolean(block) || busy || !request.trim()} onClick={ask} title={block ? t(`ai.block.${block}` as 'ai.block.login') : t('reminder.askTip')}>
                <Icon name="sparkle" size={13} /> {busy ? t('common.thinking') : t('reminder.askRun')}
              </button>
            </div>
            {reply && <div className="reminder-note">{reply}</div>}
            <div className="sec-title" style={{ marginTop: 14 }}>{t('reminder.manualTitle')}</div>
            <div className="reminder-manual">
              <input className="input" type="datetime-local" value={manual} onChange={(e) => setManual(e.target.value)} />
              <button className="btn small" disabled={!manual} onClick={() => apply(new Date(manual).getTime())}>
                {t('reminder.manualRun')}
              </button>
            </div>
            <div className="reminder-quick">
              <button className="btn small ghost" onClick={() => apply(Date.now() + HOUR)}>
                {t('reminder.inHour')}
              </button>
              <button className="btn small ghost" onClick={() => apply(tomorrowAt(9))}>
                {t('reminder.tomorrowMorning')}
              </button>
            </div>
            <div className="reminder-note">{EMBEDDED || anchored ? t('reminder.rippleNote') : t('reminder.localNote')}</div>
          </>
        )}
      </div>
      <div className="fwin-foot">
        {reminder && !readOnly && (
          <button className="btn small ghost" onClick={() => setCardReminder(card.id, null)}>
            <Icon name="trash" size={13} /> {t('reminder.clear')}
          </button>
        )}
        <button className="btn small ghost" style={{ marginInlineStart: 'auto' }} onClick={() => closeWindow(win.id)}>
          {t('common.close')}
        </button>
      </div>
    </>
  );
}
