/**
 * The galaxy drawn from the knowledge graph, in a handful of draw calls:
 *
 * - territories: each space's soft patch of colour, strongest from afar;
 * - rivers: relations between two spaces summed into one flowing ribbon,
 *   visible only when you are far enough out that single links would be noise;
 * - edges: every relation as a curved filament carrying pulses of light —
 *   parent links climb quietly toward the root, typed relations flow from
 *   source to target, word candidates are dashed;
 * - points: every note as a star, fading with distance by its depth;
 * - hubs: each space and its top-level branches, with the progress and risk
 *   arcs, the satellites of notes waiting for a person, and a ripple when the
 *   branch is in trouble.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, LineSegments, Mesh, PlaneGeometry, Points, ShaderMaterial,
} from 'three';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeRelation } from '../../galaxy/knowledgeGraph';
import type { KnowledgeMap, Vec3 } from '../../galaxy/knowledgeMap';
import type { HubSignals } from '../../galaxy/knowledgePresentation';
import { knowledgeFrame } from './knowledgeCamera';
import { knowledgePresence } from './knowledgePresence';
import {
  EDGE_FRAGMENT, EDGE_VERTEX, HUB_FRAGMENT, HUB_VERTEX, POINT_FRAGMENT, POINT_VERTEX, RIVER_FRAGMENT, RIVER_VERTEX,
  TERRITORY_FRAGMENT, TERRITORY_VERTEX,
} from './knowledgeShaders';

export const RELATION_COLORS: Record<string, string> = {
  'part-of': '#8aa0c0', 'depends-on': '#7fb2ff', causes: '#ffb45c', enables: '#5ee6a8', prevents: '#ff6b6b',
  supports: '#a8e38a', contradicts: '#ff5c8a', before: '#c3c9d6', after: '#c3c9d6', 'derived-from': '#c9a7ff',
  'created-by': '#f7d774', 'is-a': '#9fb4d4', related: '#8fa6c8', none: '#5d6b80',
};

function seeded(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

function statusCode(status: string) {
  if (status === 'running') return 1;
  if (status === 'blocked' || status === 'error') return 2;
  if (status === 'needs_review') return 3;
  if (status === 'done') return 4;
  return 0;
}

export interface FieldEdge {
  relation: KnowledgeRelation;
  a: number;
  b: number;
  start: number;
  segments: number;
  curve: number;
  tier: number;
  cross: boolean;
}

export interface FieldData {
  nodes: KnowledgeNode[];
  index: Map<string, number>;
  /** Where each note is drawn now: between `native` and `galaxy` by the morph. */
  positions: Float32Array;
  native: Float32Array;
  galaxy: Float32Array;
  /** Per-note head start in the glide, so the map re-forms root first. */
  delays: Float32Array;
  morph: number;
  version: number;
  colors: Float32Array;
  sizes: Float32Array;
  minPx: Float32Array;
  tiers: Float32Array;
  seeds: Float32Array;
  statuses: Float32Array;
  hubs: number[];
  edges: FieldEdge[];
  edgeByRelation: Map<string, number>;
  edgesOfNode: Map<number, number[]>;
  vertexCount: number;
  edgePositions: Float32Array;
  edgeColors: Float32Array;
  edgeMeta: Float32Array;
  edgeMeta2: Float32Array;
  rivers: { a: string; b: string; weight: number }[];
}

