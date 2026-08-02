import assert from "node:assert/strict";
import { deriveAtlasLayout, deriveAtlasLayoutFrame, getManualChildSpreadLimit, getStoredPositionForWorldDirection, stabilizePhyllotaxisPositions, type Vec3 } from "../src/layout/atlasLayout.ts";
import { createNotebookFromTemplate } from "../src/notebookTemplates.ts";
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

const stabilizedRoot = stabilizePhyllotaxisPositions(root);
const stabilizedBeforeDelete = deriveAtlasLayout(stabilizedRoot);
const alphaBeforeDelete = stabilizedBeforeDelete.get("alpha");
const gammaBeforeDelete = stabilizedBeforeDelete.get("gamma");
const deletedSiblingRoot = cloneTree(stabilizedRoot);
deletedSiblingRoot.children = deletedSiblingRoot.children.filter((child) => child.id !== "beta");
const stabilizedAfterDelete = deriveAtlasLayout(deletedSiblingRoot);
assertVecClose(stabilizedAfterDelete.get("alpha"), alphaBeforeDelete, "deleting a root sibling must not move alpha");
assertVecClose(stabilizedAfterDelete.get("gamma"), gammaBeforeDelete, "deleting a root sibling must not move gamma");

const stabilizedNestedRoot = cloneTree(stabilizedRoot);
const stabilizedAlpha = findNode(stabilizedNestedRoot, "alpha");
assert.ok(stabilizedAlpha);
const nestedBeforeDelete = deriveAtlasLayout(stabilizedNestedRoot);
const alphaTwoBeforeDelete = nestedBeforeDelete.get("alpha-2");
stabilizedAlpha.children = stabilizedAlpha.children.filter((child) => child.id !== "alpha-1");
const nestedAfterDelete = deriveAtlasLayout(stabilizedNestedRoot);
assertVecClose(nestedAfterDelete.get("alpha-2"), alphaTwoBeforeDelete, "deleting a nested sibling must preserve parent-relative placement");

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

const denseTreeRoot = node("atlas-root", "Dense", [
  node("dense-alpha", "Dense Alpha", Array.from({ length: 36 }, (_, index) => node(`dense-alpha-${index}`, `Dense Alpha ${index}`))),
  node("dense-beta", "Dense Beta"),
  node("dense-gamma", "Dense Gamma"),
]);
const denseTreeLayout = deriveAtlasLayout(denseTreeRoot, "tree", undefined, { viewportWidth: 1000, viewportHeight: 800 });
assertVecClose(denseTreeLayout.get("dense-alpha"), [-450, 92 - 190, -1320], "tree root children should use fixed viewport-derived sibling width");
assertVecClose(denseTreeLayout.get("dense-beta"), [0, 92 - 190, -1320], "tree root siblings should be evenly distributed within the fixed width");
assertVecClose(denseTreeLayout.get("dense-gamma"), [450, 92 - 190, -1320], "tree descendant count should not expand root sibling width");

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

const mobileLandscapeTreeLayout = deriveAtlasLayout(root, "tree", undefined, { focusNodeId: "alpha", viewport: "mobile-landscape", viewportWidth: 844, viewportHeight: 390 });
assert.ok((mobileLandscapeTreeLayout.get("alpha-1")?.[1] ?? 0) < (mobileLandscapeTreeLayout.get("alpha")?.[1] ?? 0), "mobile landscape tree children should stay below parents");
assert.ok((mobileLandscapeTreeLayout.get("atlas-root")?.[1] ?? 0) > (mobileLandscapeTreeLayout.get("alpha")?.[1] ?? 0), "mobile landscape tree parent should stay above active node");
assert.ok(
  Math.abs((mobileLandscapeTreeLayout.get("alpha-1")?.[1] ?? 0) - (mobileLandscapeTreeLayout.get("alpha")?.[1] ?? 0)) < 190,
  "mobile landscape tree should use a tighter vertical gap than desktop",
);

const mindMapLayout = deriveAtlasLayout(root, "mind-map");
assert.ok(distanceFromRoot(mindMapLayout.get("alpha")) < distanceFromRoot(mindMapLayout.get("alpha-1")), "mind map descendants should move outward");
assert.equal(JSON.stringify([...mindMapLayout.entries()]), JSON.stringify([...deriveAtlasLayout(root, "mind-map").entries()]), "mind map layout should be deterministic");

const mobileMindMapLayout = deriveAtlasLayout(root, "mind-map", undefined, { viewport: "mobile-portrait" });
assert.ok(distanceFromRoot(mobileMindMapLayout.get("alpha")) < distanceFromRoot(mindMapLayout.get("alpha")), "mobile mind map should use a tighter first ring than desktop");

