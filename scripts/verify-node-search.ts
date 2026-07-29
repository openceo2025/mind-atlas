import assert from "node:assert/strict";
import { rankAtlasNodes, searchAtlasNodes } from "../src/search/nodeSearch.ts";
import type { AtlasNode } from "../src/types.ts";

const root = node("root", "Product launch", "Launch notes", [
  node("billing", "Billing safeguards", "Prevent duplicate subscription credit and track Stripe renewal dates."),
  node("mobile", "Mobile interaction", "Fix touch cancellation and keep the editor stable on iPhone."),
  node("story", "Scene outline", "The traveler crosses a silent bridge at dawn.", [
    node("story-2", "Second chapter", "A hidden signal changes the journey."),
  ]),
]);

const plain = searchAtlasNodes(root, { query: "touch cancellation" });
assert.equal(plain.total, 1);
assert.equal(plain.matches[0]?.nodeId, "mobile");
assert.equal(plain.matches[0]?.field, "body");

const titleRanking = searchAtlasNodes(root, { query: "Billing", caseSensitive: true });
assert.equal(titleRanking.matches[0]?.nodeId, "billing");
assert.equal(titleRanking.matches[0]?.field, "title");

const regex = searchAtlasNodes(root, { query: "chapter|bridge", regex: true });
assert.equal(regex.total, 2);
assert.deepEqual(new Set(regex.matches.map((match) => match.nodeId)), new Set(["story", "story-2"]));

const invalid = searchAtlasNodes(root, { query: "(", regex: true });
assert.match(invalid.error ?? "", /Invalid regular expression/);

const unsafe = searchAtlasNodes(root, { query: "(a+)+", regex: true });
assert.match(unsafe.error ?? "", /nested repetition/);

const relevant = rankAtlasNodes(root, {
  query: "payment safety",
  concepts: ["billing", "subscription", "credit", "Stripe"],
  limit: 3,
});
assert.equal(relevant.matches[0]?.nodeId, "billing");
assert.ok((relevant.matches[0]?.snippet.length ?? 0) > 0);
assert.ok((relevant.matches[0]?.score ?? 0) > (relevant.matches[1]?.score ?? 0));

const bounded = rankAtlasNodes(root, {
  query: "journey",
  concepts: ["traveler", "bridge", "signal", "chapter"],
  limit: 1,
});
assert.equal(bounded.matches.length, 1);
assert.ok(["story", "story-2"].includes(bounded.matches[0]?.nodeId ?? ""));

console.log("node search verification passed");

function node(id: string, title: string, body: string, children: AtlasNode[] = []): AtlasNode {
  const now = "2026-07-28T00:00:00.000Z";
  return {
    id,
    kind: id === "root" ? "root" : "concept",
    nodeType: "note",
    title,
    subtitle: "",
    body,
    author: "human",
    status: "waiting",
    color: "#8df5cf",
    texture: "speckled",
    radius: id === "root" ? 42 : 28,
    summary: "",
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  };
}
