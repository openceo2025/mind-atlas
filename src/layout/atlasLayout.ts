import type { AtlasNode } from "../types";

export type Vec3 = [number, number, number];
export type AtlasLayoutMode = "phyllotaxis" | "tree" | "mind-map" | "hub-emphasis";
export type AtlasPositionOverrides = Map<string, Vec3> | Record<string, Vec3 | undefined>;

export const NOTEBOOK_FIRST_SHELL_RADIUS = 360;
export const NOTEBOOK_SHELL_GAP = 340;
export const TOP_LEVEL_PLANAR_LIMIT = 0.5;
export const TOP_LEVEL_DRAG_PLANAR_LIMIT = Math.min(1, TOP_LEVEL_PLANAR_LIMIT * 2);

const FOCUSED_NODE_CAMERA_DISTANCE = 300;
const NOTEBOOK_NODE_RADIUS = 28;
const MIN_CHILD_SCREEN_SEPARATION_RADII = 3.4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function deriveAtlasLayout(
  tree: AtlasNode,
  mode: AtlasLayoutMode = "phyllotaxis",
  overrides: AtlasPositionOverrides = collectPositionOverrides(tree),
): Map<string, Vec3> {
  switch (mode) {
    case "phyllotaxis":
      return derivePhyllotaxisLayout(tree, overrides);
    case "tree":
      return deriveTreeLayout(tree);
    case "mind-map":
      return deriveMindMapLayout(tree);
    case "hub-emphasis":
      return deriveHubEmphasisLayout(tree);
  }
}

function derivePhyllotaxisLayout(tree: AtlasNode, overrides: AtlasPositionOverrides): Map<string, Vec3> {
  const positions = new Map<string, Vec3>([[tree.id, [0, 0, 0]]]);
  const overrideMap = normalizeOverrides(overrides);

  const visit = (node: AtlasNode, path: AtlasNode[]) => {
    node.children.forEach((child) => {
      const childPath = [...path, child];
      positions.set(child.id, getNodeWorldPositionFromPath(childPath, overrideMap));
      visit(child, childPath);
    });
  };

  visit(tree, [tree]);
  return positions;
}

function deriveTreeLayout(tree: AtlasNode): Map<string, Vec3> {
  const positions = new Map<string, Vec3>([[tree.id, [0, 0, 0]]]);
  const leafSlots = new Map<string, number>();
  let slot = 0;

  const assignSlots = (node: AtlasNode): number => {
    if (!node.children.length) {
      leafSlots.set(node.id, slot);
      slot += 1;
      return leafSlots.get(node.id) ?? 0;
    }
    const childSlots = node.children.map(assignSlots);
    const center = childSlots.reduce((sum, value) => sum + value, 0) / childSlots.length;
    leafSlots.set(node.id, center);
    return center;
  };

  assignSlots(tree);
  const centerSlot = (Math.max(1, slot) - 1) / 2;
  const visit = (node: AtlasNode, depth: number) => {
    for (const child of node.children) {
      const childDepth = depth + 1;
      const x = ((leafSlots.get(child.id) ?? 0) - centerSlot) * 230;
      const y = -childDepth * 185;
      const z = -640 - childDepth * 90;
      positions.set(child.id, [x, y, z]);
      visit(child, childDepth);
    }
  };
  visit(tree, 0);
  return positions;
}

function deriveMindMapLayout(tree: AtlasNode): Map<string, Vec3> {
  const positions = new Map<string, Vec3>([[tree.id, [0, 0, 0]]]);
  const topLevelCount = Math.max(1, tree.children.length);
  tree.children.forEach((child, index) => {
    const startAngle = (Math.PI * 2 * index) / topLevelCount - Math.PI / 2;
    const endAngle = (Math.PI * 2 * (index + 1)) / topLevelCount - Math.PI / 2;
    placeRadialSubtree(child, 1, startAngle, endAngle, positions);
  });
  return positions;
}

