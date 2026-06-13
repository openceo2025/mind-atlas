import assert from "node:assert/strict";
import { deriveAtlasLayout, deriveAtlasLayoutFrame, getStoredPositionForWorldDirection, type Vec3 } from "../src/layout/atlasLayout.ts";
import type { AtlasNode } from "../src/types.ts";

const root = node("atlas-root", "Atlas", [
  node("alpha", "Alpha", [
    node("alpha-1", "Alpha 1"),
    node("alpha-2", "Alpha 2", [node("alpha-2-a", "Alpha 2 A")]),
  ]),
  node("beta", "Beta"),
  node("gamma", "Gamma", [node("gamma-1", "Gamma 1")]),
]);

const legacyRoot = bakeLegacyAutoPositions(root);
const derivedFromLogical = deriveAtlasLayout(root);
const derivedFromLegacyOverrides = deriveAtlasLayout(legacyRoot);

for (const id of collectNodeIds(root)) {
  assertVecClose(
    derivedFromLogical.get(id),
    derivedFromLegacyOverrides.get(id),
    `layout parity failed for ${id}`,
  );
}

const draggedRoot = cloneTree(root);
const draggedAlpha = findNode(draggedRoot, "alpha");
assert.ok(draggedAlpha);
draggedAlpha.position = [0.25, -0.1, -0.96];
const draggedLayout = deriveAtlasLayout(draggedRoot);
assert.notDeepEqual(draggedLayout.get("alpha"), derivedFromLogical.get("alpha"));

const parentPath = [draggedRoot, draggedAlpha];
const childOverride = getStoredPositionForWorldDirection(parentPath, [220, 140, -650], 2, draggedAlpha.children.length);
const draggedChild = findNode(draggedRoot, "alpha-2");
assert.ok(draggedChild);
draggedChild.position = childOverride;
const childLayout = deriveAtlasLayout(draggedRoot);
assert.notDeepEqual(childLayout.get("alpha-2"), draggedLayout.get("alpha-2"));

const treeLayout = deriveAtlasLayout(root, "tree");
assert.ok((treeLayout.get("alpha-1")?.[1] ?? 0) < (treeLayout.get("alpha")?.[1] ?? 0), "tree children should be below parents");
assert.ok((treeLayout.get("alpha-1")?.[0] ?? 0) < (treeLayout.get("gamma")?.[0] ?? 0), "tree layout should preserve sibling order");

const focusedTreeLayout = deriveAtlasLayout(root, "tree", undefined, { focusNodeId: "alpha" });
assertVecClose(focusedTreeLayout.get("alpha"), [0, 92, -1320], "tree focused node should be centered in the 2D plane");
assert.ok((focusedTreeLayout.get("atlas-root")?.[1] ?? 0) > (focusedTreeLayout.get("alpha")?.[1] ?? 0), "tree focused parent should be above active node");
assert.ok((focusedTreeLayout.get("alpha-1")?.[1] ?? 0) < (focusedTreeLayout.get("alpha")?.[1] ?? 0), "tree focused children should be below active node");
assert.equal(focusedTreeLayout.get("alpha")?.[2], focusedTreeLayout.get("alpha-1")?.[2], "tree focused layout should be flat");
const focusedTreeFrame = deriveAtlasLayoutFrame(root, "tree", undefined, { focusNodeId: "alpha" });
assert.ok(focusedTreeFrame.visibleIds.has("alpha"));
assert.ok(focusedTreeFrame.visibleIds.has("alpha-1"));
assert.ok(focusedTreeFrame.visibleIds.has("beta"), "tree should show focused siblings");
assert.ok(!focusedTreeFrame.visibleIds.has("gamma-1"), "tree should hide distant cousin descendants");
assertMinDistance(focusedTreeFrame, 80, "tree visible nodes should not collapse onto each other");

const mobileTreeLayout = deriveAtlasLayout(root, "tree", undefined, { focusNodeId: "alpha", viewport: "mobile-portrait" });
assert.ok((mobileTreeLayout.get("alpha-1")?.[0] ?? 0) > (mobileTreeLayout.get("alpha")?.[0] ?? 0), "mobile tree children should be to the right of active node");
assert.ok((mobileTreeLayout.get("atlas-root")?.[0] ?? 0) < (mobileTreeLayout.get("alpha")?.[0] ?? 0), "mobile tree parent should be to the left of active node");
assert.equal(mobileTreeLayout.get("alpha")?.[2], mobileTreeLayout.get("alpha-1")?.[2], "mobile tree layout should be flat");

