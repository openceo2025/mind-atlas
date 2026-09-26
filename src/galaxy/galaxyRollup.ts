/**
 * Mechanical rollup from spaces and the ledger up to the galaxy. Nothing in
 * here is hand-typed at the galaxy level: every figure is derived from nodes
 * (status, timestamps, AI usage) or from ledger entries allocated to nodes.
 *
 * Mode: shared-core. Pure functions only, so scripts/verify-galaxy.ts can run
 * them without a browser.
 */
import type { AtlasNode, WorkStatus } from "../types.ts";
import type { Currency, GalaxyState, LedgerEntry } from "./galaxyTypes.ts";

export interface Occurrence {
  entry: LedgerEntry;
  date: string;
}

export interface MoneyTotals {
  expense: number;
  income: number;
}

export interface SpaceMoney {
  /** Ledger totals to date, in the display currency. */
  total: MoneyTotals;
  /** Ledger totals for the current calendar month. */
  month: MoneyTotals;
  /** AI cost recorded on nodes (usage.estimatedCostUsd), in the display currency. */
  aiCost: number;
  aiCostMonth: number;
  /** Net = income - expense - aiCost. */
  net: number;
  /** Money rolled up per node, including every descendant's allocations. */
  byNode: Record<string, MoneyTotals>;
  /** Allocations that point at a node that no longer exists in the tree. */
  orphanAllocations: number;
}

export interface SpaceSignals {
  nodeCount: number;
  statusCounts: Record<WorkStatus, number>;
  lastUpdatedAt: string;
  staleDays: number;
  activity30d: number;
  aiRunMs: number;
  nextSteps: NextStep[];
}

export interface NextStep {
  nodeId: string;
  title: string;
  text: string;
  updatedAt: string;
  /** pinned: the node says #next / #次; blocked: status is blocked; recent: the latest open node. */
  reason: "pinned" | "blocked" | "recent";
}

const NEXT_TAG = /#(?:next|次の一手|次)(?![\p{L}\p{N}_-])/iu;

const STATUSES: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function convert(amount: number, from: Currency, to: Currency, jpyPerUsd: number) {
  if (from === to) return amount;
  const rate = jpyPerUsd > 0 ? jpyPerUsd : 150;
  return from === "USD" ? amount * rate : amount / rate;
}

/** Every occurrence of an entry from its first date up to `today` (inclusive). */
export function expandOccurrences(entry: LedgerEntry, today: string): Occurrence[] {
  if (!entry.recurrence) return entry.date <= today ? [{ entry, date: entry.date }] : [];
  const limit = entry.recurrence.until && entry.recurrence.until < today ? entry.recurrence.until : today;
  const [year, month, day] = entry.date.split("-").map(Number);
  const out: Occurrence[] = [];
  for (let step = 0; step < 600; step += 1) {
    const date = entry.recurrence.every === "year"
      ? isoDate(year + step, month, day)
      : isoDate(year, month + step, day);
    if (date > limit) break;
    out.push({ entry, date });
  }
  return out;
}

