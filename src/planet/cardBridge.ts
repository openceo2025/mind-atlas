/**
 * The seam between Mind Atlas (Space) — the universe of nodes — and
 * Mind Atlas (Cards), the card space you land in when you dive into a node.
 *
 * Both apps import this file: the universe from `src/`, the card app from
 * `spatial/src/`. It must stay free of either app's imports so it compiles in
 * both projects. The card app runs in a same-origin iframe inside the
 * universe, so the two share an origin and therefore localStorage; the
 * reminder index below is how card reminders reach the universe even while
 * the card app is not loaded.
 *
 * Mode: hosted-only surface. Local developer mode never mounts the card app.
 */

/** Where the card app is served on the universe's origin. */
export const CARD_APP_BASE_PATH = "/card/";
/** Query parameter that tells the card app it is embedded in the universe. */
export const CARD_EMBED_PARAM = "embed";
export const CARD_EMBED_VALUE = "space";

const MESSAGE_SOURCE = "mind-atlas-planet";

export interface PlanetAnchor {
  /** Stable id stored on both the node and its card space. */
  planetId: string;
  nodeId: string;
  nodeTitle: string;
}

export type CardTheme = "dark" | "light";

export type UniverseToCardMessage =
  | { type: "open-planet"; planet: PlanetAnchor; locale?: string; theme?: CardTheme }
  | { type: "settings"; locale?: string; theme?: CardTheme }
  | { type: "reminders-fired"; entries: ReminderIndexEntry[] };

export type CardToUniverseMessage =
  /** The card app booted and can take `open-planet`. */
  | { type: "card-ready" }
  /** The requested planet's space is on screen; the whiteout may lift. */
  | { type: "planet-opened"; planetId: string; spaceId: string }
  | { type: "planet-failed"; planetId: string; message: string }
  /** Leave the card space and rise back to the universe. */
  | { type: "ascend"; planetId?: string }
  /** The card app fired reminders itself; the universe should ripple. */
  | { type: "reminders-fired"; entries: ReminderIndexEntry[] };

type Envelope<T> = T & { source: typeof MESSAGE_SOURCE };

export function postPlanetMessage(target: Window, message: UniverseToCardMessage | CardToUniverseMessage) {
  const envelope: Envelope<typeof message> = { ...message, source: MESSAGE_SOURCE };
  target.postMessage(envelope, window.location.origin);
}

/**
 * Accept only messages from `expectedSource` on our own origin that carry the
 * planet envelope. Everything else on the window's message channel is ignored.
 */
export function readPlanetMessage<T extends UniverseToCardMessage | CardToUniverseMessage>(
  event: MessageEvent,
  expectedSource: MessageEventSource | null,
): T | null {
  if (event.origin !== window.location.origin) return null;
  if (!expectedSource || event.source !== expectedSource) return null;
  const data = event.data as Partial<Envelope<T>> | null;
  if (!data || typeof data !== "object" || data.source !== MESSAGE_SOURCE || typeof data.type !== "string") return null;
  return data as unknown as T;
}

export function createPlanetId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `planet-${crypto.randomUUID()}`;
  } catch {
    // Fall through to the non-crypto id.
  }
  return `planet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Card reminder index ──────────────────────────────────────────────────
//
// The card app writes one entry per card reminder whenever it saves a space.
// Whoever notices an entry is due first — the universe's ticker or the
// standalone card app — marks it fired here, so a reminder fires once per
// device no matter which view is open.

const REMINDER_INDEX_KEY = "mindatlas-card-reminders-v1";
/** Fired entries are kept this long so a reopened space can learn it fired. */
const FIRED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

export interface ReminderIndexEntry {
  key: string;
  spaceId: string;
  spaceTitle: string;
  planetId?: string;
  cardId: string;
  title: string;
  at: number;
  firedAt?: number;
}

export function reminderEntryKey(spaceId: string, cardId: string, at: number) {
  return `${spaceId}:${cardId}:${at}`;
}

function isEntry(value: unknown): value is ReminderIndexEntry {
  const v = value as Partial<ReminderIndexEntry> | null;
  return Boolean(
    v &&
      typeof v.key === "string" &&
      typeof v.spaceId === "string" &&
      typeof v.cardId === "string" &&
      typeof v.title === "string" &&
      typeof v.at === "number" &&
      Number.isFinite(v.at),
  );
}

export function readReminderIndex(): ReminderIndexEntry[] {
  try {
    const raw = window.localStorage.getItem(REMINDER_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeReminderIndex(entries: ReminderIndexEntry[]) {
  const cutoff = Date.now() - FIRED_RETENTION_MS;
  const kept = entries.filter((entry) => !entry.firedAt || entry.firedAt >= cutoff).slice(-MAX_ENTRIES);
  try {
    window.localStorage.setItem(REMINDER_INDEX_KEY, JSON.stringify(kept));
  } catch {
    // Storage full or blocked: reminders still fire inside an open card space.
  }
}

/**
 * Replace every entry of one space with its current reminders. An entry that
 * already fired keeps its `firedAt`, so saving a space never re-arms it.
 */
export function replaceSpaceReminders(
  spaceId: string,
  entries: Array<Omit<ReminderIndexEntry, "key" | "spaceId" | "firedAt"> & { firedAt?: number }>,
) {
  const current = readReminderIndex();
  const previous = new Map(current.filter((entry) => entry.spaceId === spaceId).map((entry) => [entry.key, entry]));
  const next = current.filter((entry) => entry.spaceId !== spaceId);
  for (const entry of entries) {
    const key = reminderEntryKey(spaceId, entry.cardId, entry.at);
    const firedAt = entry.firedAt ?? previous.get(key)?.firedAt;
    next.push({ ...entry, key, spaceId, ...(firedAt ? { firedAt } : {}) });
  }
  writeReminderIndex(next);
}

export function removeSpaceReminders(spaceId: string) {
  writeReminderIndex(readReminderIndex().filter((entry) => entry.spaceId !== spaceId));
}

/** Claim every due, unfired reminder: mark it fired and return it. */
export function takeDueReminders(nowMs = Date.now()): ReminderIndexEntry[] {
  const entries = readReminderIndex();
  const due: ReminderIndexEntry[] = [];
  const next = entries.map((entry) => {
    if (entry.firedAt || entry.at > nowMs) return entry;
    const fired = { ...entry, firedAt: nowMs };
    due.push(fired);
    return fired;
  });
  if (due.length) writeReminderIndex(next);
  return due;
}

/** Fired times recorded for one space, keyed by `reminderEntryKey`. */
export function firedRemindersForSpace(spaceId: string) {
  const fired = new Map<string, number>();
  for (const entry of readReminderIndex()) {
    if (entry.spaceId === spaceId && entry.firedAt) fired.set(entry.key, entry.firedAt);
  }
  return fired;
}

/** The notification signature a card reminder leaves on its planet's node. */
export function cardReminderSignature(entry: Pick<ReminderIndexEntry, "spaceId" | "cardId" | "at">) {
  return `card-reminder:${entry.spaceId}:${entry.cardId}:${entry.at}`;
}
