import type { AtlasNode } from "../types";

export type Vec3 = [number, number, number];
export type AtlasLayoutMode = "phyllotaxis" | "tree" | "mind-map";
export type AtlasPositionOverrides = Map<string, Vec3> | Record<string, Vec3 | undefined>;
export type AtlasLayoutViewport = "desktop" | "mobile-portrait" | "mobile-landscape";

export interface AtlasLayoutOptions {
  focusNodeId?: string;
  viewport?: AtlasLayoutViewport;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface AtlasLayoutFrame {
  positions: Map<string, Vec3>;
  visibleIds: Set<string>;
  planeZ: number | null;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export const NOTEBOOK_FIRST_SHELL_RADIUS = 360;
export const NOTEBOOK_SHELL_GAP = 340;
export const TOP_LEVEL_PLANAR_LIMIT = 0.5;
export const TOP_LEVEL_DRAG_PLANAR_LIMIT = Math.min(1, TOP_LEVEL_PLANAR_LIMIT * 2);

const FOCUSED_NODE_CAMERA_DISTANCE = 300;
const NOTEBOOK_NODE_RADIUS = 28;
const MIN_CHILD_SCREEN_SEPARATION_RADII = 3.4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FOCUS_LAYOUT_PLANE_Z = -1320;
const TREE_ACTIVE_Y = 92;
const TREE_DESKTOP_X_GAP = 220;
const TREE_DESKTOP_Y_GAP = 190;
const TREE_MOBILE_ACTIVE_X = -170;
const TREE_MOBILE_X_GAP = 235;
const TREE_MOBILE_Y_GAP = 150;
const TREE_MOBILE_LANDSCAPE_ACTIVE_Y = 32;
const TREE_MOBILE_LANDSCAPE_Y_GAP = 132;
const MIND_MAP_MIN_CHILD_RADIUS = 180;
const MIND_MAP_MAX_CHILD_RADIUS = 350;
const MIND_MAP_SIBLING_SCREEN_GAP = 118;
const MIND_MAP_MOBILE_MIN_CHILD_RADIUS = 132;
const MIND_MAP_MOBILE_MAX_CHILD_RADIUS = 260;
const MIND_MAP_MOBILE_SIBLING_SCREEN_GAP = 86;
const TREE_NODE_GAP = 190;
const FOCUS_LAYOUT_MAX_DESCENDANT_DEPTH = 5;
const TREE_SIBLING_SPAN_VIEWPORT_RATIO = 0.9;
const TREE_MOBILE_SIBLING_SPAN_VIEWPORT_RATIO = 0.68;
const TREE_MOBILE_LANDSCAPE_SIBLING_SPAN_VIEWPORT_RATIO = 0.72;
const TREE_DESKTOP_MIN_SIBLING_SPAN = 560;
const TREE_DESKTOP_MAX_SIBLING_SPAN = 1280;
const TREE_MOBILE_MIN_SIBLING_SPAN = 320;
const TREE_MOBILE_MAX_SIBLING_SPAN = 640;
const TREE_MOBILE_LANDSCAPE_MIN_SIBLING_SPAN = 420;
const TREE_MOBILE_LANDSCAPE_MAX_SIBLING_SPAN = 760;
const MIND_MAP_RING_GAP = 235;
const MIND_MAP_MOBILE_RING_GAP = 170;
const MIND_MAP_PARENT_SECTOR = Math.PI / 3;

type TreeLayoutMetrics = {
  active: Vec3;
  sideways: boolean;
  xGap: number;
  yGap: number;
  siblingSpan: number;
};

type MindMapLayoutMetrics = {
  minChildRadius: number;
  maxChildRadius: number;
  siblingScreenGap: number;
  ringGap: number;
  siblingGap: number;
  siblingYOffset: number;
  ancestorGap: number;
};

export function deriveAtlasLayout(
  tree: AtlasNode,
  mode: AtlasLayoutMode = "phyllotaxis",
  overrides: AtlasPositionOverrides = collectPositionOverrides(tree),
  options: AtlasLayoutOptions = {},
): Map<string, Vec3> {
  return deriveAtlasLayoutFrame(tree, mode, overrides, options).positions;
}

export function deriveAtlasLayoutFrame(
  tree: AtlasNode,
  mode: AtlasLayoutMode = "phyllotaxis",
  overrides: AtlasPositionOverrides = collectPositionOverrides(tree),
  options: AtlasLayoutOptions = {},
): AtlasLayoutFrame {
  let positions: Map<string, Vec3>;
  let visibleIds: Set<string>;
  let planeZ: number | null = null;

  switch (mode) {
    case "phyllotaxis": {
      positions = derivePhyllotaxisLayout(tree, overrides);
      visibleIds = new Set(positions.keys());
      break;
    }
    case "tree": {
      positions = deriveTreeLayout(tree, options);
      visibleIds = new Set(positions.keys());
      planeZ = FOCUS_LAYOUT_PLANE_Z;
      break;
    }
    case "mind-map": {
      positions = deriveMindMapLayout(tree, options);
      visibleIds = new Set(positions.keys());
      planeZ = FOCUS_LAYOUT_PLANE_Z;
      break;
    }
  }

  return {
    positions,
    visibleIds,
    planeZ,
    bounds: getLayoutBounds(positions, visibleIds),
  };
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

function deriveTreeLayout(tree: AtlasNode, options: AtlasLayoutOptions): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  const focusPath = findAtlasNodePath(tree, options.focusNodeId ?? tree.id) ?? [tree];
  const focusNode = focusPath[focusPath.length - 1] ?? tree;
  const metrics = getTreeLayoutMetrics(options);

  if (focusNode.id === tree.id) {
    positions.set(tree.id, metrics.active);
    layoutTreeChildren(tree.children, metrics.active, 1, metrics, FOCUS_LAYOUT_MAX_DESCENDANT_DEPTH, positions);
    return positions;
  }

  positions.set(focusNode.id, metrics.active);
  layoutAncestorChain(focusPath, metrics, positions);
  const parent = focusPath.length > 1 ? focusPath[focusPath.length - 2] : null;
  if (parent) layoutTreeSiblings(parent.children, focusNode.id, metrics, positions);
  layoutTreeChildren(focusNode.children, metrics.active, 1, metrics, FOCUS_LAYOUT_MAX_DESCENDANT_DEPTH, positions);
  return positions;
}

function deriveMindMapLayout(tree: AtlasNode, options: AtlasLayoutOptions): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  const focusPath = findAtlasNodePath(tree, options.focusNodeId ?? tree.id) ?? [tree];
  const focusNode = focusPath[focusPath.length - 1] ?? tree;
  const metrics = getMindMapLayoutMetrics(options.viewport);
  const focusPosition: Vec3 = [0, 0, FOCUS_LAYOUT_PLANE_Z];
  positions.set(focusNode.id, focusPosition);

  const parent = focusPath.length > 1 ? focusPath[focusPath.length - 2] : null;
  if (parent) {
    const parentPosition: Vec3 = [0, getMindMapChildRadius(1, 1, metrics), FOCUS_LAYOUT_PLANE_Z];
    positions.set(parent.id, parentPosition);
    placeMindMapAncestorChain(focusPath.slice(0, -2), parentPosition, metrics, positions);
    placeMindMapSiblings(parent.children.filter((node) => node.id !== focusNode.id), parentPosition, metrics, positions);
  }

  const availableStart = parent ? -Math.PI / 2 - (Math.PI * 2 - MIND_MAP_PARENT_SECTOR) / 2 : -Math.PI / 2;
  const availableEnd = parent ? -Math.PI / 2 + (Math.PI * 2 - MIND_MAP_PARENT_SECTOR) / 2 : availableStart + Math.PI * 2;
  placeMindMapSector(focusNode.children, focusPosition, availableStart, availableEnd, 1, metrics, positions);
  if (focusNode.id === tree.id) {
    placeMindMapSector(tree.children, focusPosition, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, 1, metrics, positions);
  }
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
  }
}