export function buildFieldData(graph: KnowledgeGraph, map: KnowledgeMap): FieldData {
  // Detail first and hubs last so brighter things draw on top.
  const nodes = graph.nodes.filter(n => map.positions.has(n.key)).sort((a, b) => Math.min(b.depth, 3) - Math.min(a.depth, 3));
  const count = nodes.length;
  const index = new Map<string, number>();
  nodes.forEach((n, i) => index.set(n.key, i));
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const native = new Float32Array(count * 3), galaxy = new Float32Array(count * 3), delays = new Float32Array(count);
  const sizes = new Float32Array(count), minPx = new Float32Array(count), tiers = new Float32Array(count);
  const seeds = new Float32Array(count), statuses = new Float32Array(count);
  const hubs: number[] = [];
  const color = new Color();
  const descendants = new Map<string, number>();
  for (const n of [...graph.nodes].sort((a, b) => b.depth - a.depth)) {
    if (n.parentKey) descendants.set(n.parentKey, (descendants.get(n.parentKey) ?? 0) + 1 + (descendants.get(n.key) ?? 0));
  }
  nodes.forEach((n, i) => {
    galaxy.set(map.positions.get(n.key)!, i * 3);
    native.set(map.native.get(n.key) ?? map.positions.get(n.key)!, i * 3);
    color.set(n.node.color || '#86cfff');
    if (n.depth >= 3) color.lerp(new Color('#cbd8ee'), .25);
    colors.set([color.r, color.g, color.b], i * 3);
    const tier = Math.min(3, n.depth);
    tiers[i] = tier;
    // Hubs: the halo that carries the rings. Notes: the star's glow.
    sizes[i] = n.depth === 0 ? Math.max(150, (map.clusters.get(n.spaceId)?.radius ?? 320) * .5)
      : n.depth === 1 ? 52 + 9 * Math.sqrt(descendants.get(n.key) ?? 0) : tier === 2 ? 12 : 6;
    minPx[i] = n.depth === 0 ? 64 : n.depth === 1 ? 30 : tier === 2 ? 3.6 : 2.4;
    seeds[i] = seeded(n.key);
    delays[i] = Math.min(4, n.depth) * .07 + seeds[i] * .06;
    statuses[i] = statusCode(n.node.status);
    if (n.depth <= 1) hubs.push(i);
  });

  const edges: FieldEdge[] = [];
  const edgeByRelation = new Map<string, number>();
  const edgesOfNode = new Map<number, number[]>();
  let vertexCount = 0;
  for (const relation of graph.relations) {
    if (relation.type === 'none') continue;
    const a = index.get(relation.from), b = index.get(relation.to);
    if (a === undefined || b === undefined || a === b) continue;
    const tree = relation.type === 'part-of' && relation.source === 'tree';
    const tier = Math.max(tiers[a], tiers[b]);
    const cross = nodes[a].spaceId !== nodes[b].spaceId;
    // Space-to-space dependencies are drawn as rivers, not as a single thread.
    if (cross && nodes[a].depth === 0 && nodes[b].depth === 0 && relation.source === 'dependency') continue;
    const segments = tree ? (tier >= 3 ? 4 : tier === 2 ? 7 : 10) : 18;
    const curve = (seeded(relation.id) - .5) * (tree ? .16 : .44);
    const edgeIndex = edges.length;
    edges.push({ relation, a, b, start: vertexCount, segments, curve, tier, cross });
    edgeByRelation.set(relation.id, edgeIndex);
    for (const end of [a, b]) {
      const list = edgesOfNode.get(end);
      if (list) list.push(edgeIndex); else edgesOfNode.set(end, [edgeIndex]);
    }
    vertexCount += segments * 2;
  }
  const edgePositions = new Float32Array(vertexCount * 3);
  const edgeColors = new Float32Array(vertexCount * 3);
  const edgeMeta = new Float32Array(vertexCount * 4);
  const edgeMeta2 = new Float32Array(vertexCount * 2);
  const from = new Color(), to = new Color(), mixed = new Color(), spec = new Color();
  for (const edge of edges) {
    const { relation } = edge;
    const tree = relation.type === 'part-of' && relation.source === 'tree';
    const candidate = relation.source === 'candidate';
    spec.set(RELATION_COLORS[relation.type] ?? RELATION_COLORS.related);
    if (tree) {
      from.setRGB(colors[edge.a * 3], colors[edge.a * 3 + 1], colors[edge.a * 3 + 2]);
      to.setRGB(colors[edge.b * 3], colors[edge.b * 3 + 1], colors[edge.b * 3 + 2]);
    } else if (candidate) {
      from.setRGB(colors[edge.a * 3], colors[edge.a * 3 + 1], colors[edge.a * 3 + 2]).lerp(spec, .45);
      to.setRGB(colors[edge.b * 3], colors[edge.b * 3 + 1], colors[edge.b * 3 + 2]).lerp(spec, .45);
    } else {
      from.copy(spec);
      to.copy(spec);
    }
    const alpha = tree ? (edge.tier <= 1 ? .4 : edge.tier === 2 ? .3 : .22) : candidate ? .2 : .16 + .42 * Math.max(.3, relation.confidence);
    const kind = tree ? 0 : candidate ? 2 : 1;
    const length = Math.hypot(galaxy[edge.a * 3] - galaxy[edge.b * 3], galaxy[edge.a * 3 + 1] - galaxy[edge.b * 3 + 1]);
    const seed = seeded(relation.id);
    for (let segment = 0; segment < edge.segments; segment++) {
      for (let end = 0; end < 2; end++) {
        const vertex = edge.start + segment * 2 + end;
        const t = (segment + end) / edge.segments;
        mixed.copy(from).lerp(to, t);
        edgeColors.set([mixed.r, mixed.g, mixed.b], vertex * 3);
        edgeMeta.set([alpha, t, edge.tier + (edge.cross ? 10 : 0), kind], vertex * 4);
        edgeMeta2.set([length, seed], vertex * 2);
      }
    }
  }

  // Rivers: everything that joins two spaces, summed.
  const riverMap = new Map<string, { a: string; b: string; weight: number }>();
  for (const relation of graph.relations) {
    if (relation.type === 'part-of' || relation.type === 'none') continue;
    const a = index.get(relation.from), b = index.get(relation.to);
    if (a === undefined || b === undefined) continue;
    const sa = nodes[a].spaceId, sb = nodes[b].spaceId;
    if (sa === sb) continue;
    const key = sa < sb ? `${sa}\u0000${sb}` : `${sb}\u0000${sa}`;
    const river = riverMap.get(key) ?? { a: sa < sb ? sa : sb, b: sa < sb ? sb : sa, weight: 0 };
    river.weight += relation.source === 'candidate' ? .3 : Math.max(.4, relation.confidence);
    riverMap.set(key, river);
  }
  const data: FieldData = {
    nodes, index, positions, native, galaxy, delays, morph: -1, version: 0, colors, sizes, minPx, tiers, seeds, statuses, hubs, edges, edgeByRelation, edgesOfNode,
    vertexCount, edgePositions, edgeColors, edgeMeta, edgeMeta2, rivers: [...riverMap.values()].filter(r => map.clusters.has(r.a) && map.clusters.has(r.b)),
  };
  applyMorph(data, knowledgeFrame.flatten);
  return data;
}