function deriveHubEmphasisLayout(tree: AtlasNode): Map<string, Vec3> {
  const positions = new Map<string, Vec3>([[tree.id, [0, 0, 0]]]);
  const scores = new Map<string, number>();
  const tagCounts = collectTagCounts(tree);
  const scoreNode = (node: AtlasNode): number => {
    const childScore = node.children.reduce((sum, child) => sum + scoreNode(child), 0);
    const tagScore = node.tags.reduce((sum, tag) => sum + Math.max(0, (tagCounts.get(tag) ?? 1) - 1), 0);
    const score = 1 + node.children.length * 1.8 + tagScore * 0.9 + childScore * 0.28;
    scores.set(node.id, score);
    return score;
  };
  scoreNode(tree);

  const topLevelCount = Math.max(1, tree.children.length);
  tree.children
    .map((child, index) => ({ child, index, score: scores.get(child.id) ?? 1 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .forEach(({ child, index, score }, sortedIndex) => {
      const angle = (Math.PI * 2 * sortedIndex) / topLevelCount - Math.PI / 2;
      placeHubSubtree(child, 1, angle, score, scores, positions);
    });
  return positions;
}

export function collectPositionOverrides(tree: AtlasNode): Map<string, Vec3> {
  const overrides = new Map<string, Vec3>();
  const visit = (node: AtlasNode) => {
    if (node.position) overrides.set(node.id, node.position);
    node.children.forEach(visit);
  };
  visit(tree);
  return overrides;
}

export function getNodeWorldPositionFromPath(path: AtlasNode[], overrides: AtlasPositionOverrides = collectPositionOverrides(path[0])): Vec3 {
  if (path.length <= 1) return [0, 0, 0];

  const overrideMap = normalizeOverrides(overrides);
  let world: Vec3 = [0, 0, 0];
  let direction: Vec3 = [0, 0, 1];
  for (let depth = 1; depth < path.length; depth += 1) {
    const node = path[depth];
    const parent = path[depth - 1];
    const siblings = parent.children;
    const index = Math.max(0, siblings.findIndex((item) => item.id === node.id));
    const override = overrideMap.get(node.id);

    if (override) {
      direction =
        depth === 1
          ? clampDirection(override, TOP_LEVEL_DRAG_PLANAR_LIMIT)
          : directionFromStoredChildPosition(direction, override, depth, siblings.length);
      world = scale(direction, getShellRadius(depth));
      continue;
    }

    direction =
      depth === 1
        ? getPhyllotaxisTopLevelDirection(index)
        : getPhyllotaxisChildDirection(direction, depth, siblings.length, index, parent.id);
    world = scale(direction, getShellRadius(depth));
  }

  return world;
}

export function getStoredPositionForWorldDirection(
  parentPath: AtlasNode[],
  worldPosition: Vec3,
  depth: number,
  siblingCount: number,
): Vec3 {
  if (depth <= 1) {
    return clampDirection(worldPosition, TOP_LEVEL_DRAG_PLANAR_LIMIT);
  }

  const parentDirection = normalize(getNodeWorldPositionFromPath(parentPath));
  const desiredDirection = normalize(worldPosition);
  return localOffsetFromDirections(parentDirection, desiredDirection, getManualChildSpreadLimit(depth, siblingCount));
}

export function getAtlasLayoutModeLabel(mode: AtlasLayoutMode) {
  switch (mode) {
    case "phyllotaxis":
      return "Phyllotaxis";
    case "tree":
      return "Tree";
    case "mind-map":
      return "Mind map";
    case "hub-emphasis":
      return "Hub emphasis";
  }
}

export function isAtlasLayoutMode(value: unknown): value is AtlasLayoutMode {
  return value === "phyllotaxis" || value === "tree" || value === "mind-map" || value === "hub-emphasis";
}

export function getShellRadius(depth: number) {
  if (depth <= 1) return NOTEBOOK_FIRST_SHELL_RADIUS;
  return NOTEBOOK_FIRST_SHELL_RADIUS + NOTEBOOK_SHELL_GAP * (depth - 1);
}

export function getPlanarLimitForDepth(depth: number) {
  return depth <= 1 ? TOP_LEVEL_DRAG_PLANAR_LIMIT : TOP_LEVEL_PLANAR_LIMIT;
}

export function getManualChildSpreadLimit(depth: number, siblingCount: number) {
  if (depth <= 1) return Math.asin(TOP_LEVEL_PLANAR_LIMIT);
  return getChildSpread(depth, siblingCount);
}

export function clampDirection(vector: Vec3, planarLimit: number): Vec3 {
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

export function looksLikeLegacyWorldDirection(position: Vec3) {
  return position[2] < -0.2 || Math.hypot(position[0], position[1], position[2]) > 0.7;
}

function getPhyllotaxisTopLevelDirection(index: number): Vec3 {
  const i = index + 1;
  const angle = seededAngle("atlas-root") + i * GOLDEN_ANGLE;
  const planarRadius = Math.min(TOP_LEVEL_DRAG_PLANAR_LIMIT * 0.92, 0.22 + 0.12 * Math.sqrt(i));
  return clampDirection([Math.cos(angle) * planarRadius, Math.sin(angle) * planarRadius, -1], TOP_LEVEL_DRAG_PLANAR_LIMIT);
}

function placeRadialSubtree(node: AtlasNode, depth: number, startAngle: number, endAngle: number, positions: Map<string, Vec3>) {
  const angle = (startAngle + endAngle) / 2;
  const radius = 280 + depth * 260;
  positions.set(node.id, [Math.cos(angle) * radius, Math.sin(angle) * radius, -620 - depth * 80]);
  if (!node.children.length) return;

  const spread = Math.min(Math.PI * 0.72, Math.max(0.42, endAngle - startAngle));
  const childStart = angle - spread / 2;
  const childStep = spread / Math.max(1, node.children.length);
  node.children.forEach((child, index) => {
    placeRadialSubtree(child, depth + 1, childStart + childStep * index, childStart + childStep * (index + 1), positions);
  });
}

function placeHubSubtree(
  node: AtlasNode,
  depth: number,
  angle: number,
  inheritedScore: number,
  scores: Map<string, number>,
  positions: Map<string, Vec3>,
) {
  const score = scores.get(node.id) ?? inheritedScore;
  const hubPull = Math.min(180, Math.log2(score + 1) * 58);
  const radius = Math.max(220, 410 + depth * 235 - hubPull);
  const orbitSkew = Math.sin(depth * 1.7 + score) * 54;
  positions.set(node.id, [
    Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * orbitSkew,
    Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * orbitSkew,
    -620 - depth * 86 + Math.min(90, score * 8),
  ]);
  if (!node.children.length) return;

  const sortedChildren = node.children
    .map((child, index) => ({ child, index, score: scores.get(child.id) ?? 1 }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const spread = Math.min(Math.PI * 0.82, 0.36 + sortedChildren.length * 0.2);
  sortedChildren.forEach(({ child }, index) => {
    const offset = sortedChildren.length <= 1 ? 0 : -spread / 2 + (spread * index) / (sortedChildren.length - 1);
    placeHubSubtree(child, depth + 1, angle + offset, score, scores, positions);
  });
}

function collectTagCounts(tree: AtlasNode) {
  const counts = new Map<string, number>();
  const visit = (node: AtlasNode) => {
    node.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    node.children.forEach(visit);
  };
  visit(tree);
  return counts;
}

function getPhyllotaxisChildDirection(parentDirection: Vec3, depth: number, siblingCount: number, childIndex: number, parentId: string): Vec3 {
  const i = childIndex + 1;
  const angle = seededAngle(parentId) + i * GOLDEN_ANGLE;
  const limit = getManualChildSpreadLimit(depth, siblingCount);
  const amount = Math.min(limit * 0.94, limit * (0.38 + 0.12 * Math.sqrt(i)));
  return directionFromStoredChildPosition(parentDirection, [Math.cos(angle) * amount, Math.sin(angle) * amount, 0], depth, siblingCount);
}

function seededAngle(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2;
}

function getChildSpread(depth: number, siblingCount: number) {
  const parentRadius = getShellRadius(Math.max(1, depth - 1));
  const childRadius = getShellRadius(depth);
  const siblingSpread = siblingCount <= 1 ? 0 : Math.min(2.2, siblingCount * 0.22);
  const targetRadii = MIN_CHILD_SCREEN_SEPARATION_RADII + siblingSpread;
  const visibleDepth = Math.max(FOCUSED_NODE_CAMERA_DISTANCE * 0.65, childRadius - parentRadius + FOCUSED_NODE_CAMERA_DISTANCE);
  const requiredScreenRatio = (NOTEBOOK_NODE_RADIUS * targetRadii) / FOCUSED_NODE_CAMERA_DISTANCE;
  return Math.atan((requiredScreenRatio * visibleDepth) / childRadius);
}

function directionFromStoredChildPosition(parentDirection: Vec3, storedPosition: Vec3, depth: number, siblingCount: number) {
  const limit = getManualChildSpreadLimit(depth, siblingCount);
  const local = looksLikeLegacyWorldDirection(storedPosition)
    ? localOffsetFromDirections(parentDirection, storedPosition, limit)
    : clampLocalOffset(storedPosition, limit);
  const { tangentA, tangentB } = tangentBasis(parentDirection);
  const amount = Math.hypot(local[0], local[1]);
  if (amount <= 0.0001) return normalize(parentDirection);

  const tangent = normalize(add(scale(tangentA, local[0] / amount), scale(tangentB, local[1] / amount)));
  return normalize(add(scale(normalize(parentDirection), Math.cos(amount)), scale(tangent, Math.sin(amount))));
}

function localOffsetFromDirections(parentDirection: Vec3, desiredDirection: Vec3, limit: number): Vec3 {
  const forward = normalize(parentDirection);
  const desired = normalize(desiredDirection);
  const { tangentA, tangentB } = tangentBasis(forward);
  const dot = Math.min(1, Math.max(-1, forward[0] * desired[0] + forward[1] * desired[1] + forward[2] * desired[2]));
  const angle = Math.min(limit, Math.acos(dot));
  const tangentProjection = normalize(add(scale(tangentA, desired[0] * tangentA[0] + desired[1] * tangentA[1] + desired[2] * tangentA[2]), scale(tangentB, desired[0] * tangentB[0] + desired[1] * tangentB[1] + desired[2] * tangentB[2])));
  if (Math.hypot(tangentProjection[0], tangentProjection[1], tangentProjection[2]) <= 0.0001 || angle <= 0.0001) return [0, 0, 0];
  return [
    (tangentProjection[0] * tangentA[0] + tangentProjection[1] * tangentA[1] + tangentProjection[2] * tangentA[2]) * angle,
    (tangentProjection[0] * tangentB[0] + tangentProjection[1] * tangentB[1] + tangentProjection[2] * tangentB[2]) * angle,
    0,
  ];
}

function clampLocalOffset(position: Vec3, limit: number): Vec3 {
  const amount = Math.hypot(position[0], position[1]);
  if (amount <= limit) return [position[0], position[1], 0];
  const scaleToLimit = amount > 0 ? limit / amount : 0;
  return [position[0] * scaleToLimit, position[1] * scaleToLimit, 0];
}

function tangentBasis(parentDirection: Vec3) {
  const forward = normalize(parentDirection);
  const reference: Vec3 = Math.abs(forward[1]) > 0.86 ? [1, 0, 0] : [0, 1, 0];
  const tangentA = normalize(cross(reference, forward));
  const tangentB = normalize(cross(forward, tangentA));
  return { tangentA, tangentB };
}

function normalizeOverrides(overrides: AtlasPositionOverrides): Map<string, Vec3> {
  return overrides instanceof Map
    ? overrides
    : new Map(Object.entries(overrides).filter((entry): entry is [string, Vec3] => Boolean(entry[1])));
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
