import assert from "node:assert/strict";
import { assembleAtlasContextMarkdown } from "../src/context/contextAssembly.ts";
import type { AtlasNode } from "../src/types.ts";

const root = node("root", "Book", "Novel planning notebook.", [
  node("act-1", "Act 1", "Opening act.", [
    node("chapter-1", "Chapter 1", "The protagonist arrives.", [
      node("scene-1", "Scene 1", "Rain at the station."),
      node("scene-2", "Scene 2", "A strange letter appears."),
    ]),
    node("chapter-2", "Chapter 2", "The first investigation.", [
      node("scene-3", "Scene 3", "Interview with the station master."),
    ]),
  ]),
  node("act-2", "Act 2", "Complications and reversals.", [
    node("chapter-3", "Chapter 3", "The map is decoded."),
  ]),
]);

const focused = assembleAtlasContextMarkdown(root, "chapter-1", "focused");
assert.ok(focused);
assert.match(focused.markdown, /## Ancestor Chain/);
assert.match(focused.markdown, /meta: status=waiting; type=note/);
assert.match(focused.markdown, /- Book \(root\)/);
assert.match(focused.markdown, /  - Act 1 \(act-1\)/);
assert.match(focused.markdown, /    - Chapter 1 \(chapter-1\)/);
assert.match(focused.markdown, /## Target Subtree/);
assert.match(focused.markdown, /- Chapter 1 \(chapter-1\)/);
assert.match(focused.markdown, /  - Scene 1 \(scene-1\)/);
assert.match(focused.markdown, /  - Scene 2 \(scene-2\)/);
assert.doesNotMatch(focused.markdown, /Scene 3/);
assert.equal(focused.stats.scope, "focused");
assert.equal(focused.stats.sections.subtree, 3);
assert.ok(focused.stats.characterCount > 0);
assert.ok(focused.stats.estimatedTokens > 0);

const noMetadata = assembleAtlasContextMarkdown(root, "chapter-1", { scope: "focused", includeMetadata: false });
assert.ok(noMetadata);
assert.doesNotMatch(noMetadata.markdown, /meta: status=/);

const neighborhood = assembleAtlasContextMarkdown(root, "chapter-1", "neighborhood");
assert.ok(neighborhood);
assert.match(neighborhood.markdown, /## Sibling Titles/);
assert.match(neighborhood.markdown, /Chapter 2 \(chapter-2\)/);
assert.match(neighborhood.markdown, /Scene 1 \(scene-1\)/);
assert.equal(neighborhood.stats.sections.siblingTitles, 1);

const minimal = assembleAtlasContextMarkdown(root, "chapter-1", "minimal");
assert.ok(minimal);
assert.match(minimal.markdown, /- Chapter 1 \(chapter-1\)/);
assert.doesNotMatch(minimal.markdown, /Book \(root\)/);
assert.doesNotMatch(minimal.markdown, /Scene 1 \(scene-1\)/);

const subtree = assembleAtlasContextMarkdown(root, "act-1", "subtree");
assert.ok(subtree);
assert.match(subtree.markdown, /Scene 3 \(scene-3\)/);
assert.equal(subtree.stats.sections.subtree, 6);

const selected = assembleAtlasContextMarkdown(root, "chapter-1", {
  scope: "selected",
  selectedNodeIds: ["chapter-2", "act-2"],
});
assert.ok(selected);
assert.match(selected.markdown, /## Additional Selected Nodes/);
assert.match(selected.markdown, /Chapter 2 \(chapter-2\)/);
assert.match(selected.markdown, /Act 2 \(act-2\)/);
assert.equal(selected.stats.sections.selectedNodes, 2);

const overflow = assembleAtlasContextMarkdown(root, "act-1", {
  scope: "subtree",
  maxCharacters: 260,
});
assert.ok(overflow);
assert.ok(overflow.stats.truncated);
assert.ok(overflow.stats.omittedNodeCount > 0 || overflow.markdown.includes("[truncated]"));
assert.match(overflow.markdown, /## Overflow/);

console.log("Context assembly verification passed");

function node(id: string, title: string, body: string, children: AtlasNode[] = []): AtlasNode {
  const now = "2026-06-11T00:00:00.000Z";
  return {
    id,
    kind: id === "root" ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: "",
    body,
    author: "human",
    status: "waiting",
    color: "#88aaff",
    texture: "speckled",
    radius: id === "root" ? 80 : 28,
    summary: body,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  };
}