const mindMapLayout = deriveAtlasLayout(root, "mind-map");
assert.ok(distanceFromRoot(mindMapLayout.get("alpha")) < distanceFromRoot(mindMapLayout.get("alpha-1")), "mind map descendants should move outward");
assert.equal(JSON.stringify([...mindMapLayout.entries()]), JSON.stringify([...deriveAtlasLayout(root, "mind-map").entries()]), "mind map layout should be deterministic");

const focusedMindMapLayout = deriveAtlasLayout(root, "mind-map", undefined, { focusNodeId: "alpha" });
assertVecClose(focusedMindMapLayout.get("alpha"), [0, 0, -1320], "mind map focused node should be centered in the 2D plane");
assert.equal(focusedMindMapLayout.get("alpha")?.[2], focusedMindMapLayout.get("gamma")?.[2], "mind map layout should be flat");
const focusedMindMapFrame = deriveAtlasLayoutFrame(root, "mind-map", undefined, { focusNodeId: "alpha" });
assert.ok(focusedMindMapFrame.visibleIds.has("alpha"));
assert.ok(focusedMindMapFrame.visibleIds.has("atlas-root"), "mind map should show focused parent");
assert.ok(focusedMindMapFrame.visibleIds.has("beta"), "mind map should show focused siblings near parent context");
assertMinDistance(focusedMindMapFrame, 46, "mind map visible nodes should not collapse onto each other");

const taggedRoot = cloneTree(root);
findNode(taggedRoot, "alpha")?.tags.push("shared");
findNode(taggedRoot, "alpha-1")?.tags.push("shared");
findNode(taggedRoot, "alpha-2")?.tags.push("shared");
findNode(taggedRoot, "gamma")?.tags.push("other");
const hubLayout = deriveAtlasLayout(taggedRoot, "hub-emphasis");
assert.ok(distanceFromRoot(hubLayout.get("alpha")) < distanceFromRoot(hubLayout.get("gamma")), "hub emphasis should pull resonant hubs inward");
const focusedHubLayout = deriveAtlasLayout(taggedRoot, "hub-emphasis", undefined, { focusNodeId: "alpha" });
assertVecClose(focusedHubLayout.get("alpha"), [0, 0, -360], "hub focused node should rotate to the front tier");
assert.ok(distanceFromRoot(focusedHubLayout.get("alpha")) < distanceFromRoot(focusedHubLayout.get("gamma")), "hub focused layout should keep child-count tiers");

const outlierRoot = node("atlas-root", "Outlier", [
  node("huge", "Huge", Array.from({ length: 100 }, (_, index) => node(`huge-${index}`, `Huge ${index}`))),
  ...Array.from({ length: 19 }, (_, index) => node(`peer-${index}`, `Peer ${index}`, Array.from({ length: index % 4 }, (_, childIndex) => node(`peer-${index}-${childIndex}`, `Peer ${index}.${childIndex}`)))),
]);
const outlierHubLayout = deriveAtlasLayout(outlierRoot, "hub-emphasis");
const peerTiers = outlierRoot.children
  .filter((node) => node.id.startsWith("peer-"))
  .map((node) => tierFromDistance(outlierHubLayout.get(node.id)));
assert.ok(new Set(peerTiers).size > 3, "hub tiers should be rank-distributed instead of collapsing all non-outliers to the back");

console.log("Layout verification passed");

function bakeLegacyAutoPositions(tree: AtlasNode): AtlasNode {
  const rootCopy = cloneTree(tree);
  const visit = (parent: AtlasNode, depth: number) => {
    parent.children = parent.children.map((child, index) => {
      const next = {
        ...child,
        position: getLegacyStoredChildPosition(depth, parent.children.length, index, parent.id),
      };
      visit(next, depth + 1);
      return next;
    });
  };
  visit(rootCopy, 1);
  return rootCopy;
}