function isoDate(year: number, month: number, day: number) {
  // Month may overflow; clamp the day to the target month's length.
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const normalizedMonth = ((month - 1) % 12 + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(normalizedYear, normalizedMonth, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${String(normalizedYear).padStart(4, "0")}-${String(normalizedMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function allOccurrences(galaxy: GalaxyState, today: string) {
  return galaxy.ledger.flatMap((entry) => expandOccurrences(entry, today));
}

/** Parent lookup for a tree, so a node allocation can be added to its ancestors. */
export function parentMap(root: AtlasNode) {
  const parents = new Map<string, string | null>();
  const walk = (node: AtlasNode, parent: string | null) => {
    parents.set(node.id, parent);
    node.children.forEach((child) => walk(child, node.id));
  };
  walk(root, null);
  return parents;
}

export function walkNodes(root: AtlasNode, visit: (node: AtlasNode) => void) {
  visit(root);
  root.children.forEach((child) => walkNodes(child, visit));
}

export function spaceMoney(galaxy: GalaxyState, spaceId: string, root: AtlasNode | null, today: string): SpaceMoney {
  const month = today.slice(0, 7);
  const total: MoneyTotals = { expense: 0, income: 0 };
  const monthTotals: MoneyTotals = { expense: 0, income: 0 };
  const byNode: Record<string, MoneyTotals> = {};
  const parents = root ? parentMap(root) : new Map<string, string | null>();
  let orphanAllocations = 0;
  const add = (target: MoneyTotals, kind: LedgerEntry["kind"], value: number) => {
    if (kind === "income") target.income += value;
    else target.expense += value;
  };
  for (const occurrence of allOccurrences(galaxy, today)) {
    const { entry } = occurrence;
    const weightSum = entry.allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.weight), 0);
    if (weightSum <= 0) continue;
    for (const allocation of entry.allocations) {
      if (allocation.spaceId !== spaceId) continue;
      const share = convert(entry.amount, entry.currency, galaxy.displayCurrency, galaxy.jpyPerUsd) * (Math.max(0, allocation.weight) / weightSum);
      add(total, entry.kind, share);
      if (occurrence.date.startsWith(month)) add(monthTotals, entry.kind, share);
      // Walk the allocated node and its ancestors; the root always receives it.
      let cursor: string | null | undefined = allocation.nodeId && parents.has(allocation.nodeId) ? allocation.nodeId : root?.id;
      if (allocation.nodeId && !parents.has(allocation.nodeId) && root) orphanAllocations += 1;
      while (cursor) {
        byNode[cursor] ??= { expense: 0, income: 0 };
        add(byNode[cursor], entry.kind, share);
        cursor = parents.get(cursor) ?? null;
      }
    }
  }
  let aiCostUsd = 0;
  let aiCostMonthUsd = 0;
  if (root) {
    walkNodes(root, (node) => {
      const cost = node.usage?.estimatedCostUsd;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) return;
      aiCostUsd += cost;
      if ((node.createdAt ?? "").startsWith(month)) aiCostMonthUsd += cost;
    });
  }
  const aiCost = convert(aiCostUsd, "USD", galaxy.displayCurrency, galaxy.jpyPerUsd);
  const aiCostMonth = convert(aiCostMonthUsd, "USD", galaxy.displayCurrency, galaxy.jpyPerUsd);
  return {
    total,
    month: monthTotals,
    aiCost,
    aiCostMonth,
    net: total.income - total.expense - aiCost,
    byNode,
    orphanAllocations,
  };
}

export function spaceSignals(root: AtlasNode | null, now = new Date()): SpaceSignals {
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<WorkStatus, number>;
  if (!root) {
    return { nodeCount: 0, statusCounts, lastUpdatedAt: "", staleDays: 0, activity30d: 0, aiRunMs: 0, nextSteps: [] };
  }
  let nodeCount = 0;
  let lastUpdatedAt = "";
  let activity30d = 0;
  let aiRunMs = 0;
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const pinned: NextStep[] = [];
  const blocked: NextStep[] = [];
  const open: NextStep[] = [];
  walkNodes(root, (node) => {
    nodeCount += 1;
    if (node.status in statusCounts) statusCounts[node.status] += 1;
    const updated = node.updatedAt || node.createdAt || "";
    if (updated > lastUpdatedAt) lastUpdatedAt = updated;
    if (updated >= since) activity30d += 1;
    if (typeof node.usage?.durationMs === "number") aiRunMs += node.usage.durationMs;
    // `nextDecision` is mostly a system hint, so next steps come from what the
    // user wrote: a #next / #次 tag, a blocked node, or the latest open node.
    if (node.kind === "root" || node.status === "done") return;
    const text = firstLine(node.body.replace(NEXT_TAG, ""));
    const step = { nodeId: node.id, title: node.title.replace(NEXT_TAG, "").trim(), text, updatedAt: updated };
    if (NEXT_TAG.test(node.title) || NEXT_TAG.test(node.body)) pinned.push({ ...step, reason: "pinned" });
    else if (node.status === "blocked") blocked.push({ ...step, reason: "blocked" });
    else open.push({ ...step, reason: "recent" });
  });
  const newest = (a: NextStep, b: NextStep) => b.updatedAt.localeCompare(a.updatedAt);
  const nextSteps = [...pinned.sort(newest), ...blocked.sort(newest), ...open.sort(newest).slice(0, 1)];
  const staleDays = lastUpdatedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastUpdatedAt)) / 86_400_000)) : 0;
  return { nodeCount, statusCounts, lastUpdatedAt, staleDays, activity30d, aiRunMs, nextSteps: nextSteps.slice(0, 5) };
}

