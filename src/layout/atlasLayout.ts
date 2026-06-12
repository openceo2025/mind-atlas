import type { AtlasNode } from "../types";

export type Vec3 = [number, number, number];
export type AtlasLayoutMode = "phyllotaxis" | "tree" | "mind-map" | "hub-emphasis";
export type AtlasPositionOverrides = Map<string, Vec3> | Record<string, Vec3 | undefined>;
export type AtlasLayoutViewport = "desktop" | "mobile-portrait";

export interface AtlasLayoutOptions {
  focusNodeId?: string;
  viewport?: AtlasLayoutViewport;
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
const MIND_MAP_MIN_CHILD_RADIUS = 180;
const MIND_MAP_MAX_CHILD_RADIUS = 350;
const MIND_MAP_SIBLING_SCREEN_GAP = 118;

export function deriveAtlasLayout(
  tree: AtlasNode,
  mode: AtlasLayoutMode = "phyllotaxis",
  overrides: AtlasPositionOverrides = collectPositionOverrides(tree),
  options: AtlasLayoutOptions = {},
): Map<string, Vec3> {
  switch (mode) {
    case "phyllotaxis":
      return derivePhyllotaxisLayout(tree, overrides);
    case "tree":
      return deriveTreeLayout(tree, options);
    case "mind-map":
      return deriveMindMapLayout(tree, options);
    case "hub-emphasis":
      return deriveHubEmphasisLayout(tree, overrides, options);
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

function deriveTreeLayout(tree: AtlasNode, options: AtlasLayoutOptions): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
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
  const focusPath = findAtlasNodePath(tree, options.focusNodeId ?? tree.id) ?? [tree];
  const focusNode = focusPath[focusPath.length - 1] ?? tree;
  const focusDepth = Math.max(0, focusPath.length - 1);
  const focusSlot = leafSlots.get(focusNode.id) ?? (Math.max(1, slot) - 1) / 2;
  const active: Vec3 = options.viewport === "mobile-portrait" ? [TREE_MOBILE_ACTIVE_X, 0, FOCUS_LAYOUT_PLANE_Z] : [0, TREE_ACTIVE_Y, FOCUS_LAYOUT_PLANE_Z];

  const visit = (node: AtlasNode, depth: number) => {
    const nodeSlot = leafSlots.get(node.id) ?? focusSlot;
    const depthOffset = depth - focusDepth;
    const slotOffset = nodeSlot - focusSlot;
    const position: Vec3 =
      options.viewport === "mobile-portrait"
        ? [
            active[0] + depthOffset * TREE_MOBILE_X_GAP,
            active[1] - slotOffset * TREE_MOBILE_Y_GAP,
            FOCUS_LAYOUT_PLANE_Z,
          ]
        : [
            active[0] + slotOffset * TREE_DESKTOP_X_GAP,
            active[1] - depthOffset * TREE_DESKTOP_Y_GAP,
            FOCUS_LAYOUT_PLANE_Z,
          ];
    positions.set(node.id, position);
    node.children.forEach((child) => visit(child, depth + 1));
  };
  visit(tree, 0);
  return positions;
}

function deriveMindMapLayout(tree: AtlasNode, options: AtlasLayoutOptions): Map<string, Vec3> {
  const positions = new Map<string, Vec3>([[tree.id, [0, 0, FOCUS_LAYOUT_PLANE_Z]]]);
  placeMindMapChildren(tree, [0, 0, FOCUS_LAYOUT_PLANE_Z], -Math.PI / 2, 0, positions);
  return centerLayoutOnFocus(positions, options.focusNodeId ?? tree.id, [0, 0, FOCUS_LAYOUT_PLANE_Z]);
}

function deriveHubEmphasisLayout(tree: AtlasNode, overrides: AtlasPositionOverrides, options: AtlasLayoutOptions): Map<string, Vec3> {
  const phyllotaxisPositions = derivePhyllotaxisLayout(tree, overrides);
  const positions = new Map<string, Vec3>([[tree.id, [0, 0, 0]]]);
  const nodes = flattenAtlasNodes(tree).filter((node) => node.id !== tree.id);
  const focusNodeId = options.focusNodeId ?? tree.id;
  const focusDirection = focusNodeId === tree.id ? [0, 0, -1] as Vec3 : normalize(phyllotaxisPositions.get(focusNodeId) ?? [0, 0, -1]);
  const tierByNodeId = rankNodesIntoConnectionTiers(nodes);

  for (const node of nodes) {
    const freeDirection = normalize(phyllotaxisPositions.get(node.id) ?? [0, 0, -1]);
    const centeredDirection = rotateDirectionBetween(freeDirection, focusDirection, [0, 0, -1]);
    const tier = tierByNodeId.get(node.id) ?? 10;
    positions.set(node.id, scale(centeredDirection, getShellRadius(tier)));
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

function placeMindMapChildren(
  parent: AtlasNode,
  parentPosition: Vec3,
  heading: number,
  depth: number,
  positions: Map<string, Vec3>,
) {
  const count = parent.children.length;
  if (!count) return;

  const radius = getMindMapChildRadius(count, depth + 1);
  const fullCircle = depth === 0;
  const spread = fullCircle ? Math.PI * 2 : Math.min(Math.PI * 1.08, Math.max(0.78, count * 0.22));
  const start = fullCircle ? -Math.PI / 2 : heading - spread / 2;
  const step = fullCircle
    ? (Math.PI * 2) / count
    : count <= 1
      ? 0
      : spread / (count - 1);

  parent.children.forEach((child, index) => {
    const angle = count <= 1 && !fullCircle ? heading : start + step * index;
    const childPosition: Vec3 = [
      parentPosition[0] + Math.cos(angle) * radius,
      parentPosition[1] + Math.sin(angle) * radius,
      FOCUS_LAYOUT_PLANE_Z,
    ];
    positions.set(child.id, childPosition);
    placeMindMapChildren(child, childPosition, angle, depth + 1, positions);
  });
}

function getMindMapChildRadius(siblingCount: number, depth: number) {
  const countRadius = (Math.max(1, siblingCount) * MIND_MAP_SIBLING_SCREEN_GAP) / (Math.PI * 2);
  const depthNudge = Math.min(55, Math.max(0, depth - 1) * 18);
  return Math.min(MIND_MAP_MAX_CHILD_RADIUS, Math.max(MIND_MAP_MIN_CHILD_RADIUS, countRadius + depthNudge));
}

function centerLayoutOnFocus(positions: Map<string, Vec3>, focusNodeId: string, activePosition: Vec3) {
  const focusPosition = positions.get(focusNodeId) ?? positions.values().next().value ?? activePosition;
  const delta: Vec3 = [
    activePosition[0] - focusPosition[0],
    activePosition[1] - focusPosition[1],
    activePosition[2] - focusPosition[2],
  ];
  return new Map(
    [...positions.entries()].map(([id, position]) => [
      id,
      [position[0] + delta[0], position[1] + delta[1], FOCUS_LAYOUT_PLANE_Z] as Vec3,
    ]),
  );
}

function rankNodesIntoConnectionTiers(nodes: AtlasNode[]) {
  const tiers = new Map<string, number>();
  if (!nodes.length) return tiers;

  const ranked = [...nodes].sort((a, b) => b.children.length - a.children.length || a.id.localeCompare(b.id));
  ranked.forEach((node, index) => {
    const tier = clampInteger(Math.floor((index / ranked.length) * 10) + 1, 1, 10);
    tiers.set(node.id, tier);
  });
  return tiers;
}

function flattenAtlasNodes(tree: AtlasNode): AtlasNode[] {
  return [tree, ...tree.children.flatMap((child) => flattenAtlasNodes(child))];
}

function findAtlasNodePath(root: AtlasNode, id: string): AtlasNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const path = findAtlasNodePath(child, id);
    if (path) return [root, ...path];
  }
  return null;
}

function rotateDirectionBetween(vector: Vec3, from: Vec3, to: Vec3) {
  const normalizedFrom = normalize(from);
  const normalizedTo = normalize(to);
  const axis = cross(normalizedFrom, normalizedTo);
  const sin = vectorLength(axis);
  const cos = clamp(dot(normalizedFrom, normalizedTo), -1, 1);
  if (sin <= 0.000001) {
    if (cos > 0) return vector;
    return rotateAroundAxis(vector, tangentBasis(normalizedFrom).tangentA, Math.PI);
  }

  return rotateAroundAxis(vector, scale(axis, 1 / sin), Math.atan2(sin, cos));
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const normalizedAxis = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(
    add(scale(vector, cos), scale(cross(normalizedAxis, vector), sin)),
    scale(normalizedAxis, dot(normalizedAxis, vector) * (1 - cos)),
  );
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

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vectorLength(vector: Vec3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
