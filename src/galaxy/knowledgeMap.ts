/**
 * Where every light of the galaxy sits.
 *
 * Two arrangements of the same notes:
 *
 * - native: exactly where each note is in the universe view, so a planet can
 *   turn into a star without moving;
 * - galaxy: a flat, hierarchical map — a space's branches around its root,
 *   notes around their branch, finer detail fanning outward like dendrites —
 *   that stays readable from far away. Each branch keeps the direction it has
 *   in the universe, so the map is the universe unfolded, not a reshuffle.
 *
 * The scene glides from one to the other while the camera pulls back. The
 * space the person came from sits at the origin, the others are packed around
 * it — larger ones first, spaces that share relations drawn closer — and once a
 * space has a place during a visit it keeps it, so editing never shuffles the map.
 *
 * Mode: shared-core. Pure; reads layouts and the derived graph only.
 */
import type { KnowledgeGraph, KnowledgeNode } from './knowledgeGraph.ts';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface KnowledgeCluster { spaceId: string; center: Vec2; radius: number }
export interface KnowledgeMap {
  /** Galaxy positions (the flat map). */
  positions: Map<string, Vec3>;
  /** Universe positions, offset by each space's anchor. */
  native: Map<string, Vec3>;
  clusters: Map<string, KnowledgeCluster>;
  anchors: Map<string, Vec2>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Typical distance between a note and its parent on the map; level of detail is measured in it. */
  unit: number;
}

function seeded(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };
}

