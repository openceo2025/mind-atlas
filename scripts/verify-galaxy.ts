import assert from "node:assert/strict";
import {
  contentHash,
  expandOccurrences,
  galaxyTotals,
  resourceFlows,
  spaceMoney,
  spaceSignals,
  unallocatedEntries,
} from "../src/galaxy/galaxyRollup.ts";
import { parseLedgerLine } from "../src/galaxy/galaxyQuickEntry.ts";
import { galaxyQuestions, normalizeAnswer } from "../src/galaxy/galaxyQuestions.ts";
import type { GalaxyState, LedgerEntry } from "../src/galaxy/galaxyTypes.ts";
import type { AtlasNode } from "../src/types.ts";

function node(id: string, title: string, children: AtlasNode[] = [], extra: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id,
    kind: id === "root" ? "root" : "concept",
    nodeType: "note",
    title,
    subtitle: title,
    body: "",
    author: "human",
    status: "waiting",
    color: "#fff",
    texture: "speckled",
    radius: 20,
    summary: "",
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    children,
    ...extra,
  };
}

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "amount" | "date">): LedgerEntry {
  return {
    kind: "expense",
    currency: "JPY",
    memo: partial.id,
    allocations: [],
    source: "manual",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

// --- recurrence ------------------------------------------------------------
{
  const monthly = entry({ id: "vps", amount: 1200, date: "2026-07-31", recurrence: { every: "month" } });
  const dates = expandOccurrences(monthly, "2026-09-30").map((occurrence) => occurrence.date);
  // Month ends clamp: Jul 31 -> Aug 31 -> Sep 30.
  assert.deepEqual(dates, ["2026-07-31", "2026-08-31", "2026-09-30"]);
  const until = entry({ id: "until", amount: 1, date: "2026-01-15", recurrence: { every: "month", until: "2026-03-01" } });
  assert.deepEqual(expandOccurrences(until, "2026-09-30").map((o) => o.date), ["2026-01-15", "2026-02-15"]);
  const future = entry({ id: "future", amount: 1, date: "2027-01-01" });
  assert.equal(expandOccurrences(future, "2026-09-30").length, 0);
  const yearly = entry({ id: "domain", amount: 1, date: "2024-02-29", recurrence: { every: "year" } });
  assert.deepEqual(expandOccurrences(yearly, "2026-09-30").map((o) => o.date), ["2024-02-29", "2025-02-28", "2026-02-28"]);
}

// --- money rollup to nodes and ancestors -------------------------------------
const tree = node("root", "Mind Atlas", [
  node("ads", "Ads", [node("google", "Google Ads")]),
  node("infra", "Infra", [], { usage: { estimatedCostUsd: 2 } }),
]);
const galaxy: GalaxyState = {
  schemaVersion: 1,
  philosophy: "",
  philosophyHistory: [],
  resources: [{ id: "bank", kind: "account", name: "Bank" }],
  spaces: [
    { id: "s1", title: "Mind Atlas", color: "#fff", decision: "undecided", dependsOn: [], createdAt: "", updatedAt: "" },
    { id: "s2", title: "Onkan", color: "#fff", decision: "undecided", dependsOn: [], createdAt: "", updatedAt: "" },
  ],
  activeSpaceId: "s1",
  ledger: [
    entry({ id: "google-ads", amount: 40000, date: "2026-08-10", resourceId: "bank", allocations: [{ spaceId: "s1", nodeId: "google", weight: 1 }] }),
    entry({ id: "vps", amount: 1000, date: "2026-08-05", resourceId: "bank", recurrence: { every: "month" }, allocations: [{ spaceId: "s1", weight: 1 }, { spaceId: "s2", weight: 1 }] }),
    entry({ id: "sale", kind: "income", amount: 500, date: "2026-09-02", allocations: [{ spaceId: "s2", weight: 1 }] }),
    entry({ id: "orphan", amount: 300, date: "2026-09-03", allocations: [{ spaceId: "s1", nodeId: "deleted-node", weight: 1 }] }),
    entry({ id: "loose", amount: 900, date: "2026-09-04", allocations: [] }),
    entry({ id: "gone", amount: 900, date: "2026-09-04", allocations: [{ spaceId: "deleted-space", weight: 1 }] }),
  ],
  judgments: {},
  judge: { auto: false, backend: "jev-hosted", llamaUrl: "" },
  displayCurrency: "JPY",
  jpyPerUsd: 150,
  updatedAt: "",
};
{
  const today = "2026-09-20";
  const money = spaceMoney(galaxy, "s1", tree, today);
  // Ads 40,000 + half of VPS for Aug and Sep (500 + 500) + orphan 300.
  assert.equal(money.total.expense, 41300);
  assert.equal(money.month.expense, 800);
  assert.equal(money.aiCost, 300);
  assert.equal(money.net, -41600);
  assert.equal(money.orphanAllocations, 1);
  assert.equal(money.byNode.google.expense, 40000);
  assert.equal(money.byNode.ads.expense, 40000, "a node's money rolls up to its parent");
  assert.equal(money.byNode.root.expense, 41300, "everything reaches the root");
  assert.equal(money.byNode.infra, undefined);

  const onkan = spaceMoney(galaxy, "s2", null, today);
  assert.equal(onkan.total.expense, 1000);
  assert.equal(onkan.total.income, 500);

  assert.deepEqual(unallocatedEntries(galaxy).map((e) => e.id).sort(), ["gone", "loose"]);

  const flows = resourceFlows(galaxy, today);
  const s1Flow = flows.find((flow) => flow.spaceId === "s1");
  assert.equal(s1Flow?.total, 41000);
  assert.equal(s1Flow?.month, 500);

  const totals = galaxyTotals(galaxy, { s1: tree, s2: null }, today);
  assert.equal(totals.expense, 40000 + 2000 + 300 + 900 + 900);
  assert.equal(totals.income, 500);
  assert.equal(totals.aiCost, 300);

  const usd = spaceMoney({ ...galaxy, displayCurrency: "USD" }, "s1", tree, today);
  assert.equal(Math.round(usd.aiCost * 100) / 100, 2);
}

// --- signals ---------------------------------------------------------------
{
  const signalTree = node("root", "Root", [
    node("a", "Stripe", [], { status: "blocked", updatedAt: "2026-09-10T00:00:00.000Z", body: "Keys are missing", nextDecision: "Edit this node or branch from it." }),
    node("b", "B", [], { status: "done", body: "#次 done work is never a next step" }),
    node("c", "Call a teacher #次", [], { updatedAt: "2026-09-01T00:00:00.000Z", body: "Show the demo" }),
    node("d", "Older open", [], { updatedAt: "2026-08-01T00:00:00.000Z" }),
    node("e", "Newest open", [], { updatedAt: "2026-09-05T00:00:00.000Z" }),
    node("f", "#nextstep is not the tag", [], { updatedAt: "2026-07-01T00:00:00.000Z" }),
  ], { nextDecision: "Create a first node in the workspace view." });
  const signals = spaceSignals(signalTree, new Date("2026-09-20T00:00:00.000Z"));
  assert.equal(signals.nodeCount, 7);
  assert.equal(signals.statusCounts.blocked, 1);
  assert.equal(signals.staleDays, 10);
  assert.deepEqual(signals.nextSteps.map((step) => `${step.reason}:${step.nodeId}`), ["pinned:c", "blocked:a", "recent:e"]);
  assert.equal(signals.nextSteps[0].title, "Call a teacher", "the tag is stripped from the title");
  assert.equal(signals.nextSteps[1].text, "Keys are missing");
  assert.notEqual(contentHash(signalTree), contentHash({ ...signalTree, title: "Changed" }));
  assert.equal(contentHash(signalTree), contentHash(JSON.parse(JSON.stringify(signalTree))));
}

// --- quick entry -------------------------------------------------------------
{
  const today = "2026-09-26";
  const vps = parseLedgerLine("VPS代1,200円 毎月 Mind Atlas", galaxy, today);
  assert.equal(vps?.amount, 1200);
  assert.equal(vps?.currency, "JPY");
  assert.equal(vps?.kind, "expense");
  assert.equal(vps?.recurrence?.every, "month");
  assert.equal(vps?.spaceId, "s1");
  assert.equal(vps?.date, today);
  assert.equal(vps?.memo, "VPS代", "amount, recurrence and space name are kept out of the memo");

  const ads = parseLedgerLine("広告 4万円", galaxy, today);
  assert.equal(ads?.amount, 40000);

  const claude = parseLedgerLine("$20 Claude monthly", galaxy, today);
  assert.equal(claude?.amount, 20);
  assert.equal(claude?.currency, "USD");
  assert.equal(claude?.recurrence?.every, "month");

  const sale = parseLedgerLine("売上 3000円 onkan 9/2", galaxy, today);
  assert.equal(sale?.kind, "income");
  assert.equal(sale?.spaceId, "s2", "space titles match case-insensitively");
  assert.equal(sale?.date, "2026-09-02");

  const bank = parseLedgerLine("Bank から 500円", galaxy, today);
  assert.equal(bank?.resourceId, "bank");

  assert.equal(parseLedgerLine("no amount here", galaxy, today), null);
  assert.equal(parseLedgerLine("", galaxy, today), null);
}

// --- judge answers -------------------------------------------------------------
{
  const questions = galaxyQuestions();
  assert.deepEqual(Object.keys(questions).sort(), ["constraint", "demand", "proposal", "quality", "stage", "uncertainty"]);
  const demand = normalizeAnswer(questions.demand, { type: "score", score: 2.4, confidence: 0.8 });
  assert.equal(demand?.value, "2");
  assert.equal(Math.round((demand?.level ?? 0) * 100), 80);
  const clamped = normalizeAnswer(questions.demand, { type: "score", score: 9, confidence: 2 });
  assert.equal(clamped?.value, "3");
  assert.equal(clamped?.confidence, 1);
  const stage = normalizeAnswer(questions.stage, { type: "choice", choice: "limited", probabilities: { limited: 0.7, idea: 0.3 } });
  assert.equal(stage?.value, "limited");
  assert.equal(stage?.confidence, 0.7, "confidence falls back to the chosen option's probability");
  assert.equal(normalizeAnswer(questions.stage, undefined), undefined);
  assert.equal(normalizeAnswer(questions.stage, { type: "choice" }), undefined);
}

console.log("galaxy rollup, quick entry and judge normalisation ok");