const focusedMindMapLayout = deriveAtlasLayout(root, "mind-map", undefined, { focusNodeId: "alpha" });
assertVecClose(focusedMindMapLayout.get("alpha"), [0, 0, -1320], "mind map focused node should be centered in the 2D plane");
assert.equal(focusedMindMapLayout.get("alpha")?.[2], focusedMindMapLayout.get("gamma")?.[2], "mind map layout should be flat");
const focusedMindMapFrame = deriveAtlasLayoutFrame(root, "mind-map", undefined, { focusNodeId: "alpha" });
assert.ok(focusedMindMapFrame.visibleIds.has("alpha"));
assert.ok(focusedMindMapFrame.visibleIds.has("atlas-root"), "mind map should show focused parent");
assert.ok(focusedMindMapFrame.visibleIds.has("beta"), "mind map should show focused siblings near parent context");
assertMinDistance(focusedMindMapFrame, 46, "mind map visible nodes should not collapse onto each other");

const travelTemplate = createNotebookFromTemplate("travel", "en");
assertWideTemplatePositions(travelTemplate);

const calendarRoot = node("calendar-root", "Calendar", [
  node("unscheduled", "No reminder"),
  node("calendar-a", "Monday morning"),
  node("calendar-b", "Monday noon"),
  node("calendar-c", "Monday afternoon"),
  node("calendar-d", "Monday evening"),
  node("calendar-e", "Monday night"),
  node("calendar-next-week", "Next week"),
]);
for (const [id, reminderAt] of [
  ["calendar-a", "2026-07-13T09:00:00"],
  ["calendar-b", "2026-07-13T12:00:00"],
  ["calendar-c", "2026-07-13T15:00:00"],
  ["calendar-d", "2026-07-13T18:00:00"],
  ["calendar-e", "2026-07-13T21:00:00"],
  ["calendar-next-week", "2026-07-20T10:00:00"],
] as const) {
  const scheduled = findNode(calendarRoot, id);
  assert.ok(scheduled);
  scheduled.reminderAt = reminderAt;
}
const calendarFrame = deriveAtlasLayoutFrame(calendarRoot, "calendar", undefined, { viewport: "desktop", locale: "en" });
assert.equal(calendarFrame.planeZ, -1320, "calendar should use the generated-layout Cartesian plane");
assert.ok(!calendarFrame.visibleIds.has("unscheduled"), "calendar should omit nodes without reminders");
assert.equal(calendarFrame.visibleIds.size, 6, "calendar should include every scheduled node");
const denseCalendarPositions = ["calendar-a", "calendar-b", "calendar-c", "calendar-d", "calendar-e"].map((id) => calendarFrame.positions.get(id));
assert.ok(denseCalendarPositions.every(Boolean), "calendar should position every node in a dense day");
assert.equal(new Set(denseCalendarPositions.map((position) => position?.[0])).size, 3, "five nodes in one day should use a near-square three-column grid");
assert.equal(new Set(denseCalendarPositions.map((position) => position?.[1])).size, 2, "five nodes in one day should use two rows");
assert.ok((calendarFrame.nodeScales.get("calendar-a") ?? 1) < 1, "dense calendar days should reduce node scale to stay inside the cell");
assert.equal(calendarFrame.labelScales.get("calendar-a"), 0, "dense calendar days should collapse non-focused titles into a count badge");
assert.ok((calendarFrame.positions.get("calendar-next-week")?.[1] ?? 0) < (calendarFrame.positions.get("calendar-a")?.[1] ?? 0), "later calendar weeks should be placed lower");
assert.ok(calendarFrame.overlay.lines.length >= 11, "calendar should expose reusable spatial grid lines");
assert.equal(calendarFrame.overlay.labels.filter((label) => label.tone === "weekday").length, 7, "calendar should render seven weekday labels");
assert.ok(calendarFrame.overlay.labels.some((label) => label.text === "MON"), "calendar should localize and render Monday");
assert.ok(calendarFrame.overlay.labels.some((label) => label.tone === "count" && label.text === "×5"), "dense calendar days should expose an item-count guide label");

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

function assertWideTemplatePositions(root: AtlasNode) {
  const visit = (node: AtlasNode, depth: number) => {
    node.children.forEach((child) => {
      assert.ok(child.position, `template child ${child.title} should have a stable phyllotaxis position`);
      if (depth + 1 > 1) {
        const limit = getManualChildSpreadLimit(depth + 1, node.children.length);
        const spreadRatio = Math.hypot(child.position[0], child.position[1]) / limit;
        assert.ok(spreadRatio >= 0.8, `template child ${child.title} should be visibly separated from its parent`);
      }
      visit(child, depth + 1);
    });
  };
  visit(root, 0);
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
