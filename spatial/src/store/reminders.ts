// カードのリマインダー。
//
// 予定はカードに保存し、保存のたびに端末内の索引（cardBridge の reminder index）へ写す。
// 宇宙の中で開いているときは、宇宙側が索引を見張って発火させ、この空間を内包する
// 惑星（ノード）に波紋を出す。単独で開いているときは、ここで見張って知らせる。
import type { Card, Space } from '../types';
import {
  firedRemindersForSpace,
  reminderEntryKey,
  removeSpaceReminders,
  replaceSpaceReminders,
  takeDueReminders,
  type ReminderIndexEntry,
} from '../../../src/planet/cardBridge';
import { EMBEDDED } from '../lib/embed';
import { getLocale, t } from '../i18n';
import { addLog, get, lookup, markDirty, set, snapshot, toast } from './core';
import { focusCard } from './ui';

const TICK_MS = 15_000;

/** 索引へ写す。読み取り専用（共有リンク）の空間は、自分の予定ではないので写さない */
export function syncSpaceReminders(space: Space) {
  if (space.readOnly || space.id.startsWith('shared:')) return;
  replaceSpaceReminders(
    space.id,
    Object.values(space.cards)
      .filter((c) => c.reminder && Number.isFinite(c.reminder.at))
      .map((c) => ({
        cardId: c.id,
        title: c.title,
        spaceTitle: space.title,
        planetId: space.anchor?.planetId,
        at: c.reminder!.at,
        firedAt: c.reminder!.firedAt,
      })),
  );
}

export function forgetSpaceReminders(spaceId: string) {
  removeSpaceReminders(spaceId);
}

/** 閉じている間に（宇宙側や別の窓で）発火した予定を、カードにも反映する */
export function withFiredFromIndex(space: Space): Space {
  const fired = firedRemindersForSpace(space.id);
  if (!fired.size) return space;
  let changed = false;
  const cards: Record<string, Card> = { ...space.cards };
  for (const c of Object.values(space.cards)) {
    if (!c.reminder || c.reminder.firedAt) continue;
    const firedAt = fired.get(reminderEntryKey(space.id, c.id, c.reminder.at));
    if (!firedAt) continue;
    cards[c.id] = { ...c, reminder: { ...c.reminder, firedAt } };
    changed = true;
  }
  return changed ? { ...space, cards } : space;
}

export function setCardReminder(id: string, at: number | null) {
  const c = lookup(id);
  if (!c || get().readOnly) return;
  snapshot();
  const reminder = at === null ? undefined : { at };
  set((s) => ({ cards: { ...s.cards, [id]: { ...c, reminder } } }));
  markDirty();
  if (at === null) addLog(id, 'reminderCleared');
  else addLog(id, 'reminderSet', { at: formatReminderTime(at) });
}

export function formatReminderTime(at: number) {
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at));
  } catch {
    return new Date(at).toLocaleString();
  }
}

/** カードの角に出す短い表記。今日なら時刻だけ */
export function formatReminderShort(at: number) {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  try {
    return new Intl.DateTimeFormat(getLocale(), sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

/** 発火した予定を画面に知らせ、開いている空間のカードには発火の印を付ける */
export function announceFiredReminders(entries: ReminderIndexEntry[], opts: { toast?: boolean } = {}) {
  const s = get();
  for (const entry of entries) {
    const inThisSpace = entry.spaceId === s.spaceId;
    const card = inThisSpace ? lookup(entry.cardId) : undefined;
    if (card?.reminder && card.reminder.at === entry.at && !card.reminder.firedAt) {
      set((st) => ({ cards: { ...st.cards, [card.id]: { ...card, reminder: { ...card.reminder!, firedAt: entry.firedAt ?? Date.now() } } } }));
      markDirty();
    }
    if (opts.toast === false) continue;
    toast(inThisSpace ? t('reminder.fired', { title: entry.title }) : t('reminder.firedElsewhere', { title: entry.title, space: entry.spaceTitle }), {
      ms: 12000,
      action: inThisSpace
        ? { label: t('reminder.show'), run: () => focusCard(entry.cardId) }
        : {
            label: t('reminder.openSpace'),
            run: () => {
              void import('./spaces').then(async ({ openSpaceById }) => {
                if (await openSpaceById(entry.spaceId)) focusCard(entry.cardId);
              });
            },
          },
    });
  }
}

/**
 * 単独で開いているときの見張り。宇宙の中では宇宙側が見張るので動かさない
 * （同じ予定を二か所で知らせないため）。
 */
export function startReminderTicker() {
  if (EMBEDDED) return () => undefined;
  const tick = () => {
    const due = takeDueReminders();
    if (!due.length) return;
    announceFiredReminders(due);
  };
  tick();
  const timer = window.setInterval(tick, TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
