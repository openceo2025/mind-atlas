/**
 * Which planets have a card space (Mind Atlas Cards) inside, and how many
 * cards it holds, so the universe can show it on the node.
 *
 * A node gets its `cardPlanetId` the moment someone dives into it, so the id
 * alone says "a card space exists". The count comes from the card app's own
 * storage on this device (same origin, read-only — this module never creates
 * the card app's database) and, when signed in, from the account's card spaces
 * in the cloud, so cards made on another device are counted too.
 *
 * Mode: hosted-only surface (the card app is never mounted in local developer
 * mode); PlanetGate drives the refreshes.
 */
import { create } from 'zustand';
import { listHostedCardSpaces } from '../hosted/serviceClient';

const CARD_DB = 'mindatlas-spatial';

interface CardPresenceState {
  /** Cards per planet id; a planet with an empty space maps to 0. */
  cards: Record<string, number>;
  refreshedAt: number;
}

export const useCardPresence = create<CardPresenceState>(() => ({ cards: {}, refreshedAt: 0 }));

function readLocalCardSpaces(): Promise<Array<{ planetId: string; cards: number }>> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([]);
  return new Promise(resolve => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(CARD_DB);
    } catch {
      resolve([]);
      return;
    }
    // The card app has never run on this device: do not create its database.
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve([]);
    request.onblocked = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains('spaces')) {
        db.close();
        resolve([]);
        return;
      }
      try {
        const all = db.transaction('spaces', 'readonly').objectStore('spaces').getAll();
        all.onsuccess = () => {
          const found: Array<{ planetId: string; cards: number }> = [];
          for (const space of (all.result ?? []) as Array<{ anchor?: { planetId?: unknown }; cards?: unknown }>) {
            const planetId = space?.anchor?.planetId;
            if (typeof planetId !== 'string' || !planetId) continue;
            found.push({ planetId, cards: space.cards && typeof space.cards === 'object' ? Object.keys(space.cards).length : 0 });
          }
          db.close();
          resolve(found);
        };
        all.onerror = () => {
          db.close();
          resolve([]);
        };
      } catch {
        db.close();
        resolve([]);
      }
    };
  });
}

let running: Promise<void> | null = null;

/** Re-read both sources. Concurrent calls share one refresh. */
export function refreshCardPresence(options: { cloud: boolean }) {
  if (running) return running;
  running = (async () => {
    const cards: Record<string, number> = {};
    const note = (planetId: string, count: number) => {
      cards[planetId] = Math.max(cards[planetId] ?? 0, count);
    };
    for (const entry of await readLocalCardSpaces()) note(entry.planetId, entry.cards);
    if (options.cloud) {
      try {
        for (const entry of await listHostedCardSpaces()) if (entry.planetId) note(entry.planetId, Number(entry.cardCount) || 0);
      } catch {
        // Signed out or offline: this device's card spaces are still counted.
      }
    }
    const previous = useCardPresence.getState().cards;
    const same = Object.keys(previous).length === Object.keys(cards).length && Object.entries(cards).every(([id, count]) => previous[id] === count);
    useCardPresence.setState(same ? { refreshedAt: Date.now() } : { cards, refreshedAt: Date.now() });
  })().finally(() => {
    running = null;
  });
  return running;
}

const COPY = {
  en: { cards: (count: number) => (count === 1 ? '1 card inside' : `${count} cards inside`), empty: 'Card space inside' },
  ja: { cards: (count: number) => `カード${count}枚`, empty: 'カードの空間あり' },
};

/** Accessible name for the badge on a planet with a card space. */
export function cardBadgeLabel(count: number | undefined, locale: string) {
  const copy = locale.startsWith('ja') ? COPY.ja : COPY.en;
  return count ? copy.cards(count) : copy.empty;
}
