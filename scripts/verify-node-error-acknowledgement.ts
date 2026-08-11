import assert from "node:assert/strict";
import { acknowledgeNodeError, isIntrinsicErrorNode } from "../src/nodeErrorState.ts";
import type { AtlasNode } from "../src/types.ts";

const updatedAt = "2026-08-11T00:00:00.000Z";

function node(id: string, overrides: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id,
    kind: "node",
    nodeType: "note",
    title: id,
    subtitle: "",
    body: "",
    author: "human",
    status: "needs_review",
    color: "#ffffff",
    texture: "smooth",
    radius: 28,
    summary: "",
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: updatedAt,
    updatedAt,
    children: [],
    ...overrides,
  };
}

function find(root: AtlasNode, id: string): AtlasNode {
  if (root.id === id) return root;
  for (const child of root.children) {
    try {
      return find(child, id);
    } catch {
      // Continue searching sibling branches.
    }
  }
  throw new Error(`Missing node: ${id}`);
}

const firstError = node("error-1", {
  kind: "event",
  author: "system",
  status: "error",
  tags: ["error"],
  nextDecision: "Keep this error detail.",
});
const secondError = node("error-2", {
  kind: "event",
  author: "system",
  status: "error",
  tags: ["error"],
});
const parent = node("parent", {
  status: "error",
  propagatedErrorSourceId: firstError.id,
  children: [firstError, secondError],
});
const root = node("root", {
  status: "error",
  propagatedErrorSourceId: firstError.id,
  children: [parent],
});

assert.equal(isIntrinsicErrorNode(firstError), true);

const firstAcknowledgement = acknowledgeNodeError(root, firstError.id, updatedAt);
assert.equal(firstAcknowledgement.acknowledged, true);
assert.equal(find(firstAcknowledgement.root, firstError.id).status, "needs_review");
assert.equal(find(firstAcknowledgement.root, firstError.id).nextDecision, "Keep this error detail.");
assert.equal(find(firstAcknowledgement.root, parent.id).status, "error");
assert.equal(find(firstAcknowledgement.root, parent.id).propagatedErrorSourceId, secondError.id);
assert.equal(firstAcknowledgement.root.status, "error");
assert.equal(firstAcknowledgement.root.propagatedErrorSourceId, secondError.id);

const secondAcknowledgement = acknowledgeNodeError(firstAcknowledgement.root, secondError.id, updatedAt);
assert.equal(secondAcknowledgement.acknowledged, true);
assert.equal(find(secondAcknowledgement.root, secondError.id).status, "needs_review");
assert.equal(find(secondAcknowledgement.root, parent.id).status, "needs_review");
assert.equal(find(secondAcknowledgement.root, parent.id).propagatedErrorSourceId, undefined);
assert.equal(secondAcknowledgement.root.status, "needs_review");
assert.equal(secondAcknowledgement.root.propagatedErrorSourceId, undefined);

const propagatedParentActivation = acknowledgeNodeError(root, parent.id, updatedAt);
assert.equal(propagatedParentActivation.acknowledged, false);
assert.equal(propagatedParentActivation.root, root);

console.log("Node error acknowledgement verification passed.");
