import type { AtlasNode } from "../../types";

/**
 * A one-line answer to "which game did this branch come from?", built from the
 * header the importer produced.
 *
 * The importer normalizes KIF, KI2, CSA, PGN and SGF headers into its own key
 * names, so nothing here matches a single file format's literal field names. The
 * preference list below only decides the reading order; any key that is present
 * and unlisted still shows, which is what keeps custom and future headers
 * visible instead of silently dropped.
 */
const HEADLINE_KEYS = [
  "startDatetime",
  "date",
  "postedOn",
  "publishedAt",
  "blackName",
  "whiteName",
  "shitateName",
  "uwateName",
  "blackShortName",
  "whiteShortName",
  "tournament",
  "place",
  "title",
  "strategy",
  "author",
  "source",
] as const;

const PLAYER_KEYS = ["blackName", "whiteName", "shitateName", "uwateName", "blackShortName", "whiteShortName"];

export interface RecordProvenance {
  headline: string;
  entries: ReadonlyArray<readonly [string, string]>;
}

export function findRecordProvenance(node: AtlasNode | null | undefined): RecordProvenance | null {
  const metadata = node?.structuredContent?.sourceRecordMetadata;
  if (!metadata) return null;
  const entries = Object.entries(metadata).filter(([key, value]) => key && value);
  if (!entries.length) return null;

  const byKey = new Map(entries);
  const ordered: string[] = [];
  const used = new Set<string>();

  const takeFirst = (keys: readonly string[]) => {
    for (const key of keys) {
      const value = byKey.get(key);
      if (value && !used.has(key)) {
        used.add(key);
        return value;
      }
    }
    return "";
  };

  const when = takeFirst(["startDatetime", "date", "postedOn", "publishedAt"]);
  if (when) ordered.push(when);

  // "誰と" reads better as a pairing than as two separate fields.
  const players = PLAYER_KEYS.map((key) => byKey.get(key) ?? "").filter(Boolean);
  if (players.length >= 2) {
    PLAYER_KEYS.forEach((key) => { if (byKey.get(key)) used.add(key); });
    ordered.push(`${players[0]} vs ${players[1]}`);
  } else if (players.length === 1) {
    PLAYER_KEYS.forEach((key) => { if (byKey.get(key)) used.add(key); });
    ordered.push(players[0]);
  }

  const occasion = takeFirst(["tournament", "place", "title"]);
  if (occasion) ordered.push(occasion);

  if (!ordered.length) {
    // Nothing recognizable: show whatever the header actually carried.
    for (const [key, value] of entries.slice(0, 2)) {
      used.add(key);
      ordered.push(value);
    }
  }

  const preferenceIndex = (key: string) => {
    const index = (HEADLINE_KEYS as readonly string[]).indexOf(key);
    return index === -1 ? HEADLINE_KEYS.length : index;
  };

  return {
    headline: ordered.join(" / "),
    entries: [...entries].sort((left, right) => preferenceIndex(left[0]) - preferenceIndex(right[0])),
  };
}