export function isAtlasLayoutMode(value: unknown): value is AtlasLayoutMode {
  return value === "phyllotaxis" || value === "tree" || value === "mind-map";
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

function layoutTreeChildren(
  children: AtlasNode[],
  parentPosition: Vec3,
  depth: number,
  metrics: TreeLayoutMetrics,
  depthRemaining: number,
  positions: Map<string, Vec3>,
) {
  if (!children.length || depthRemaining <= 0) return;

  const offsets = getTreeSiblingOffsets(children.length, metrics.siblingSpan);

  children.forEach((child, index) => {
    const laneOffset = offsets[index] ?? 0;
    const childPosition = treeOffset(parentPosition, laneOffset, metrics);
    positions.set(child.id, childPosition);
    layoutTreeChildren(child.children, childPosition, depth + 1, metrics, depthRemaining - 1, positions);
  });
}

function layoutTreeSiblings(siblings: AtlasNode[], focusNodeId: string, metrics: TreeLayoutMetrics, positions: Map<string, Vec3>) {
  const visibleSiblings = siblings.filter((node) => node.id !== focusNodeId);
  if (!visibleSiblings.length) return;
  const focusIndex = siblings.findIndex((node) => node.id === focusNodeId);
  const offsets = getTreeSiblingOffsets(siblings.length, metrics.siblingSpan);
  const focusOffset = offsets[focusIndex] ?? 0;
  visibleSiblings.forEach((sibling) => {
    const index = siblings.findIndex((node) => node.id === sibling.id);
    const offset = (offsets[index] ?? 0) - focusOffset;
    positions.set(sibling.id, metrics.sideways
      ? [metrics.active[0], metrics.active[1] - offset, FOCUS_LAYOUT_PLANE_Z]
      : [metrics.active[0] + offset, metrics.active[1], FOCUS_LAYOUT_PLANE_Z]);
  });
}

function layoutAncestorChain(path: AtlasNode[], metrics: TreeLayoutMetrics, positions: Map<string, Vec3>) {
  const ancestors = path.slice(0, -1).reverse();
  ancestors.forEach((ancestor, index) => {
    const level = index + 1;
    const position: Vec3 = metrics.sideways
      ? [metrics.active[0] - level * metrics.xGap, metrics.active[1], FOCUS_LAYOUT_PLANE_Z]
      : [metrics.active[0], metrics.active[1] + level * metrics.yGap, FOCUS_LAYOUT_PLANE_Z];
    positions.set(ancestor.id, position);
  });
}

function treeOffset(parentPosition: Vec3, laneOffset: number, metrics: TreeLayoutMetrics): Vec3 {
  return metrics.sideways
    ? [parentPosition[0] + metrics.xGap, parentPosition[1] - laneOffset, FOCUS_LAYOUT_PLANE_Z]
    : [parentPosition[0] + laneOffset, parentPosition[1] - metrics.yGap, FOCUS_LAYOUT_PLANE_Z];
}

function getTreeLayoutMetrics(options: AtlasLayoutOptions): TreeLayoutMetrics {
  if (options.viewport === "mobile-portrait") {
    return {
      active: [TREE_MOBILE_ACTIVE_X, 0, FOCUS_LAYOUT_PLANE_Z],
      sideways: true,
      xGap: TREE_MOBILE_X_GAP,
      yGap: TREE_MOBILE_Y_GAP,
      siblingSpan: getTreeSiblingSpan(options, "mobile-portrait"),
    };
  }
  if (options.viewport === "mobile-landscape") {
    return {
      active: [0, TREE_MOBILE_LANDSCAPE_ACTIVE_Y, FOCUS_LAYOUT_PLANE_Z],
      sideways: false,
      xGap: TREE_DESKTOP_X_GAP,
      yGap: TREE_MOBILE_LANDSCAPE_Y_GAP,
      siblingSpan: getTreeSiblingSpan(options, "mobile-landscape"),
    };
  }
  return {
    active: [0, TREE_ACTIVE_Y, FOCUS_LAYOUT_PLANE_Z],
    sideways: false,
    xGap: TREE_DESKTOP_X_GAP,
    yGap: TREE_DESKTOP_Y_GAP,
    siblingSpan: getTreeSiblingSpan(options, "desktop"),
  };
}

function getTreeSiblingSpan(options: AtlasLayoutOptions, viewport: AtlasLayoutViewport) {
  const viewportCrossAxis = viewport === "mobile-portrait" ? options.viewportHeight : options.viewportWidth;
  const fallback =
    viewport === "mobile-portrait"
      ? TREE_MOBILE_MAX_SIBLING_SPAN
      : viewport === "mobile-landscape"
      ? TREE_MOBILE_LANDSCAPE_MAX_SIBLING_SPAN
      : TREE_DESKTOP_MAX_SIBLING_SPAN;
  const min =
    viewport === "mobile-portrait"
      ? TREE_MOBILE_MIN_SIBLING_SPAN
      : viewport === "mobile-landscape"
      ? TREE_MOBILE_LANDSCAPE_MIN_SIBLING_SPAN
      : TREE_DESKTOP_MIN_SIBLING_SPAN;
  const max =
    viewport === "mobile-portrait"
      ? TREE_MOBILE_MAX_SIBLING_SPAN
      : viewport === "mobile-landscape"
      ? TREE_MOBILE_LANDSCAPE_MAX_SIBLING_SPAN
      : TREE_DESKTOP_MAX_SIBLING_SPAN;
  const ratio =
    viewport === "mobile-portrait"
      ? TREE_MOBILE_SIBLING_SPAN_VIEWPORT_RATIO
      : viewport === "mobile-landscape"
      ? TREE_MOBILE_LANDSCAPE_SIBLING_SPAN_VIEWPORT_RATIO
      : TREE_SIBLING_SPAN_VIEWPORT_RATIO;
  const viewportSpan = Number.isFinite(viewportCrossAxis) && viewportCrossAxis ? viewportCrossAxis * ratio : fallback;
  return clampNumber(viewportSpan, min, max);
}

function getTreeSiblingOffsets(count: number, siblingSpan: number) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const gap = siblingSpan / Math.max(1, count - 1);
  const start = -siblingSpan / 2;
  return Array.from({ length: count }, (_, index) => start + index * gap);
}

