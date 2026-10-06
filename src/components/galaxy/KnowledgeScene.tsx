/**
 * The knowledge galaxy inside the Universe canvas. It borrows the universe
 * camera: on entry the camera pulls back from exactly where it was while every
 * planet dissolves into the star at its own position, and on exit it returns
 * to the saved pose. In between it is a map camera that always faces the
 * galaxy plane head-on — drag glides with inertia, the wheel and pinch zoom
 * toward the pointer, and names, links and rings change with the zoom level.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { deriveAtlasLayoutFrame, type AtlasLayoutMode } from '../../layout/atlasLayout';
import { useAtlasStore } from '../../store/atlasStore';
import { useGalaxyStore } from '../../galaxy/galaxyStore';
import { isCloudSpaceId, placeholderRoot, useCloudGalaxy } from '../../galaxy/cloudGalaxy';
import { KNOWLEDGE_CAMERA_HANDOFF, focusKnowledge, useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';
import { projectKnowledge } from '../../galaxy/knowledgeGraph';
import { buildKnowledgeMap, frameBounds, type Vec2, type Vec3 } from '../../galaxy/knowledgeMap';
import { knowledgeHubSignals } from '../../galaxy/knowledgePresentation';
import { knowledgeMessages, relationLabel } from '../../i18n/knowledgeMessages';
import { currentAppLocale } from '../../i18n/locales';
import { buildFieldData, KnowledgeField, RELATION_COLORS, type FieldFocus } from './KnowledgeField';
import {
  emitKnowledgeFrame, knowledgeDistanceForLevel, knowledgeFrame, knowledgeInsets, knowledgeLevelOf, takeKnowledgeCameraCommands,
} from './knowledgeCamera';
import { KnowledgeLabels, type ChromeRect } from './knowledgeLabels';
import { knowledgePresence } from './knowledgePresence';

interface Pose { target: Vector3; distance: number; quaternion: Quaternion }
interface Motion {
  kind: 'enter' | 'exit' | 'dive' | 'fly';
  from: Pose;
  to: Pose;
  start: number;
  duration: number;
  lift: number;
  final?: { position: Vector3; quaternion: Quaternion };
}
interface Rig {
  target: Vec2;
  distance: number;
  goal: { target: Vec2; distance: number };
  velocity: Vec2;
  drag: { id: number; x: number; y: number; startX: number; startY: number; time: number; moved: boolean } | null;
  pointers: Map<number, { x: number; y: number }>;
  pinch: { distance: number; x: number; y: number } | null;
}

const FRONT = new Quaternion();
const EMPTY_GRAPH = { nodes: [], relations: [], omitted: 0 };
const FORWARD = new Vector3(0, 0, -1);
const scratch = new Vector3();

function easeInOut(t: number) { return t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; }
/** Enter and exit start moving at once, then settle: a pull, not a lurch. */
function easeHandoff(t: number) { return t * t * (3 - 2 * t) * .7 + (1 - (1 - t) ** 2) * .3; }
function smooth(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function KnowledgeScene({ layoutMode, lowQuality }: { layoutMode: AtlasLayoutMode; theme: 'dark' | 'light'; lowQuality: boolean }) {
  const open = useKnowledgeRuntime(s => s.open);
  const exiting = useKnowledgeRuntime(s => s.exiting);
  const graph = useKnowledgeRuntime(s => s.graph);
  const selected = useKnowledgeRuntime(s => s.selected);
  const hovered = useKnowledgeRuntime(s => s.hovered);
  const hoveredRelation = useKnowledgeRuntime(s => s.hoveredRelation);
  const relation = useKnowledgeRuntime(s => s.relation);
  const query = useKnowledgeRuntime(s => s.query);
  const lens = useKnowledgeRuntime(s => s.lens);
  const rings = useKnowledgeRuntime(s => s.rings);
  const focusRequest = useKnowledgeRuntime(s => s.focus);
  const labelLayer = useKnowledgeRuntime(s => s.labelLayer);
  const galaxy = useGalaxyStore(s => s.galaxy);
  const inactive = useGalaxyStore(s => s.inactiveRoots);
  const root = useAtlasStore(s => s.atlasRoot);
  const nativeSelected = useAtlasStore(s => s.selectedNodeId);
  const cloudFiles = useCloudGalaxy(s => s.files);
  const cloudCurrent = useCloudGalaxy(s => s.currentKey);
  /** Cloud files on the map: fetched, or too large to fetch (then a single named star). */
  const cloudShown = useMemo(() => cloudFiles.filter(file => file.key !== cloudCurrent && (file.status === 'ready' || file.status === 'too-large')), [cloudFiles, cloudCurrent]);
  const { camera, size, gl } = useThree();
  const perspective = camera as PerspectiveCamera;
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  // Fixed for one visit: the space the person came from, its neighbours' places.
  const visit = useRef<{ origin: string; anchors: Map<string, Vec2> | undefined; aspect: number } | null>(null);
  if (open && !visit.current && galaxy) visit.current = { origin: galaxy.activeSpaceId, anchors: undefined, aspect: Math.max(.6, Math.min(2.4, size.width / Math.max(1, size.height))) };
  if (!open) visit.current = null;

  const native = useMemo(() => {
    const result = new Map<string, Map<string, Vec3>>();
    if (!galaxy || !open) return result;
    for (const space of galaxy.spaces) {
      const tree = space.id === galaxy.activeSpaceId ? root : inactive[space.id];
      if (!tree) continue;
      const frame = deriveAtlasLayoutFrame(tree, layoutMode, undefined, {
        focusNodeId: space.id === galaxy.activeSpaceId ? nativeSelected : tree.id,
        viewport: size.width < 700 ? (size.width < size.height ? 'mobile-portrait' : 'mobile-landscape') : 'desktop',
        viewportWidth: size.width, viewportHeight: size.height,
      });
      result.set(space.id, frame.positions as Map<string, Vec3>);
    }
    for (const file of cloudShown) {
      const tree = file.root ?? placeholderRoot(file);
      const frame = deriveAtlasLayoutFrame(tree, 'phyllotaxis', undefined, { focusNodeId: tree.id, viewport: 'desktop', viewportWidth: size.width, viewportHeight: size.height });
      result.set(file.spaceId, frame.positions as Map<string, Vec3>);
    }
    return result;
    // The layout follows the notes; the viewport is read once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, galaxy?.spaces, galaxy?.activeSpaceId, inactive, root, nativeSelected, layoutMode, cloudShown]);

  const map = useMemo(() => {
    if (!open || !visit.current) return null;
    // Each cloud file is a galaxy of its own: well apart from the spaces and from each other.
    const built = buildKnowledgeMap(graph, native, visit.current.origin, visit.current.anchors, visit.current.aspect,
      (spaceId, radius) => (isCloudSpaceId(spaceId) ? Math.max(260, radius * .9) : 0));
    visit.current.anchors = built.anchors;
    return built;
  }, [open, graph, native]);
  const signals = useMemo(() => (open ? knowledgeHubSignals(graph) : new Map()), [open, graph]);
  const data = useMemo(() => (map ? buildFieldData(graph, map) : null), [graph, map]);
  const spaceColors = useMemo(() => new Map([
    ...(galaxy?.spaces ?? []).map(space => [space.id, space.color] as const),
    ...cloudShown.map(file => [file.spaceId, file.color] as const),
  ]), [galaxy?.spaces, cloudShown]);
  const cloudSpaces = useMemo(() => new Set(cloudShown.map(file => file.spaceId)), [cloudShown]);
  // The judged quality of each space (0..1), shown as the middle bar under its name.
  const quality = useMemo(() => new Map((galaxy?.spaces ?? []).map(space => {
    const level = galaxy?.judgments[space.id]?.answers?.quality?.level;
    return [space.id, typeof level === 'number' ? Math.max(.2, Math.min(1, level)) : null];
  })), [galaxy?.spaces, galaxy?.judgments]);
  const projection = useMemo(() => projectKnowledge(open ? graph : EMPTY_GRAPH, query, lens), [open, graph, query, lens]);
  const children = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const n of graph.nodes) if (n.parentKey) { const list = result.get(n.parentKey) ?? []; list.push(n.key); result.set(n.parentKey, list); }
    return result;
  }, [graph]);

  useEffect(() => { if (map) useKnowledgeRuntime.setState({ positions: map.positions, map }); }, [map]);

  // What stays lit while the rest steps back.
  const focus = useMemo<FieldFocus>(() => {
    const nodes = new Set<number>(), edges = new Set<number>();
    if (!data) return { nodes, edges, strength: 0 };
    const light = (key: string | null, neighbours: boolean) => {
      const index = key ? data.index.get(key) : undefined;
      if (index === undefined) return false;
      nodes.add(index);
      if (neighbours) for (const edge of data.edgesOfNode.get(index) ?? []) {
        edges.add(edge);
        nodes.add(data.edges[edge].a);
        nodes.add(data.edges[edge].b);
      }
      return true;
    };
    let strength = 0;
    if (projection.active) {
      for (const key of projection.nodes) { const index = data.index.get(key); if (index !== undefined) nodes.add(index); }
      for (const id of projection.edges) { const index = data.edgeByRelation.get(id); if (index !== undefined) edges.add(index); }
      strength = 1;
    }
    if (light(selected, !projection.active)) strength = Math.max(strength, .6);
    if (light(hovered, true)) strength = Math.max(strength, .35);
    for (const id of [hoveredRelation, relation]) {
      const index = id ? data.edgeByRelation.get(id) : undefined;
      if (index === undefined) continue;
      edges.add(index); nodes.add(data.edges[index].a); nodes.add(data.edges[index].b);
      strength = Math.max(strength, .6);
    }
    return { nodes, edges, strength };
  }, [data, projection, selected, hovered, hoveredRelation, relation]);

  const locale = currentAppLocale();
  const copy = knowledgeMessages[locale.startsWith('ja') ? 'ja' : 'en'];
  const relationMarks = useMemo(() => {
    if (!data || !focus.strength) return [];
    return [...focus.edges].map(index => data.edges[index]).filter(edge => edge.relation.type !== 'part-of').slice(0, 24).map(edge => ({
      a: edge.a, b: edge.b, curve: edge.curve,
      text: edge.relation.source === 'candidate' ? copy.candidateShort : relationLabel(edge.relation.type, locale),
      color: RELATION_COLORS[edge.relation.type] ?? RELATION_COLORS.related,
    }));
  }, [data, focus, copy, locale]);

  // ── Camera ──────────────────────────────────────────────────────────────
  const rig = useRef<Rig>({ target: [0, 0], distance: 5000, goal: { target: [0, 0], distance: 5000 }, velocity: [0, 0], drag: null, pointers: new Map(), pinch: null });
  const motion = useRef<Motion | null>(null);
  const saved = useRef<{ position: Vector3; quaternion: Quaternion; pivot: number } | null>(null);
  const live = useRef({ map, data, selected, projectionActive: projection.active, children, size });
  live.current = { map, data, selected, projectionActive: projection.active, children, size };

  const view = () => ({ width: size.width, height: size.height, fov: perspective.fov });
  const panelOpen = () => Boolean(live.current.selected || live.current.projectionActive);
  /**
   * The free part of the screen. On a phone the controls above and below the
   * map change height with fonts, safe areas and wrapping, so they are measured;
   * the desktop layout is fixed and uses the numbers from knowledge.css.
   */
  const insetsNow = (panel: boolean) => {
    const base = knowledgeInsets(size.width, size.height, panel);
    if (size.width >= 700 || typeof document === 'undefined') return base;
    const canvasRect = gl.domElement.getBoundingClientRect();
    const rects = (selectors: string[]) => selectors
      .map(selector => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => Boolean(rect && rect.width && rect.height));
    const above = rects(['.knowledge-overlay .galaxy-top', '.knowledge-heading', '.knowledge-lenses', '.knowledge-spaces']);
    const below = rects(panel ? ['.knowledge-detail'] : ['.knowledge-navigator', '.knowledge-ladder']);
    return {
      ...base,
      top: above.length ? Math.max(...above.map(rect => rect.bottom - canvasRect.top)) + 14 : base.top,
      bottom: below.length ? Math.max(60, canvasRect.bottom - Math.min(...below.map(rect => rect.top)) + 12) : base.bottom,
    };
  };
  const homePose = () => {
    const current = live.current.map;
    if (!current) return { target: [0, 0] as Vec2, distance: 5000 };
    return frameBounds(current.bounds, view(), insetsNow(panelOpen()), size.width < 700 ? 1.14 : 1.1);
  };
  /**
   * Until the person moves the map, the camera keeps the whole galaxy framed:
   * the notes index and the inactive spaces can still be arriving when the
   * telescope is tapped (typical right after a phone loads the page), and the
   * screen can change size or orientation.
   */
  const autoFit = useRef(true);
  const fitCheckedAt = useRef(0);
  const distanceLimits = () => {
    const current = live.current.map;
    const unit = current?.unit ?? 200;
    return { min: unit * .7, max: Math.max(unit * 20, homePose().distance * 2.4) };
  };
  const worldPerPixel = (distance: number) => (2 * distance * Math.tan((perspective.fov * Math.PI) / 360)) / Math.max(1, size.height);
  /** Shift a target so the subject sits in the middle of the free part of the screen. */
  const centred = (subject: Vec2, distance: number, avoidPanel: boolean): Vec2 => {
    const insets = insetsNow(avoidPanel && panelOpen());
    const wpp = worldPerPixel(distance);
    const offsetX = (insets.left - insets.right) / 2, offsetY = (insets.top - insets.bottom) / 2;
    return [subject[0] - offsetX * wpp, subject[1] + offsetY * wpp];
  };
  const startMotion = (kind: Motion['kind'], to: Pose, duration: number, final?: Motion['final']) => {
    const s = rig.current;
    const from: Pose = kind === 'enter'
      ? (() => {
          const forward = FORWARD.clone().applyQuaternion(camera.quaternion);
          const pivot = saved.current?.pivot ?? 600;
          return { target: camera.position.clone().addScaledVector(forward, pivot), distance: pivot, quaternion: camera.quaternion.clone() };
        })()
      : { target: new Vector3(s.target[0], s.target[1], 0), distance: s.distance, quaternion: camera.quaternion.clone() };
    const hop = Math.hypot(to.target.x - from.target.x, to.target.y - from.target.y);
    const lift = kind === 'fly' ? Math.min(.9, (hop / Math.max(200, Math.max(from.distance, to.distance))) * .5) : 0;
    motion.current = { kind, from, to, start: performance.now(), duration: reducedMotion ? 120 : duration, lift, final };
    s.velocity = [0, 0];
  };
  const flyTo = (subject: Vec2, distance: number, avoidPanel = true, duration?: number) => {
    const { min, max } = distanceLimits();
    const d = Math.min(max, Math.max(min, distance));
    const target = centred(subject, d, avoidPanel);
    const s = rig.current;
    const ratio = Math.abs(Math.log(d / Math.max(1, s.distance)));
    const hop = Math.hypot(target[0] - s.target[0], target[1] - s.target[1]) / Math.max(1, Math.max(d, s.distance));
    startMotion('fly', { target: new Vector3(target[0], target[1], 0), distance: d, quaternion: FRONT.clone() }, duration ?? Math.min(1500, 650 + ratio * 260 + hop * 220));
  };
  const subtreeBounds = (key: string) => {
    const current = live.current.map;
    if (!current) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const stack = [key];
    let count = 0;
    while (stack.length && count < 400) {
      const next = stack.pop()!;
      const p = current.positions.get(next);
      if (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); count++; }
      stack.push(...(live.current.children.get(next) ?? []));
    }
    return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
  };
  const focusOn = (key: string, level: 'space' | 'branch' | 'note' | 'keep') => {
    const current = live.current.map;
    const p = current?.positions.get(key);
    if (!current || !p) return;
    const node = live.current.data?.nodes[live.current.data.index.get(key) ?? -1];
    const resolved = level === 'keep' ? 'keep' : level;
    const insets = insetsNow(true);
    if (resolved === 'space' || resolved === 'branch') {
      const cluster = node && resolved === 'space' ? current.clusters.get(node.spaceId) : null;
      const bounds = cluster
        ? { minX: cluster.center[0] - cluster.radius, maxX: cluster.center[0] + cluster.radius, minY: cluster.center[1] - cluster.radius, maxY: cluster.center[1] + cluster.radius }
        : subtreeBounds(key);
      if (bounds) {
        const padded = { minX: Math.min(bounds.minX, p[0] - current.unit), maxX: Math.max(bounds.maxX, p[0] + current.unit), minY: Math.min(bounds.minY, p[1] - current.unit), maxY: Math.max(bounds.maxY, p[1] + current.unit) };
        const framed = frameBounds(padded, view(), insets, 1.18);
        flyTo([(padded.minX + padded.maxX) / 2, (padded.minY + padded.maxY) / 2], framed.distance);
        return;
      }
    }
    const wanted = knowledgeDistanceForLevel('note', current.unit, size.height, perspective.fov);
    const s = rig.current;
    const distance = resolved === 'note' ? wanted : s.distance > wanted * 2.6 ? wanted * 1.6 : s.distance;
    flyTo([p[0], p[1]], distance);
  };

  // Entry: remember the universe pose and pull back to the whole galaxy.
  useEffect(() => {
    if (!open) return;
    const forward = FORWARD.clone().applyQuaternion(camera.quaternion);
    // The pivot is where the camera was looking: the selected note's depth.
    const atlasSelected = useAtlasStore.getState().selectedNodeId;
    const activeId = useGalaxyStore.getState().galaxy?.activeSpaceId;
    const nativePoint = activeId ? native.get(activeId)?.get(atlasSelected) : undefined;
    let pivot = 600;
    if (nativePoint) {
      const along = scratch.set(...nativePoint).sub(camera.position).dot(forward);
      if (along > 40) pivot = along;
    }
    saved.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), pivot };
    autoFit.current = true;
    knowledgeFrame.flatten = 0;
    knowledgePresence.blend = 0;
    const home = homePose();
    rig.current.target = [...home.target];
    rig.current.goal = { target: [...home.target], distance: home.distance };
    rig.current.distance = home.distance;
    startMotion('enter', { target: new Vector3(home.target[0], home.target[1], 0), distance: home.distance, quaternion: FRONT.clone() }, lowQuality ? 1300 : 1900);
    return () => { saved.current = null; motion.current = null; knowledgePresence.blend = 0; knowledgeFrame.flatten = 0; };
    // Capture once on entry, not when a note changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Exit: back to the saved universe pose, or down into a chosen note.
  useEffect(() => {
    if (!exiting || !saved.current) return;
    const key = useKnowledgeRuntime.getState().enterKey;
    const destination = key ? live.current.map?.positions.get(key) : undefined;
    if (destination) {
      startMotion('dive', { target: new Vector3(destination[0], destination[1], destination[2]), distance: 520, quaternion: FRONT.clone() }, lowQuality ? 1100 : 1500);
      return;
    }
    const back = saved.current;
    const target = back.position.clone().addScaledVector(FORWARD.clone().applyQuaternion(back.quaternion), back.pivot);
    startMotion('exit', { target, distance: back.pivot, quaternion: back.quaternion.clone() }, lowQuality ? 1100 : 1600, { position: back.position.clone(), quaternion: back.quaternion.clone() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  // Selecting a note opens the panel; the view stays where the person put it.
  useEffect(() => { if (selected) autoFit.current = false; }, [selected]);

  useEffect(() => {
    if (!open || !focusRequest || motion.current?.kind === 'enter' || motion.current?.kind === 'exit') return;
    autoFit.current = false;
    focusOn(focusRequest.key, focusRequest.level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // ── Picking ─────────────────────────────────────────────────────────────
  const pick = (px: number, py: number) => {
    const current = live.current.data;
    if (!current) return -1;
    const pixelScale = size.height / (2 * Math.tan((perspective.fov * Math.PI) / 360));
    const unit = live.current.map?.unit ?? 200;
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < current.nodes.length; i++) {
      scratch.set(current.positions[i * 3], current.positions[i * 3 + 1], current.positions[i * 3 + 2]);
      const distance = Math.max(1, scratch.distanceTo(camera.position));
      const tier = current.tiers[i];
      const ppu = (unit * pixelScale) / distance;
      // Only what is visible can be picked.
      if (tier === 3 && ppu < 7) continue;
      if (tier === 2 && ppu < 3) continue;
      scratch.project(camera);
      if (scratch.z < -1 || scratch.z > 1) continue;
      const sx = ((scratch.x + 1) / 2) * size.width, sy = ((1 - scratch.y) / 2) * size.height;
      const radius = (tier === 0 ? 26 : tier === 1 ? 18 : Math.min(54, Math.max(current.minPx[i], (current.sizes[i] * pixelScale) / distance)) * .5 + 7);
      const d = Math.hypot(sx - px, sy - py);
      if (d > radius) continue;
      const score = d / radius + tier * .25;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  };
  const draggedAt = useRef(0);
  const select = (key: string, zoom: boolean) => {
    if (performance.now() - draggedAt.current < 300) return;
    const depth = live.current.data?.nodes[live.current.data.index.get(key) ?? -1]?.depth ?? 2;
    if (zoom) focusKnowledge(key, depth === 0 ? 'space' : depth === 1 ? 'branch' : 'note');
    else useKnowledgeRuntime.setState({ selected: key, anchor: key, relation: null });
  };

  // ── Input ───────────────────────────────────────────────────────────────
  const wheelRef = useRef<(event: WheelEvent) => void>(() => undefined);
  const pointerDownRef = useRef<(event: PointerEvent, capture?: boolean) => void>(() => undefined);
  useEffect(() => {
    if (!open) return;
    // Listen on the shell, not the canvas: the universe's HTML overlays (hidden
    // while the galaxy is open) still sit above the canvas and would swallow
    // pointer and wheel events aimed at the map.
    const element = gl.domElement.closest<HTMLElement>('.universe-shell') ?? gl.domElement;
    const canvas = gl.domElement;
    const s = rig.current;
    const busy = () => Boolean(motion.current && motion.current.kind !== 'fly') || useKnowledgeRuntime.getState().exiting;
    const local = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const ground = (px: number, py: number, target: Vec2, distance: number): Vec2 => {
      const wpp = worldPerPixel(distance);
      return [target[0] + (px - size.width / 2) * wpp, target[1] - (py - size.height / 2) * wpp];
    };
    const clamp = () => {
      const current = live.current.map;
      if (!current) return;
      const margin = Math.max(current.unit * 4, (current.bounds.maxX - current.bounds.minX) * .25);
      s.goal.target[0] = Math.min(current.bounds.maxX + margin, Math.max(current.bounds.minX - margin, s.goal.target[0]));
      s.goal.target[1] = Math.min(current.bounds.maxY + margin, Math.max(current.bounds.minY - margin, s.goal.target[1]));
    };
    const zoomAt = (px: number, py: number, factor: number) => {
      if (motion.current?.kind === 'fly') { const m = motion.current; s.goal = { target: [m.to.target.x, m.to.target.y], distance: m.to.distance }; motion.current = null; }
      const { min, max } = distanceLimits();
      const before = ground(px, py, s.goal.target, s.goal.distance);
      const distance = Math.min(max, Math.max(min, s.goal.distance * factor));
      const after = ground(px, py, s.goal.target, distance);
      s.goal.distance = distance;
      s.goal.target = [s.goal.target[0] + before[0] - after[0], s.goal.target[1] + before[1] - after[1]];
      clamp();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (busy()) return;
      autoFit.current = false;
      let delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      if (event.ctrlKey) delta *= 2.4; // trackpad pinch
      delta = Math.max(-240, Math.min(240, delta));
      const p = local(event.clientX, event.clientY);
      zoomAt(p.x, p.y, Math.exp(delta * .0016));
    };
    wheelRef.current = onWheel;
    let hoverFrame = 0;
    let hoverEvent: PointerEvent | null = null;
    const onPointerDown = (event: PointerEvent, capture = true) => {
      if (busy()) return;
      autoFit.current = false;
      // A press handed over from a label is not captured, so a tap still clicks it.
      if (capture) element.setPointerCapture?.(event.pointerId);
      s.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (motion.current?.kind === 'fly') { s.goal = { target: [s.target[0], s.target[1]], distance: s.distance }; motion.current = null; }
      s.velocity = [0, 0];
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        s.drag = null;
        return;
      }
      s.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (s.pointers.has(event.pointerId)) s.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const wpp = worldPerPixel(s.goal.distance);
        s.goal.target = [s.goal.target[0] - (mid.x - s.pinch.x) * wpp, s.goal.target[1] + (mid.y - s.pinch.y) * wpp];
        const p = local(mid.x, mid.y);
        zoomAt(p.x, p.y, s.pinch.distance / Math.max(1, distance));
        s.pinch = { distance, x: mid.x, y: mid.y };
        return;
      }
      const drag = s.drag;
      if (drag && drag.id === event.pointerId) {
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) drag.moved = true;
        if (!drag.moved) return;
        const wpp = worldPerPixel(s.goal.distance);
        const dx = -(event.clientX - drag.x) * wpp, dy = (event.clientY - drag.y) * wpp;
        s.goal.target = [s.goal.target[0] + dx, s.goal.target[1] + dy];
        const elapsed = Math.max(.008, (performance.now() - drag.time) / 1000);
        s.velocity = [(dx / elapsed) * .85, (dy / elapsed) * .85];
        drag.x = event.clientX; drag.y = event.clientY; drag.time = performance.now();
        clamp();
        return;
      }
      if (event.pointerType === 'mouse' && !busy()) {
        hoverEvent = event;
        if (!hoverFrame) hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (!hoverEvent) return;
          const p = local(hoverEvent.clientX, hoverEvent.clientY);
          if (p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height) return;
          const hit = pick(p.x, p.y);
          const key = hit >= 0 ? live.current.data!.nodes[hit].key : null;
          element.style.cursor = key ? 'pointer' : 'grab';
          if (useKnowledgeRuntime.getState().hovered !== key) useKnowledgeRuntime.setState({ hovered: key });
        });
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      s.pointers.delete(event.pointerId);
      if (s.pointers.size < 2) s.pinch = null;
      const drag = s.drag;
      if (!drag || drag.id !== event.pointerId) return;
      s.drag = null;
      if (performance.now() - drag.time > 90) s.velocity = [0, 0];
      if (drag.moved) { draggedAt.current = performance.now(); return; }
      if (event.target instanceof Element && event.target.closest('.kg-label')) return; // the label's click selects
      s.velocity = [0, 0];
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const p = local(event.clientX, event.clientY);
      const hit = pick(p.x, p.y);
      if (hit >= 0) select(live.current.data!.nodes[hit].key, false);
      else if (useKnowledgeRuntime.getState().selected) useKnowledgeRuntime.setState({ selected: null, relation: null });
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (busy()) return;
      autoFit.current = false;
      const p = local(event.clientX, event.clientY);
      const hit = pick(p.x, p.y);
      if (hit >= 0) { select(live.current.data!.nodes[hit].key, true); return; }
      zoomAt(p.x, p.y, .45);
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onLeave = () => { if (useKnowledgeRuntime.getState().hovered) useKnowledgeRuntime.setState({ hovered: null }); };
    element.addEventListener('wheel', onWheel, { passive: false });
    pointerDownRef.current = onPointerDown;
    const onShellPointerDown = (event: PointerEvent) => onPointerDown(event);
    element.addEventListener('pointerdown', onShellPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('pointerleave', onLeave);
    const previousTouch = element.style.touchAction, previousCursor = element.style.cursor;
    element.style.touchAction = 'none';
    element.style.cursor = 'grab';
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onShellPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('pointerleave', onLeave);
      element.style.touchAction = previousTouch;
      element.style.cursor = previousCursor;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      s.pointers.clear(); s.drag = null; s.pinch = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gl, size.width, size.height]);

  // ── Labels ──────────────────────────────────────────────────────────────
  const labels = useRef<KnowledgeLabels | null>(null);
  useEffect(() => {
    if (!labelLayer || !open) return;
    labels.current = new KnowledgeLabels(labelLayer, (key, double) => select(key, double), key => {
      if (useKnowledgeRuntime.getState().hovered !== key) useKnowledgeRuntime.setState({ hovered: key });
    }, event => wheelRef.current(event), event => pointerDownRef.current(event, false));
    return () => { labels.current?.dispose(); labels.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelLayer, open]);
  const chrome = useRef<{ at: number; rects: ChromeRect[] }>({ at: 0, rects: [] });
  const labelSignature = useRef('');
  const clusterRadius = useMemo(() => new Map([...(map?.clusters.values() ?? [])].map(c => [c.spaceId, c.radius])), [map]);
  const marked = useMemo(() => (projection.active ? projection.nodes : null), [projection]);

  // ── Frame ───────────────────────────────────────────────────────────────
  useFrame((_, rawDelta) => {
    if (!open) return;
    const delta = Math.min(.05, rawDelta);
    const s = rig.current;
    const now = performance.now();
    for (const command of takeKnowledgeCameraCommands()) {
      if (motion.current && motion.current.kind !== 'fly') continue;
      autoFit.current = command.kind === 'home';
      if (command.kind === 'fly') flyTo(command.target, command.distance, command.avoidPanel ?? false, command.duration);
      if (command.kind === 'zoom') {
        motion.current = null;
        const { min, max } = distanceLimits();
        s.goal.distance = Math.min(max, Math.max(min, s.goal.distance * command.factor));
      }
      if (command.kind === 'home') { const home = homePose(); flyTo(home.target, home.distance, false, 1100); rig.current.goal.target = [...home.target]; }
    }
    if (autoFit.current && !useKnowledgeRuntime.getState().exiting && now - fitCheckedAt.current > 160) {
      fitCheckedAt.current = now;
      keepFitted(now);
    }
    const m = motion.current;
    if (m) {
      const t = Math.min(1, (now - m.start) / m.duration);
      const e = m.kind === 'fly' ? easeInOut(t) : easeHandoff(t);
      const q = new Quaternion().slerpQuaternions(m.from.quaternion, m.to.quaternion, e);
      const target = new Vector3().lerpVectors(m.from.target, m.to.target, e);
      const distance = Math.exp(Math.log(m.from.distance) + (Math.log(m.to.distance) - Math.log(m.from.distance)) * e) * (1 + Math.sin(Math.PI * e) * m.lift);
      camera.quaternion.copy(q);
      camera.position.copy(target).addScaledVector(FORWARD.clone().applyQuaternion(q), -distance);
      if (m.kind === 'enter') { knowledgePresence.blend = smooth(.04, .55, t); knowledgeFrame.flatten = smooth(.25, 1, t); }
      if (m.kind === 'exit') { knowledgePresence.blend = 1 - smooth(.5, .96, t); knowledgeFrame.flatten = 1 - smooth(.05, .7, t); }
      if (m.kind === 'dive') { knowledgePresence.blend = 1 - smooth(.55, 1, t); knowledgeFrame.flatten = 1 - smooth(.15, .8, t); }
      s.target = [target.x, target.y];
      s.distance = distance;
      if (t >= 1) {
        motion.current = null;
        if (m.kind === 'enter' || m.kind === 'fly') {
          camera.quaternion.copy(FRONT);
          s.goal = { target: [m.to.target.x, m.to.target.y], distance: m.to.distance };
          s.target = [...s.goal.target];
          s.distance = m.to.distance;
          if (m.kind === 'enter') { knowledgePresence.blend = 1; knowledgeFrame.flatten = 1; }
        } else {
          finishExit(m);
          return;
        }
      }
    } else {
      // Free flight: inertia after a fling, then a damped glide to the goal.
      if (!s.drag && (Math.abs(s.velocity[0]) > .5 || Math.abs(s.velocity[1]) > .5)) {
        s.goal.target = [s.goal.target[0] + s.velocity[0] * delta, s.goal.target[1] + s.velocity[1] * delta];
        const decay = Math.exp(-delta * 3.6);
        s.velocity = [s.velocity[0] * decay, s.velocity[1] * decay];
      }
      const k = 1 - Math.exp(-delta * 9);
      s.target = [s.target[0] + (s.goal.target[0] - s.target[0]) * k, s.target[1] + (s.goal.target[1] - s.target[1]) * k];
      s.distance = Math.exp(Math.log(s.distance) + (Math.log(s.goal.distance) - Math.log(s.distance)) * k);
      camera.quaternion.copy(FRONT);
      camera.position.set(s.target[0], s.target[1], s.distance);
    }
    camera.updateMatrixWorld();

    // Publish the frame for the minimap, ladder and labels.
    const tan = Math.tan((perspective.fov * Math.PI) / 360);
    const pixelScale = size.height / (2 * tan);
    knowledgeFrame.target = [...s.target];
    knowledgeFrame.distance = s.distance;
    knowledgeFrame.width = size.width;
    knowledgeFrame.height = size.height;
    knowledgeFrame.fov = perspective.fov;
    knowledgeFrame.pixelsPerUnit = pixelScale / Math.max(1, s.distance);
    const halfH = s.distance * tan, halfW = halfH * (size.width / Math.max(1, size.height));
    knowledgeFrame.corners = [[s.target[0] - halfW, s.target[1] + halfH], [s.target[0] + halfW, s.target[1] + halfH], [s.target[0] + halfW, s.target[1] - halfH], [s.target[0] - halfW, s.target[1] - halfH]];
    emitKnowledgeFrame();
    const unit = live.current.map?.unit ?? 200;
    const level = knowledgeLevelOf((unit * pixelScale) / Math.max(1, s.distance));
    if (useKnowledgeRuntime.getState().level !== level && !motion.current) useKnowledgeRuntime.setState({ level });
    const shell = gl.domElement.closest<HTMLElement>('.universe-shell');
    if (shell) {
      shell.dataset.knowledgeBlend = knowledgePresence.blend.toFixed(3);
      shell.dataset.knowledgeDistance = s.distance.toFixed(1);
      shell.dataset.knowledgeDirection = FORWARD.clone().applyQuaternion(camera.quaternion).toArray().map(n => n.toFixed(3)).join(',');
    }

    // Labels follow the camera; skip the DOM work when nothing moved.
    const engine = labels.current, current = live.current.data;
    if (!engine || !current || !map) return;
    if (now - chrome.current.at > 400) {
      const canvasRect = gl.domElement.getBoundingClientRect();
      chrome.current = {
        at: now,
        rects: [...document.querySelectorAll<HTMLElement>('[data-kg-chrome]')].map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height)
          .map(rect => ({ x: rect.left - canvasRect.left, y: rect.top - canvasRect.top, w: rect.width, h: rect.height })),
      };
    }
    const state = useKnowledgeRuntime.getState();
    const signature = [camera.position.x.toFixed(1), camera.position.y.toFixed(1), camera.position.z.toFixed(1), knowledgePresence.blend.toFixed(2), knowledgeFrame.flatten.toFixed(2),
      state.selected, state.hovered, rings, current.nodes.length, map.unit, chrome.current.at, relationMarks.length, marked?.size ?? -1, size.width, size.height,
      engine.pending() ? Math.floor(now / 120) : ''].join('|');
    if (signature === labelSignature.current) return;
    labelSignature.current = signature;
    const galaxyState = useGalaxyStore.getState().galaxy;
    engine.update({
      data: current, camera: perspective, width: size.width, height: size.height, pixelScale, unit: map.unit,
      clusterRadius, signals, quality, rings, selected: state.selected, hovered: state.hovered,
      activeSpaceId: visit.current?.origin ?? galaxyState?.activeSpaceId ?? null, hereLabel: copy.here, untitled: copy.untitled,
      cloudSpaces, cloudLabel: copy.cloudFile,
      marked, relationMarks, chrome: chrome.current.rects, fade: smooth(.35, .9, knowledgePresence.blend), now,
    });
  });

  /** Re-frame the whole galaxy if the map or the screen changed. */
  const keepFitted = (now: number) => {
    const s = rig.current;
    const home = homePose();
    const m = motion.current;
    const differs = (target: { x: number; y: number }, distance: number) =>
      Math.abs(Math.log(distance / home.distance)) > .01 || Math.hypot(target.x - home.target[0], target.y - home.target[1]) > home.distance * .01;
    if (!m) {
      if (differs({ x: s.goal.target[0], y: s.goal.target[1] }, s.goal.distance)) s.goal = { target: [...home.target], distance: home.distance };
      return;
    }
    if (m.kind !== 'enter' || !differs(m.to.target, m.to.distance)) return;
    // Retarget the entry flight without a jump: keep the current pose and solve
    // for the start that leads from it to the new destination.
    const e = easeHandoff(Math.min(1, (now - m.start) / m.duration));
    if (e > .8) return; // close to landing: the free glide below finishes the job
    const target = new Vector3().lerpVectors(m.from.target, m.to.target, e);
    const logDistance = Math.log(m.from.distance) + (Math.log(m.to.distance) - Math.log(m.from.distance)) * e;
    const nextTarget = new Vector3(home.target[0], home.target[1], 0);
    m.from.target = target.clone().addScaledVector(nextTarget, -e).multiplyScalar(1 / (1 - e));
    m.from.distance = Math.exp((logDistance - e * Math.log(home.distance)) / (1 - e));
    m.to.target = nextTarget;
    m.to.distance = home.distance;
  };

  const finishExit = (m: Motion) => {
    const callback = useKnowledgeRuntime.getState().exit;
    const key = useKnowledgeRuntime.getState().enterKey;
    if (m.kind === 'dive' && key) {
      const node = live.current.data?.nodes[live.current.data.index.get(key) ?? -1];
      const anchor = node ? live.current.map?.anchors.get(node.spaceId) : undefined;
      camera.quaternion.copy(FRONT);
      camera.position.set(m.to.target.x - (anchor?.[0] ?? 0), m.to.target.y - (anchor?.[1] ?? 0), m.to.target.z + m.to.distance);
      window.dispatchEvent(new CustomEvent(KNOWLEDGE_CAMERA_HANDOFF, { detail: { position: camera.position.toArray(), direction: FORWARD.clone().applyQuaternion(camera.quaternion).toArray() } }));
    } else if (m.final) {
      camera.position.copy(m.final.position);
      camera.quaternion.copy(m.final.quaternion);
    }
    camera.updateMatrixWorld();
    knowledgePresence.blend = 0;
    knowledgeFrame.flatten = 0;
    useKnowledgeRuntime.setState({ open: false, exiting: false, exit: null, enterKey: null, hovered: null });
    callback?.();
  };

  if (!open || !data || !map) return null;
  return <KnowledgeField
    data={data} map={map} graph={graph} signals={signals} spaceColors={spaceColors} focus={focus}
    selectedIndex={selected ? data.index.get(selected) ?? null : null}
    rings={rings} lowQuality={lowQuality} reducedMotion={reducedMotion} faint={cloudSpaces}
  />;
}
