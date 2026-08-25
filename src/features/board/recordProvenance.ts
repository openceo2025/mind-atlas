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

  return {
    headline: ordered.join(" / "),
    entries: orderProvenanceEntries(entries),
  };
}

function orderProvenanceEntries(entries: Array<[string, string]>): Array<[string, string]> {
  const preferenceIndex = (key: string) => {
    const index = (HEADLINE_KEYS as readonly string[]).indexOf(key);
    return index === -1 ? HEADLINE_KEYS.length : index;
  };
  return [...entries].sort((left, right) => preferenceIndex(left[0]) - preferenceIndex(right[0]));
}

/**
 * The heading the header block is written under. Fixed Japanese, like every
 * other string that ends up in a node body: a body is persisted data that
 * round-trips through a KIF comment, so localizing it at write time would
 * freeze whichever language the merge happened to be performed in.
 */
export const RECORD_PROVENANCE_HEADING = "元の棋譜";

/**
 * The source header, as body text.
 *
 * This belongs in the node body rather than in a panel beside the board. It is
 * content about that move - which game the line came from - so it belongs where
 * every other note about a move lives, where it can be read, edited, exported
 * into the KIF comment and carried into a share link.
 */
export function formatRecordProvenanceBody(metadata: Record<string, string>): string {
  const entries = orderProvenanceEntries(Object.entries(metadata).filter(([key, value]) => key && value));
  if (!entries.length) return "";
  return [RECORD_PROVENANCE_HEADING, ...entries.map(([key, value]) => `${key}: ${value}`)].join("\n");
}

/**
 * Adds the header block to a body once. Returns null when there is nothing to
 * add, so callers can skip a write: a record merged twice, or a record that
 * already carried the block from a previous merge, must not collect copies.
 */
export function appendRecordProvenanceToBody(body: string, metadata: Record<string, string>): string | null {
  const block = formatRecordProvenanceBody(metadata);
  if (!block) return null;
  const current = String(body ?? "").replace(/\s+$/, "");
  if (current.includes(block)) return null;
  return current ? `${current}\n\n${block}` : block;
}

/**
 * Writes the header into every branch node that carries one but has not had it
 * written yet. Records merged before the header moved into the body keep their
 * metadata in structured content, so this is what makes those records show it.
 *
 * Returns null when nothing changed, so the caller can skip a notebook write.
 */
export function normalizeRecordProvenanceBodies(root: AtlasNode): AtlasNode | null {
  let changed = false;

  const visit = (node: AtlasNode): AtlasNode => {
    const children = node.children.map(visit);
    const childrenChanged = children.some((child, index) => child !== node.children[index]);
    const metadata = node.structuredContent?.sourceRecordMetadata;
    const body = metadata ? appendRecordProvenanceToBody(node.body ?? "", metadata) : null;
    if (body === null) return childrenChanged ? { ...node, children } : node;
    changed = true;
    return { ...node, body, children };
  };

  const next = visit(root);
  return changed ? next : null;
}