function placeMindMapSector(
  nodes: AtlasNode[],
  center: Vec3,
  startAngle: number,
  endAngle: number,
  depth: number,
  metrics: MindMapLayoutMetrics,
  positions: Map<string, Vec3>,
) {
  if (!nodes.length || depth > FOCUS_LAYOUT_MAX_DESCENDANT_DEPTH) return;

  const weights = nodes.map((node) => Math.max(1, getVisibleMindMapLeafWeight(node, FOCUS_LAYOUT_MAX_DESCENDANT_DEPTH - depth)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const available = endAngle - startAngle;
  let cursor = startAngle;
  const radius = getMindMapChildRadius(nodes.length, depth, metrics);

  nodes.forEach((node, index) => {
    const sector = available * ((weights[index] ?? 1) / totalWeight);
    const angle = cursor + sector / 2;
    const position: Vec3 = [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
      FOCUS_LAYOUT_PLANE_Z,
    ];
    positions.set(node.id, position);
    placeMindMapSector(node.children, position, cursor, cursor + sector, depth + 1, metrics, positions);
    cursor += sector;
  });
}

function placeMindMapSiblings(siblings: AtlasNode[], parentPosition: Vec3, metrics: MindMapLayoutMetrics, positions: Map<string, Vec3>) {
  if (!siblings.length) return;
  const start = -((siblings.length - 1) * metrics.siblingGap) / 2;
  siblings.forEach((sibling, index) => {
    positions.set(sibling.id, [parentPosition[0] + start + index * metrics.siblingGap, parentPosition[1] + metrics.siblingYOffset, FOCUS_LAYOUT_PLANE_Z]);
  });
}

function placeMindMapAncestorChain(ancestors: AtlasNode[], parentPosition: Vec3, metrics: MindMapLayoutMetrics, positions: Map<string, Vec3>) {
  ancestors.reverse().forEach((ancestor, index) => {
    positions.set(ancestor.id, [parentPosition[0], parentPosition[1] + (index + 1) * metrics.ancestorGap, FOCUS_LAYOUT_PLANE_Z]);
  });
}

function getMindMapChildRadius(siblingCount: number, depth: number, metrics: MindMapLayoutMetrics) {
  const countRadius = (Math.max(1, siblingCount) * metrics.siblingScreenGap) / (Math.PI * 2);
  const depthNudge = Math.min(80, Math.max(0, depth - 1) * metrics.ringGap);
  return Math.min(metrics.maxChildRadius + depthNudge, Math.max(metrics.minChildRadius + depthNudge, countRadius + depthNudge));
}

function getMindMapLayoutMetrics(viewport: AtlasLayoutViewport = "desktop"): MindMapLayoutMetrics {
  if (viewport === "mobile-portrait" || viewport === "mobile-landscape") {
    return {
      minChildRadius: MIND_MAP_MOBILE_MIN_CHILD_RADIUS,
      maxChildRadius: MIND_MAP_MOBILE_MAX_CHILD_RADIUS,
      siblingScreenGap: MIND_MAP_MOBILE_SIBLING_SCREEN_GAP,
      ringGap: MIND_MAP_MOBILE_RING_GAP,
      siblingGap: 44,
      siblingYOffset: 58,
      ancestorGap: 118,
    };
  }
  return {
    minChildRadius: MIND_MAP_MIN_CHILD_RADIUS,
    maxChildRadius: MIND_MAP_MAX_CHILD_RADIUS,
    siblingScreenGap: MIND_MAP_SIBLING_SCREEN_GAP,
    ringGap: MIND_MAP_RING_GAP,
    siblingGap: 58,
    siblingYOffset: 74,
    ancestorGap: 150,
  };
}

function getVisibleMindMapLeafWeight(node: AtlasNode, depthRemaining: number): number {
  if (depthRemaining <= 0 || !node.children.length) return 1;
  return node.children.reduce((sum, child) => sum + getVisibleMindMapLeafWeight(child, depthRemaining - 1), 0);
}

function findAtlasNodePath(root: AtlasNode, id: string): AtlasNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const path = findAtlasNodePath(child, id);
    if (path) return [root, ...path];
  }
  return null;
}

function getLayoutBounds(positions: Map<string, Vec3>, visibleIds: Set<string>) {
  const visiblePositions = [...positions.entries()]
    .filter(([id]) => visibleIds.has(id))
    .map(([, position]) => position);
  if (!visiblePositions.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }

  return {
    minX: Math.min(...visiblePositions.map((position) => position[0])),
    maxX: Math.max(...visiblePositions.map((position) => position[0])),
    minY: Math.min(...visiblePositions.map((position) => position[1])),
    maxY: Math.max(...visiblePositions.map((position) => position[1])),
    minZ: Math.min(...visiblePositions.map((position) => position[2])),
    maxZ: Math.max(...visiblePositions.map((position) => position[2])),
  };
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