/**
 * Place every note between its universe position (0) and its galaxy position
 * (1), and bend every link to follow. Roots move first and fine detail last,
 * so the map visibly re-forms rather than sliding as one block.
 */
export function applyMorph(data: FieldData, morph: number) {
  if (data.morph === morph) return;
  data.morph = morph;
  data.version++;
  const { positions, native, galaxy, delays } = data;
  for (let i = 0; i < data.nodes.length; i++) {
    const local = Math.min(1, Math.max(0, (morph - delays[i]) / .66));
    const e = morph >= 1 ? 1 : morph <= 0 ? 0 : local * local * (3 - 2 * local);
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = native[i * 3 + k] + (galaxy[i * 3 + k] - native[i * 3 + k]) * e;
  }
  const out = data.edgePositions;
  for (const edge of data.edges) {
    const ax = positions[edge.a * 3], ay = positions[edge.a * 3 + 1], az = positions[edge.a * 3 + 2];
    const bx = positions[edge.b * 3], by = positions[edge.b * 3 + 1], bz = positions[edge.b * 3 + 2];
    const cx = (ax + bx) / 2 - (by - ay) * edge.curve, cy = (ay + by) / 2 + (bx - ax) * edge.curve, cz = (az + bz) / 2;
    for (let segment = 0; segment < edge.segments; segment++) {
      for (let end = 0; end < 2; end++) {
        const vertex = edge.start + segment * 2 + end;
        const t = (segment + end) / edge.segments, u = 1 - t;
        out[vertex * 3] = u * u * ax + 2 * u * t * cx + t * t * bx;
        out[vertex * 3 + 1] = u * u * ay + 2 * u * t * cy + t * t * by;
        out[vertex * 3 + 2] = u * u * az + 2 * u * t * cz + t * t * bz;
      }
    }
  }
}