function getLegacyStoredChildPosition(depth: number, siblingCount: number, childIndex: number, parentId: string): Vec3 {
  const i = childIndex + 1;
  const angle = seededAngle(parentId) + i * Math.PI * (3 - Math.sqrt(5));
  if (depth <= 1) {
    const planarRadius = Math.min(1 * 0.92, 0.22 + 0.12 * Math.sqrt(i));
    return clampDirection([Math.cos(angle) * planarRadius, Math.sin(angle) * planarRadius, -1], 1);
  }

  const limit = getLegacyManualChildSpreadLimit(depth, siblingCount);
  const amount = Math.min(limit * 0.94, limit * (0.38 + 0.12 * Math.sqrt(i)));
  return clampLocalOffset([Math.cos(angle) * amount, Math.sin(angle) * amount, 0], limit);
}

function getLegacyManualChildSpreadLimit(depth: number, siblingCount: number) {
  if (depth <= 1) return Math.asin(0.5);
  const parentRadius = getLegacyShellRadius(Math.max(1, depth - 1));
  const childRadius = getLegacyShellRadius(depth);
  const siblingSpread = siblingCount <= 1 ? 0 : Math.min(2.2, siblingCount * 0.22);
  const targetRadii = 3.4 + siblingSpread;
  const focusedDistance = 300;
  const visibleDepth = Math.max(focusedDistance * 0.65, childRadius - parentRadius + focusedDistance);
  const requiredScreenRatio = (28 * targetRadii) / focusedDistance;
  return Math.atan((requiredScreenRatio * visibleDepth) / childRadius);
}

function getLegacyShellRadius(depth: number) {
  if (depth <= 1) return 360;
  return 360 + 340 * (depth - 1);
}

function seededAngle(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2;
}

function clampDirection(vector: Vec3, planarLimit: number): Vec3 {
  const normalized = normalize(vector);
  const x = normalized[0];
  const y = normalized[1];
  const planar = Math.hypot(x, y);
  const limitedPlanar = Math.min(planar, planarLimit);
  const scaleToLimit = planar > 0 ? limitedPlanar / planar : 0;
  return normalize([
    x * scaleToLimit,
    y * scaleToLimit,
    -Math.sqrt(Math.max(0.0001, 1 - limitedPlanar * limitedPlanar)),
  ]);
}

function clampLocalOffset(position: Vec3, limit: number): Vec3 {
  const amount = Math.hypot(position[0], position[1]);
  if (amount <= limit) return [position[0], position[1], 0];
  const scaleToLimit = amount > 0 ? limit / amount : 0;
  return [position[0] * scaleToLimit, position[1] * scaleToLimit, 0];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function assertVecClose(actual: Vec3 | undefined, expected: Vec3 | undefined, message: string) {
  assert.ok(actual, `${message}: missing actual`);
  assert.ok(expected, `${message}: missing expected`);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) < 0.000001, `${message}: axis ${index}`);
  }
}

function distanceFromRoot(position: Vec3 | undefined) {
  assert.ok(position, "missing position");
  return Math.hypot(position[0], position[1], position[2]);
}

function tierFromDistance(position: Vec3 | undefined) {
  assert.ok(position, "missing position");
  const distance = Math.hypot(position[0], position[1], position[2]);
  return Math.round((distance - 360) / 340) + 1;
}

function assertMinDistance(frame: ReturnType<typeof deriveAtlasLayoutFrame>, minDistance: number, message: string) {
  const entries = [...frame.positions.entries()].filter(([id]) => frame.visibleIds.has(id));
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftId, left] = entries[leftIndex];
      const [rightId, right] = entries[rightIndex];
      const distance = Math.hypot(left[0] - right[0], left[1] - right[1]);
      assert.ok(distance >= minDistance, `${message}: ${leftId} and ${rightId} are ${distance.toFixed(2)} apart`);
    }
  }
}

function collectNodeIds(tree: AtlasNode): string[] {
  return [tree.id, ...tree.children.flatMap((child) => collectNodeIds(child))];
}

function findNode(tree: AtlasNode, id: string): AtlasNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

function cloneTree(tree: AtlasNode): AtlasNode {
  return JSON.parse(JSON.stringify(tree)) as AtlasNode;
}

function node(id: string, title: string, children: AtlasNode[] = []): AtlasNode {
  const now = "2026-06-11T00:00:00.000Z";
  return {
    id,
    kind: id === "atlas-root" ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: "",
    body: `${title} body.`,
    author: "human",
    status: "waiting",
    color: "#88aaff",
    texture: "speckled",
    radius: id === "atlas-root" ? 80 : 28,
    summary: `${title} summary.`,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  };
}