function angleDiff(a: number, b: number) {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Depth relief kept on the map: deeper notes sit slightly behind, for parallax. */
const RELIEF = 14;

interface SpaceLayout { positions: Map<string, Vec2>; radius: number }

/** One space as a flat map around its root at (0, 0). */
function layoutSpace(nodes: KnowledgeNode[], native: Map<string, Vec3> | undefined): SpaceLayout {
  const children = new Map<string, KnowledgeNode[]>();
  let root: KnowledgeNode | undefined;
  for (const n of nodes) {
    if (n.depth === 0) root = n;
    if (n.parentKey) { const list = children.get(n.parentKey) ?? []; list.push(n); children.set(n.parentKey, list); }
  }
  const positions = new Map<string, Vec2>();
  if (!root) return { positions, radius: 170 };
  const size = new Map<string, number>();
  const countOf = (key: string): number => {
    const cached = size.get(key);
    if (cached !== undefined) return cached;
    const total = 1 + (children.get(key) ?? []).reduce((sum, child) => sum + countOf(child.key), 0);
    size.set(key, total);
    return total;
  };
  const nativeOf = (n: KnowledgeNode) => native?.get(n.node.id);
  const rootNative = nativeOf(root) ?? [0, 0, 0];
  /** Direction of a note from its parent in the universe, if it has one. */
  const nativeAngle = (n: KnowledgeNode, parent: KnowledgeNode) => {
    const a = nativeOf(n), b = nativeOf(parent) ?? rootNative;
    if (!a || Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) return null;
    return Math.atan2(a[1] - b[1], a[0] - b[0]);
  };

  positions.set(root.key, [0, 0]);
  const branches = children.get(root.key) ?? [];
  const branchRadius = new Map(branches.map(b => [b.key, 44 + 14 * Math.sqrt(countOf(b.key))]));
  let radius = 170 + 27 * Math.sqrt(countOf(root.key));
  // A wide, flat notebook needs a longer ring than its size alone suggests.
  const ringNeeded = branches.reduce((sum, b) => sum + branchRadius.get(b.key)! * 2 + 26, 0) / (Math.PI * 2);
  const ring = branches.length <= 1 ? 0 : Math.max(radius * .48, ringNeeded);
  radius = Math.max(radius, ring + Math.max(0, ...branchRadius.values()) * 1.15);

  const wishes = branches.map((branch, index) => {
    const angle = nativeAngle(branch, root!);
    return { branch, angle: angle ?? (index / Math.max(1, branches.length)) * Math.PI * 2, pull: angle === null ? 0 : .5 };
  }).sort((a, b) => a.angle - b.angle);
  const placed = wishes.map((wish, index) => {
    const even = wishes[0].angle + (index / Math.max(1, wishes.length)) * Math.PI * 2;
    const angle = wish.angle + angleDiff(even, wish.angle) * (1 - wish.pull * .55);
    const r = ring * (1 + .1 * (seeded(`${wish.branch.key}:ring`)() - .5));
    return { key: wish.branch.key, x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
  for (let iteration = 0; iteration < 120; iteration++) {
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const minimum = branchRadius.get(a.key)! + branchRadius.get(b.key)! + 26;
      if (distance >= minimum) continue;
      const push = (minimum - distance) * .5;
      a.x -= (dx / distance) * push; a.y -= (dy / distance) * push;
      b.x += (dx / distance) * push; b.y += (dy / distance) * push;
    }
    for (const entry of placed) {
      const distance = Math.hypot(entry.x, entry.y);
      const limit = Math.max(0, radius - branchRadius.get(entry.key)! * .6);
      if (distance > limit && distance > 0) { entry.x = (entry.x / distance) * limit; entry.y = (entry.y / distance) * limit; }
    }
  }
  for (const entry of placed) positions.set(entry.key, [entry.x, entry.y]);

  const placeDetail = (parent: KnowledgeNode, from: Vec2) => {
    const anchor = positions.get(parent.key)!;
    const kids = children.get(parent.key) ?? [];
    if (!kids.length) return;
    const outward = Math.atan2(anchor[1] - from[1], anchor[0] - from[0]);
    const fan = Math.min(Math.PI * 1.3, .55 * kids.length + .5);
    kids.forEach((child, index) => {
      const random = seeded(child.key);
      const t = kids.length === 1 ? .5 : index / (kids.length - 1);
      const angle = outward + (t - .5) * fan + (random() - .5) * .35;
      const r = 11 + random() * 13 + (index % 2) * 5 + Math.min(18, countOf(child.key) * 1.5);
      positions.set(child.key, [anchor[0] + Math.cos(angle) * r, anchor[1] + Math.sin(angle) * r]);
      placeDetail(child, anchor);
    });
  };

  for (const branch of branches) {
    const hub = positions.get(branch.key)!;
    const hubRadius = branchRadius.get(branch.key)!;
    const items = children.get(branch.key) ?? [];
    const outward = Math.atan2(hub[1], hub[0]);
    const itemWishes = items.map((item, index) => {
      const angle = nativeAngle(item, branch);
      const even = outward + (index / Math.max(1, items.length)) * Math.PI * 2;
      return { item, angle: angle ?? even, strength: angle === null ? 0 : .35 };
    }).sort((a, b) => a.angle - b.angle);
    const itemPositions = itemWishes.map((wish, index) => {
      const random = seeded(wish.item.key);
      const even = (itemWishes[0]?.angle ?? 0) + (index / Math.max(1, itemWishes.length)) * Math.PI * 2;
      const angle = wish.angle + angleDiff(even, wish.angle) * (1 - wish.strength);
      const r = hubRadius * (.46 + random() * .34);
      return { key: wish.item.key, item: wish.item, x: hub[0] + Math.cos(angle) * r, y: hub[1] + Math.sin(angle) * r };
    });
    for (let iteration = 0; iteration < 60; iteration++) {
      for (let i = 0; i < itemPositions.length; i++) for (let j = i + 1; j < itemPositions.length; j++) {
        const a = itemPositions[i], b = itemPositions[j];
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(.5, Math.hypot(dx, dy));
        if (distance >= 30) continue;
        const push = (30 - distance) * .5;
        a.x -= (dx / distance) * push; a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push; b.y += (dy / distance) * push;
      }
      for (const entry of itemPositions) {
        const dx = entry.x - hub[0], dy = entry.y - hub[1], distance = Math.max(.5, Math.hypot(dx, dy));
        if (distance < hubRadius * .3) { entry.x = hub[0] + (dx / distance) * hubRadius * .3; entry.y = hub[1] + (dy / distance) * hubRadius * .3; }
      }
    }
    for (const entry of itemPositions) {
      positions.set(entry.key, [entry.x, entry.y]);
      placeDetail(entry.item, hub);
    }
  }
  // Anything the walk missed (an orphan) settles near the root.
  nodes.forEach((n, index) => {
    if (positions.has(n.key)) return;
    const angle = index * GOLDEN;
    positions.set(n.key, [Math.cos(angle) * radius * .2, Math.sin(angle) * radius * .2]);
  });
  let extent = 0;
  for (const p of positions.values()) extent = Math.max(extent, Math.hypot(p[0], p[1]));
  return { positions, radius: Math.max(radius * .82, extent + 20) };
}

export function buildKnowledgeMap(
  graph: KnowledgeGraph,
  native: Map<string, Map<string, Vec3>>,
  originSpaceId: string,
  previousAnchors?: Map<string, Vec2>,
  aspect = 1.6,
): KnowledgeMap {
  const bySpace = new Map<string, KnowledgeNode[]>();
  for (const n of graph.nodes) {
    const list = bySpace.get(n.spaceId) ?? [];
    list.push(n);
    bySpace.set(n.spaceId, list);
  }
  const layouts = new Map<string, SpaceLayout>();
  for (const [spaceId, nodes] of bySpace) layouts.set(spaceId, layoutSpace(nodes, native.get(spaceId)));
  const ids = [...layouts.keys()];
  const origin = layouts.has(originSpaceId) ? originSpaceId : ids[0];
  const gap = 200;

  // Spaces that share relations want to be neighbours.
  const affinity = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const spaceOf = new Map(graph.nodes.map(n => [n.key, n.spaceId]));
  for (const r of graph.relations) {
    if (r.type === 'part-of') continue;
    const a = spaceOf.get(r.from), b = spaceOf.get(r.to);
    if (!a || !b || a === b) continue;
    affinity.set(pairKey(a, b), (affinity.get(pairKey(a, b)) ?? 0) + (r.source === 'candidate' ? .35 : Math.max(.35, r.confidence)));
  }
  const maxAffinity = Math.max(1, ...affinity.values());

  const anchors = new Map<string, Vec2>();
  const fixed = new Set<string>();
  if (origin) { anchors.set(origin, [0, 0]); fixed.add(origin); }
  for (const id of ids) {
    const kept = previousAnchors?.get(id);
    if (kept && id !== origin) { anchors.set(id, [...kept]); fixed.add(id); }
  }
  const radiusOf = (id: string) => layouts.get(id)!.radius + gap / 2;
  const free = ids.filter(id => !anchors.has(id)).sort((a, b) => (bySpace.get(b)!.length - bySpace.get(a)!.length) || a.localeCompare(b));
  free.forEach((id, index) => {
    const spread = (radiusOf(origin) + radiusOf(id)) * Math.sqrt(index + 1) * .92;
    const angle = (index + 1) * GOLDEN + seeded(id)() * .3 - .4;
    anchors.set(id, [Math.cos(angle) * spread * Math.sqrt(aspect), Math.sin(angle) * spread / Math.sqrt(aspect)]);
  });
  const all = [...anchors.keys()];
  for (let iteration = 0; iteration < 280; iteration++) {
    const cooling = 1 - iteration / 280;
    const force = new Map(all.map(id => [id, [0, 0] as Vec2]));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const pa = anchors.get(a)!, pb = anchors.get(b)!;
      let dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      let distance = Math.hypot(dx, dy);
      if (distance < 1) { dx = 1; dy = 0; distance = 1; }
      const minimum = radiusOf(a) + radiusOf(b);
      const pull = (affinity.get(pairKey(a, b)) ?? 0) / maxAffinity;
      const desired = minimum * (1.12 - .1 * pull);
      const push = distance < minimum ? (minimum - distance) * .5 : (desired - distance) * (pull > 0 ? .03 : .004);
      const ux = dx / distance, uy = dy / distance;
      force.get(a)![0] -= ux * push; force.get(a)![1] -= uy * push;
      force.get(b)![0] += ux * push; force.get(b)![1] += uy * push;
    }
    for (const id of all) {
      if (fixed.has(id)) continue;
      const p = anchors.get(id)!, f = force.get(id)!;
      // A gentle, anisotropic pull keeps the galaxy one continent shaped like the screen.
      p[0] += (f[0] - p[0] * .012 / aspect) * cooling;
      p[1] += (f[1] - p[1] * .012 * aspect) * cooling;
    }
  }
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (const a of all) {
      if (fixed.has(a)) continue;
      for (const b of all) {
        if (a === b) continue;
        const pa = anchors.get(a)!, pb = anchors.get(b)!;
        const dx = pa[0] - pb[0], dy = pa[1] - pb[1], distance = Math.max(1, Math.hypot(dx, dy));
        const minimum = radiusOf(a) + radiusOf(b);
        if (distance >= minimum - .5) continue;
        pa[0] += (dx / distance) * (minimum - distance);
        pa[1] += (dy / distance) * (minimum - distance);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const positions = new Map<string, Vec3>();
  const nativePositions = new Map<string, Vec3>();
  const clusters = new Map<string, KnowledgeCluster>();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [spaceId, nodes] of bySpace) {
    const layout = layouts.get(spaceId)!, anchor = anchors.get(spaceId)!, universe = native.get(spaceId);
    const rootNative = universe?.get(nodes.find(n => n.depth === 0)?.node.id ?? '') ?? [0, 0, 0];
    for (const n of nodes) {
      const p = layout.positions.get(n.key)!;
      positions.set(n.key, [p[0] + anchor[0], p[1] + anchor[1], -Math.min(4, n.depth) * RELIEF]);
      const u = universe?.get(n.node.id);
      // A note the universe does not draw (folded away) starts from its space's root.
      nativePositions.set(n.key, u ? [u[0] + anchor[0], u[1] + anchor[1], u[2]] : [rootNative[0] + anchor[0], rootNative[1] + anchor[1], rootNative[2]]);
    }
    clusters.set(spaceId, { spaceId, center: [anchor[0], anchor[1]], radius: layout.radius });
    minX = Math.min(minX, anchor[0] - layout.radius); maxX = Math.max(maxX, anchor[0] + layout.radius);
    minY = Math.min(minY, anchor[1] - layout.radius); maxY = Math.max(maxY, anchor[1] + layout.radius);
  }
  if (!Number.isFinite(minX)) { minX = -600; maxX = 600; minY = -400; maxY = 400; }

  const parentDistances: number[] = [];
  for (const n of graph.nodes) {
    if (!n.parentKey || n.depth < 2) continue;
    const a = positions.get(n.key), b = positions.get(n.parentKey);
    if (a && b) parentDistances.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  parentDistances.sort((a, b) => a - b);
  const median = parentDistances.length ? parentDistances[Math.floor(parentDistances.length / 2)] : 40;
  return { positions, native: nativePositions, clusters, anchors, bounds: { minX, maxX, minY, maxY }, unit: Math.max(16, Math.min(400, median)) };
}

/**
 * Camera distance and target that frame `bounds` inside the part of the screen
 * the panels leave free. `free` is in CSS pixels of the canvas.
 */
export function frameBounds(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  view: { width: number; height: number; fov: number },
  free: { left: number; top: number; right: number; bottom: number },
  margin = 1.1,
) {
  const tan = Math.tan((view.fov * Math.PI) / 360);
  const freeWidth = Math.max(120, view.width - free.left - free.right);
  const freeHeight = Math.max(120, view.height - free.top - free.bottom);
  const spanX = Math.max(80, bounds.maxX - bounds.minX) * margin;
  const spanY = Math.max(80, bounds.maxY - bounds.minY) * margin;
  // worldPerPixel = 2 * distance * tan / height
  const distance = Math.max((spanX * view.height) / (2 * tan * freeWidth), (spanY * view.height) / (2 * tan * freeHeight));
  const worldPerPixel = (2 * distance * tan) / view.height;
  const freeCenterX = free.left + freeWidth / 2 - view.width / 2;
  const freeCenterY = free.top + freeHeight / 2 - view.height / 2;
  const target: Vec2 = [(bounds.minX + bounds.maxX) / 2 - freeCenterX * worldPerPixel, (bounds.minY + bounds.maxY) / 2 + freeCenterY * worldPerPixel];
  return { target, distance };
}
