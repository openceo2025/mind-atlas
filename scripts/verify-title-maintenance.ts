import assert from "node:assert/strict";
import { createTitleExcerptFromBody, hydrateMissingNodeTitlesFromBodies, NODE_TITLE_PLACEHOLDER } from "../src/titleMaintenance.ts";
import type { AtlasNode } from "../src/types.ts";

const root = node("atlas-root", "Untitled node", "Root body should be copied into title", [
  node("empty-title", "", "これはタイトルにちょうどよく切り出される長い本文です。続きは本文に残ります。"),
  node("markdown", "Untitled", "## Markdown heading title\n\nSecond line"),
  node("planet", "Untitled planet", "Planet title source"),
  node("branch", "Untitle branch", "Branch title source"),
  node("untitled-branch", "Untitled branch", "Untitled branch source"),
  node("placeholder", NODE_TITLE_PLACEHOLDER, "Placeholder title source"),
  node("placeholder-empty", NODE_TITLE_PLACEHOLDER, "   \n\n"),
  node("legacy-placeholder", "ここに記入", "Legacy placeholder source"),
  node("japanese-untitled", "無題", "Japanese untitled source"),
  node("existing", "Existing title", "Body should not overwrite title"),
  node("blank-body", "", "   \n\n"),
]);

const result = hydrateMissingNodeTitlesFromBodies(root, "2026-06-21T00:00:00.000Z");

assert.deepEqual(result.changedNodeIds, [
  "empty-title",
  "markdown",
  "planet",
  "branch",
  "untitled-branch",
  "placeholder",
  "placeholder-empty",
  "legacy-placeholder",
  "japanese-untitled",
  "atlas-root",
]);
assert.equal(result.root.title, "Root body should be copi...");
assert.equal(findNode(result.root, "empty-title")?.title, "これはタイトルにちょうどよく切り出される長い本文...");
assert.equal(findNode(result.root, "markdown")?.title, "Markdown heading title");
assert.equal(findNode(result.root, "planet")?.title, "Planet title source");
assert.equal(findNode(result.root, "branch")?.title, "Branch title source");
assert.equal(findNode(result.root, "untitled-branch")?.title, "Untitled branch source");
assert.equal(findNode(result.root, "placeholder")?.title, "Placeholder title source");
assert.equal(findNode(result.root, "placeholder-empty")?.title, "");
assert.equal(findNode(result.root, "legacy-placeholder")?.title, "Legacy placeholder sourc...");
assert.equal(findNode(result.root, "japanese-untitled")?.title, "Japanese untitled source");
assert.equal(findNode(result.root, "existing")?.title, "Existing title");
assert.equal(findNode(result.root, "blank-body")?.title, "");
assert.equal(createTitleExcerptFromBody("- Bullet title source"), "Bullet title source");

console.log("Title maintenance verification passed");

function node(id: string, title: string, body: string, children: AtlasNode[] = []): AtlasNode {
  return {
    id,
    kind: id === "atlas-root" ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: title,
    body,
    author: "human",
    status: "waiting",
    color: "#8df5cf",
    texture: "speckled",
    radius: id === "atlas-root" ? 80 : 48,
    summary: body,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    children,
  };
}

function findNode(node: AtlasNode, id: string): AtlasNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