export interface FieldFocus {
  /** Node indices that stay lit while the rest of the map steps back. */
  nodes: Set<number>;
  edges: Set<number>;
  /** 0 nothing focused, ~0.55 a selection, 1 a question's path. */
  strength: number;
}

interface FieldProps {
  data: FieldData;
  map: KnowledgeMap;
  graph: KnowledgeGraph;
  signals: Map<string, HubSignals>;
  spaceColors: Map<string, string>;
  focus: FieldFocus;
  selectedIndex: number | null;
  rings: boolean;
  lowQuality: boolean;
  reducedMotion: boolean;
}

function useShared(reducedMotion: boolean) {
  // One set of uniforms for every layer, updated in place each frame.
  return useMemo(() => ({
    uTime: { value: 0 }, uBlend: { value: 0 }, uScale: { value: 1 }, uDpr: { value: 1 },
    uUnit: { value: 100 }, uFocus: { value: 0 }, uRings: { value: 1 }, uReduced: { value: Number(reducedMotion) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
}

export function KnowledgeField(props: FieldProps) {
  const { data, map, focus, rings, reducedMotion } = props;
  const { size, gl } = useThree();
  const shared = useShared(reducedMotion);
  const focusLevel = useRef(0);
  useFrame(() => applyMorph(data, knowledgeFrame.flatten), -1);
  useFrame(({ clock }, delta) => {
    focusLevel.current += (focus.strength - focusLevel.current) * (1 - Math.exp(-Math.min(.05, delta) * 6));
    const tan = Math.tan((knowledgeFrame.fov * Math.PI) / 360);
    shared.uTime.value = clock.elapsedTime;
    shared.uBlend.value = knowledgePresence.blend;
    shared.uScale.value = size.height / (2 * tan);
    shared.uDpr.value = gl.getPixelRatio();
    shared.uUnit.value = map.unit;
    shared.uFocus.value = focusLevel.current;
    // Rings belong to the map: they appear once the stars have re-formed.
    shared.uRings.value = rings ? smooth(.5, .95, knowledgeFrame.flatten) : 0;
    shared.uReduced.value = Number(reducedMotion);
  });
  return <group>
    <Territories {...props} shared={shared} />
    {!props.lowQuality && <Rivers {...props} />}
    <EdgeField {...props} shared={shared} />
    <PointField {...props} shared={shared} />
    <HubField {...props} shared={shared} />
    <SelectionRipple data={data} selectedIndex={props.selectedIndex} />
  </group>;
}

type Shared = ReturnType<typeof useShared>;

function material(vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: unknown }>) {
  return new ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
}

function Territories({ map, spaceColors, shared }: FieldProps & { shared: Shared }) {
  const mesh = useMemo(() => {
    const clusters = [...map.clusters.values()];
    const geometry = new InstancedBufferGeometry();
    const plane = new PlaneGeometry(1, 1);
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    const positions = new Float32Array(clusters.length * 3), colors = new Float32Array(clusters.length * 3), radii = new Float32Array(clusters.length);
    const color = new Color();
    clusters.forEach((cluster, i) => {
      positions.set([cluster.center[0], cluster.center[1], 0], i * 3);
      color.set(spaceColors.get(cluster.spaceId) ?? '#7fa6d8').multiplyScalar(.2);
      colors.set([color.r, color.g, color.b], i * 3);
      radii[i] = cluster.radius * 1.22;
    });
    geometry.setAttribute('iPos', new InstancedBufferAttribute(positions, 3));
    geometry.setAttribute('iColor', new InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('iRadius', new InstancedBufferAttribute(radii, 1));
    geometry.instanceCount = clusters.length;
    const result = new Mesh(geometry, material(TERRITORY_VERTEX, TERRITORY_FRAGMENT, { uScale: shared.uScale, uBlend: shared.uBlend }));
    result.frustumCulled = false;
    result.renderOrder = -10;
    return result;
  }, [map, spaceColors, shared]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}

function Rivers({ data, map, spaceColors, reducedMotion }: FieldProps) {
  const uniforms = useMemo(() => ({ uOpacity: { value: 0 }, uTime: { value: 0 }, uReduced: { value: Number(reducedMotion) } }), [reducedMotion]);
  const mesh = useMemo(() => {
    const max = Math.max(1, ...data.rivers.map(r => r.weight));
    const steps = 40;
    const positions: number[] = [], colors: number[] = [], rivers: number[] = [], indices: number[] = [];
    const meanRadius = [...map.clusters.values()].reduce((s, c) => s + c.radius, 0) / Math.max(1, map.clusters.size);
    for (const river of data.rivers) {
      const a = map.clusters.get(river.a)!.center, b = map.clusters.get(river.b)!.center;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const bend = (seeded(`${river.a}|${river.b}`) - .5) * .35;
      const cx = (a[0] + b[0]) / 2 - dy * bend, cy = (a[1] + b[1]) / 2 + dx * bend;
      const colorA = new Color(spaceColors.get(river.a) ?? '#8fa6c8'), colorB = new Color(spaceColors.get(river.b) ?? '#8fa6c8');
      const halfWidth = meanRadius * (.035 + .11 * Math.sqrt(river.weight / max));
      const base = positions.length / 3;
      for (let step = 0; step <= steps; step++) {
        const t = step / steps, u = 1 - t;
        const x = u * u * a[0] + 2 * u * t * cx + t * t * b[0];
        const y = u * u * a[1] + 2 * u * t * cy + t * t * b[1];
        const tx = 2 * u * (cx - a[0]) + 2 * t * (b[0] - cx), ty = 2 * u * (cy - a[1]) + 2 * t * (b[1] - cy);
        const length = Math.max(1e-3, Math.hypot(tx, ty));
        const nx = -ty / length, ny = tx / length;
        const width = halfWidth * (.45 + .55 * Math.sin(Math.PI * t));
        const color = colorA.clone().lerp(colorB, t);
        for (const side of [-1, 1]) {
          positions.push(x + nx * width * side, y + ny * width * side, -1.5);
          colors.push(color.r, color.g, color.b);
          rivers.push(side, t);
        }
        if (step < steps) { const i = base + step * 2; indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute('aRiver', new BufferAttribute(new Float32Array(rivers), 2));
    geometry.setIndex(indices);
    const result = new Mesh(geometry, new ShaderMaterial({ vertexShader: RIVER_VERTEX, fragmentShader: RIVER_FRAGMENT, uniforms, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide, blending: AdditiveBlending }));
    result.frustumCulled = false;
    result.renderOrder = -5;
    return result;
  }, [data, map, spaceColors, uniforms]);
  useFrame(({ clock }) => {
    // Rivers belong to the far view: they rise as spaces shrink on screen.
    const meanRadius = [...map.clusters.values()].reduce((s, c) => s + c.radius, 0) / Math.max(1, map.clusters.size);
    const apparent = meanRadius * knowledgeFrame.pixelsPerUnit;
    uniforms.uOpacity.value = (1 - smooth(110, 270, apparent)) * .6 * knowledgePresence.blend;
    uniforms.uTime.value = clock.elapsedTime;
  });
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}

function smooth(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function EdgeField({ data, graph, focus, shared }: FieldProps & { shared: Shared }) {
  const object = useMemo(() => {
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(data.edgePositions, 3);
    position.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', new BufferAttribute(data.edgeColors, 3));
    geometry.setAttribute('aMeta', new BufferAttribute(data.edgeMeta, 4));
    geometry.setAttribute('aMeta2', new BufferAttribute(data.edgeMeta2, 2));
    const state = new BufferAttribute(new Float32Array(data.vertexCount * 3), 3);
    state.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aState', state);
    const lines = new LineSegments(geometry, material(EDGE_VERTEX, EDGE_FRAGMENT, {
      uTime: shared.uTime, uBlend: shared.uBlend, uScale: shared.uScale, uUnit: shared.uUnit, uFocus: shared.uFocus, uReduced: shared.uReduced,
    }));
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    return lines;
  }, [data, shared]);
  useEffect(() => {
    const state = object.geometry.getAttribute('aState') as BufferAttribute;
    const running = new Set(graph.nodes.filter(n => n.node.status === 'running').map(n => n.key));
    data.edges.forEach((edge, i) => {
      const hi = focus.edges.has(i) ? 1 : 0;
      // Work in progress sends sparks up the branch it belongs to.
      const agent = edge.relation.type === 'part-of' && (running.has(edge.relation.from) || running.has(edge.relation.to)) ? .8 + seeded(edge.relation.id) * .6 : 0;
      for (let vertex = edge.start; vertex < edge.start + edge.segments * 2; vertex++) state.setXYZ(vertex, hi, 1, agent);
    });
    state.needsUpdate = true;
  }, [data, graph, focus, object]);
  const version = useRef(-1);
  useFrame(() => {
    if (version.current === data.version) return;
    version.current = data.version;
    (object.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  });
  useEffect(() => () => { object.geometry.dispose(); (object.material as ShaderMaterial).dispose(); }, [object]);
  return <primitive object={object} />;
}

function PointField({ data, focus, shared }: FieldProps & { shared: Shared }) {
  const object = useMemo(() => {
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(data.positions, 3);
    position.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', new BufferAttribute(data.colors, 3));
    geometry.setAttribute('aSize', new BufferAttribute(data.sizes, 1));
    geometry.setAttribute('aMin', new BufferAttribute(data.minPx, 1));
    geometry.setAttribute('aTier', new BufferAttribute(data.tiers, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(data.seeds, 1));
    geometry.setAttribute('aStatus', new BufferAttribute(data.statuses, 1));
    for (const name of ['aHi', 'aDim']) {
      const attribute = new BufferAttribute(new Float32Array(data.nodes.length).fill(name === 'aDim' ? 1 : 0), 1);
      attribute.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    }
    // Hubs are drawn by the hub field; their points would only double the glow.
    const dim = geometry.getAttribute('aDim') as BufferAttribute;
    for (const hub of data.hubs) dim.setX(hub, 0);
    const points = new Points(geometry, material(POINT_VERTEX, POINT_FRAGMENT, {
      uTime: shared.uTime, uBlend: shared.uBlend, uScale: shared.uScale, uDpr: shared.uDpr, uUnit: shared.uUnit,
      uFocus: shared.uFocus, uRings: shared.uRings, uReduced: shared.uReduced,
    }));
    points.frustumCulled = false;
    points.renderOrder = 2;
    return points;
  }, [data, shared]);
  useEffect(() => {
    const hi = object.geometry.getAttribute('aHi') as BufferAttribute;
    for (let i = 0; i < data.nodes.length; i++) hi.setX(i, focus.nodes.has(i) ? 1 : 0);
    hi.needsUpdate = true;
  }, [data, focus, object]);
  const version = useRef(-1);
  useFrame(() => {
    if (version.current === data.version) return;
    version.current = data.version;
    (object.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  });
  useEffect(() => () => { object.geometry.dispose(); (object.material as ShaderMaterial).dispose(); }, [object]);
  return <primitive object={object} />;
}

function HubField({ data, map, signals, focus, selectedIndex, spaceColors, shared }: FieldProps & { shared: Shared }) {
  const object = useMemo(() => {
    const hubs = data.hubs;
    const geometry = new InstancedBufferGeometry();
    const plane = new PlaneGeometry(1, 1);
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    const make = (itemSize: number) => {
      const attribute = new InstancedBufferAttribute(new Float32Array(hubs.length * itemSize), itemSize);
      attribute.setUsage(DynamicDrawUsage);
      return attribute;
    };
    const pos = make(3), colorSeed = make(4), shape = make(3);
    const color = new Color();
    hubs.forEach((index, slot) => {
      const node = data.nodes[index];
      pos.setXYZ(slot, data.positions[index * 3], data.positions[index * 3 + 1], data.positions[index * 3 + 2]);
      if (node.depth === 0) color.set(spaceColors.get(node.spaceId) ?? node.node.color ?? '#9ec5ff');
      else color.setRGB(data.colors[index * 3], data.colors[index * 3 + 1], data.colors[index * 3 + 2]);
      colorSeed.setXYZW(slot, color.r, color.g, color.b, data.seeds[index]);
      shape.setXYZ(slot, data.sizes[index], data.minPx[index], node.depth === 0 ? 0 : 1);
    });
    geometry.setAttribute('iPos', pos);
    geometry.setAttribute('iColorSeed', colorSeed);
    geometry.setAttribute('iShape', shape);
    geometry.setAttribute('iMetrics', make(4));
    geometry.setAttribute('iState', make(4));
    geometry.instanceCount = hubs.length;
    const mesh = new Mesh(geometry, material(HUB_VERTEX, HUB_FRAGMENT, {
      uTime: shared.uTime, uBlend: shared.uBlend, uScale: shared.uScale, uFocus: shared.uFocus, uRings: shared.uRings, uReduced: shared.uReduced,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
  }, [data, map, signals, spaceColors, shared]);
  useEffect(() => {
    const metrics = object.geometry.getAttribute('iMetrics') as InstancedBufferAttribute;
    const state = object.geometry.getAttribute('iState') as InstancedBufferAttribute;
    data.hubs.forEach((index, slot) => {
      const signal = signals.get(data.nodes[index].key);
      metrics.setXYZW(slot, signal?.progress ?? -1, signal?.risk ?? 0, Math.min(5, signal?.awaiting ?? 0), signal?.running ?? 0);
      state.setXYZW(slot, focus.nodes.has(index) ? 1 : 0, 1, signal?.atRisk ? 1 : 0, index === selectedIndex ? 1 : 0);
    });
    metrics.needsUpdate = true;
    state.needsUpdate = true;
  }, [data, signals, focus, selectedIndex, object]);
  const version = useRef(-1);
  useFrame(() => {
    if (version.current === data.version) return;
    version.current = data.version;
    const pos = object.geometry.getAttribute('iPos') as InstancedBufferAttribute;
    data.hubs.forEach((index, slot) => pos.setXYZ(slot, data.positions[index * 3], data.positions[index * 3 + 1], data.positions[index * 3 + 2]));
    pos.needsUpdate = true;
  });
  useEffect(() => () => { object.geometry.dispose(); (object.material as ShaderMaterial).dispose(); }, [object]);
  return <primitive object={object} />;
}

/** A ring that widens once from a newly selected light, so the eye finds it. */
function SelectionRipple({ data, selectedIndex }: { data: FieldData; selectedIndex: number | null }) {
  const group = useRef<Group>(null);
  const startedAt = useRef(0);
  useEffect(() => { startedAt.current = performance.now(); }, [selectedIndex]);
  useFrame(() => {
    const mesh = group.current?.children[0] as Mesh | undefined;
    if (!mesh) return;
    if (selectedIndex === null) { mesh.visible = false; return; }
    const t = Math.min(1, (performance.now() - startedAt.current) / 1500);
    const p: Vec3 = [data.positions[selectedIndex * 3], data.positions[selectedIndex * 3 + 1], data.positions[selectedIndex * 3 + 2]];
    mesh.visible = t < 1;
    mesh.position.set(p[0], p[1], p[2] + 1);
    // Constant on-screen growth: 10 px to 70 px.
    const worldPerPixel = 1 / Math.max(1e-6, knowledgeFrame.pixelsPerUnit);
    mesh.scale.setScalar((10 + t * 60) * worldPerPixel);
    (mesh.material as { opacity: number }).opacity = (1 - t) * .75 * knowledgePresence.blend;
  });
  return <group ref={group}>
    <mesh renderOrder={6}>
      <ringGeometry args={[.9, 1, 64]} />
      <meshBasicMaterial color="#e9f6ff" transparent opacity={0} depthWrite={false} depthTest={false} blending={AdditiveBlending} />
    </mesh>
  </group>;
}