function firstLine(text: string) {
  return (text.split("\n").map((line) => line.trim()).find(Boolean) ?? "").slice(0, 140);
}

/** Entries that reach no existing space. They are shown as a warning, never dropped. */
export function unallocatedEntries(galaxy: GalaxyState) {
  const spaceIds = new Set(galaxy.spaces.map((space) => space.id));
  return galaxy.ledger.filter((entry) => {
    const live = entry.allocations.filter((allocation) => spaceIds.has(allocation.spaceId) && allocation.weight > 0);
    return live.length === 0;
  });
}

/** Money that flowed from each resource to each space, to date and this month. */
export function resourceFlows(galaxy: GalaxyState, today: string) {
  const month = today.slice(0, 7);
  const flows = new Map<string, { resourceId: string; spaceId: string; total: number; month: number }>();
  for (const { entry, date } of allOccurrences(galaxy, today)) {
    if (!entry.resourceId || entry.kind !== "expense") continue;
    const weightSum = entry.allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.weight), 0);
    if (weightSum <= 0) continue;
    for (const allocation of entry.allocations) {
      const key = `${entry.resourceId}:${allocation.spaceId}`;
      const value = convert(entry.amount, entry.currency, galaxy.displayCurrency, galaxy.jpyPerUsd) * (Math.max(0, allocation.weight) / weightSum);
      const flow = flows.get(key) ?? { resourceId: entry.resourceId, spaceId: allocation.spaceId, total: 0, month: 0 };
      flow.total += value;
      if (date.startsWith(month)) flow.month += value;
      flows.set(key, flow);
    }
  }
  return [...flows.values()];
}

/** Galaxy-wide totals for the header. */
export function galaxyTotals(galaxy: GalaxyState, roots: Record<string, AtlasNode | null>, today: string) {
  let expense = 0;
  let income = 0;
  let monthExpense = 0;
  let monthIncome = 0;
  let aiCost = 0;
  let aiCostMonth = 0;
  const month = today.slice(0, 7);
  for (const { entry, date } of allOccurrences(galaxy, today)) {
    const value = convert(entry.amount, entry.currency, galaxy.displayCurrency, galaxy.jpyPerUsd);
    if (entry.kind === "income") income += value;
    else expense += value;
    if (date.startsWith(month)) {
      if (entry.kind === "income") monthIncome += value;
      else monthExpense += value;
    }
  }
  for (const space of galaxy.spaces) {
    const money = spaceMoney({ ...galaxy, ledger: [] }, space.id, roots[space.id] ?? null, today);
    aiCost += money.aiCost;
    aiCostMonth += money.aiCostMonth;
  }
  return { expense, income, monthExpense, monthIncome, aiCost, aiCostMonth, net: income - expense - aiCost };
}

/** A stable fingerprint of what a judge reads, so unchanged spaces are not re-judged. */
export function contentHash(root: AtlasNode | null) {
  if (!root) return "empty";
  let hash = 2166136261;
  walkNodes(root, (node) => {
    const text = `${node.id}|${node.title}|${node.body}|${node.status}|${node.nextDecision ?? ""}\n`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  });
  return (hash >>> 0).toString(36);
}

/** An indented outline of the space for the judge, trimmed to `limit` characters. */
export function spaceOutlineText(root: AtlasNode, limit = 12_000) {
  const lines: string[] = [];
  let used = 0;
  const walk = (node: AtlasNode, depth: number) => {
    if (used >= limit) return;
    const body = node.body.replace(/\s+/g, " ").trim().slice(0, 400);
    const line = `${"  ".repeat(depth)}- [${node.status}] ${node.title || "(untitled)"}${body ? `: ${body}` : ""}`;
    lines.push(line);
    used += line.length + 1;
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  const text = lines.join("\n");
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

export function formatMoney(value: number, currency: Currency, locale = "ja") {
  const rounded = currency === "JPY" ? Math.round(value) : Math.round(value * 100) / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
      notation: Math.abs(rounded) >= 1_000_000 ? "compact" : "standard",
    }).format(rounded);
  } catch {
    return `${currency} ${rounded}`;
  }
}
