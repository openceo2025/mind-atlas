import { Html, OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Quaternion, Vector3, Matrix4, MOUSE, TOUCH } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { deriveAtlasLayoutFrame, type AtlasLayoutMode } from '../../layout/atlasLayout';
import { useAtlasStore } from '../../store/atlasStore';
import { useGalaxyStore } from '../../galaxy/galaxyStore';
import { KNOWLEDGE_CAMERA_HANDOFF, useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';
import { nodeKey, projectKnowledge } from '../../galaxy/knowledgeGraph';
import { knowledgeMessages } from '../../i18n/knowledgeMessages';
import { currentAppLocale } from '../../i18n/locales';
import { KnowledgeBodies } from './KnowledgeBodies';
import { KnowledgeFilaments } from './KnowledgeFilaments';
import { knowledgePresence } from './knowledgePresence';
import { knowledgeMetrics } from '../../galaxy/knowledgePresentation';

function knowledgeSpaceAnchor(id: string, activeId: string, spacing: number): [number, number, number] {
  if (id === activeId) return [0, 0, 0];
  let hash = 0; for (const c of id) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  const angle = (hash % 3600) / 3600 * Math.PI * 2;
  const radius = spacing * (1 + (hash % 4) * .2);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, -500];
}

/** Lives inside the Universe Canvas. It borrows the camera and returns its exact
 * pose on exit. Active notebook positions use the same layout as Universe. */
export function KnowledgeScene({ layoutMode, lowQuality }: { layoutMode: AtlasLayoutMode; theme: 'dark' | 'light'; lowQuality: boolean }) {
  const runtime = useKnowledgeRuntime();
  const galaxy = useGalaxyStore(s => s.galaxy);
  const inactive = useGalaxyStore(s => s.inactiveRoots);
  const root = useAtlasStore(s => s.atlasRoot);
  const selectedId = useAtlasStore(s => s.selectedNodeId);
  const { camera, size, gl } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const saved = useRef<{ position: Vector3; quaternion: Quaternion } | null>(null);
  const motion = useRef<{ from: Vector3; to: Vector3; targetFrom: Vector3; targetTo: Vector3; qFrom: Quaternion; qTo: Quaternion; fromBlend: number; elapsed: number; exit: boolean } | null>(null);
  const lastReported = useRef(0);
  const originSpace = useRef<string | null>(null);
  const anchorSpacing = useRef(0);
  if (runtime.open && !originSpace.current && galaxy) originSpace.current = galaxy.activeSpaceId;
  if (!runtime.open) { originSpace.current = null; anchorSpacing.current = 0; }
  const [moving, setMoving] = useState(false);
  const [labelKeys, setLabelKeys] = useState<string[]>([]);
  const labelCheck = useRef(0);
  const positions = useMemo(() => {
    const result = new Map<string, [number, number, number]>();
    if (!galaxy || !runtime.open) return result;
    const layouts = galaxy.spaces.flatMap(space => {
      const tree = space.id === galaxy.activeSpaceId ? root : inactive[space.id];
      if (!tree) return [];
      const layout = deriveAtlasLayoutFrame(tree, layoutMode, undefined, {
        focusNodeId: space.id === galaxy.activeSpaceId ? selectedId : tree.id,
        viewport: size.width < 700 ? (size.width < size.height ? 'mobile-portrait' : 'mobile-landscape') : 'desktop',
        viewportWidth: size.width, viewportHeight: size.height,
      });
      return [{ space, layout }];
    });
    // Preserve the native notebook geometry; adapt only the distance between
    // notebooks. Fix the spacing for this visit so edits cannot move the map.
    if (!anchorSpacing.current) {
      const extent = Math.max(0, ...layouts.flatMap(({ layout }) => [...layout.positions.values()].map(p => Math.hypot(p[0], p[1]))));
      anchorSpacing.current = Math.max(1600, extent * 2.5);
    }
    for (const { space, layout } of layouts) {
      const anchor = knowledgeSpaceAnchor(space.id, originSpace.current ?? galaxy.activeSpaceId, anchorSpacing.current);
      for (const [id, pos] of layout.positions) result.set(nodeKey(space.id, id), [pos[0] + anchor[0], pos[1] + anchor[1], pos[2] + anchor[2]]);
    }
    return result;
  }, [runtime.open, galaxy?.spaces, galaxy?.activeSpaceId, inactive, root, selectedId, layoutMode, size.width, size.height]);
  const projection = useMemo(() => projectKnowledge(runtime.graph, runtime.query, runtime.lens), [runtime.graph, runtime.query, runtime.lens]);
  const metrics=useMemo(()=>knowledgeMetrics(runtime.graph),[runtime.graph]);
  useEffect(() => { useKnowledgeRuntime.setState({ positions }); }, [positions]);
  const overview = useMemo(() => {
    const points = [...positions.values()];
    if (!points.length) return { position: [0, 0, 0] as [number, number, number], distance: 5000 };
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    const tangent = Math.tan(Math.PI / 8);
    const availableWidth = size.width < 700 ? size.width * .88 : Math.max(360, size.width - 640);
    const availableHeight = size.width < 700 ? size.height * .42 : size.height * .55;
    const distance = Math.max(2700, (maxX - minX + 1800) * size.height / (2 * tangent * availableWidth), (maxY - minY + 1800) * size.height / (2 * tangent * availableHeight));
    return { position: [(minX + maxX) / 2, (minY + maxY) / 2 + distance * tangent * .22, -340] as [number, number, number], distance };
  }, [positions, size.width, size.height]);
  useEffect(() => { useKnowledgeRuntime.setState({ overview }); }, [overview]);
  const startMotion = (to: Vector3, target: Vector3, exit = false) => {
    setMoving(true);
    const qTo = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(to, target, new Vector3(0,1,0)));
    motion.current = { from: camera.position.clone(), to, targetFrom: controls.current?.target.clone() ?? camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(300)), targetTo: target, qFrom: camera.quaternion.clone(), qTo, fromBlend: knowledgePresence.blend, elapsed: 0, exit };
  };
  useEffect(() => {
    if (!runtime.open) return;
    saved.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    const focus = new Vector3(...overview.position);
    startMotion(focus.clone().add(new Vector3(0, 0, overview.distance)), focus);
    return () => { saved.current = null; knowledgePresence.blend = 0; };
    // Capture once on entry, not when a note changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.open]);
  useEffect(() => {
    if (!runtime.exiting || !saved.current) return;
    const destination = runtime.enterKey && positions.get(runtime.enterKey);
    if (destination) {
      const target = new Vector3(...destination);
      startMotion(target.clone().add(new Vector3(0, 0, 420)), target, true);
      return;
    }
    const target = saved.current.position.clone().add(new Vector3(0, 0, -300).applyQuaternion(saved.current.quaternion));
    startMotion(saved.current.position.clone(), target, true);
  }, [runtime.exiting]);
  useEffect(() => {
    if (!runtime.open || !runtime.focus) return;
    const target = new Vector3(...runtime.focus.position);
    startMotion(target.clone().add(new Vector3(0, 0, runtime.focus.distance)), target);
  }, [runtime.focus]);
  useFrame((state, delta) => {
    if (!runtime.open) return;
    const m = motion.current;
    if (m) {
      m.elapsed += Math.min(delta, 0.06);
      const t = Math.min(1, m.elapsed / (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.1 : lowQuality ? 1.1 : 1.55));
      const eased = t * t * (3 - 2 * t);
      camera.position.lerpVectors(m.from, m.to, eased);
      const target = new Vector3().lerpVectors(m.targetFrom, m.targetTo, eased);
      camera.quaternion.slerpQuaternions(m.qFrom, m.qTo, eased);
      knowledgePresence.blend = m.fromBlend + ((m.exit ? 0 : 1) - m.fromBlend) * eased;
      if (controls.current) controls.current.target.copy(target);
      if (t === 1) {
        motion.current = null;
        setMoving(false);
        if (m.exit) {
          const callback = useKnowledgeRuntime.getState().exit;
          if (runtime.enterKey) {
            const spaceId = runtime.graph.nodes.find(n => n.key === runtime.enterKey)?.spaceId;
            if (spaceId) camera.position.sub(new Vector3(...knowledgeSpaceAnchor(spaceId, originSpace.current ?? spaceId, anchorSpacing.current)));
            window.dispatchEvent(new CustomEvent(KNOWLEDGE_CAMERA_HANDOFF, { detail: { position: camera.position.toArray(), direction: camera.getWorldDirection(new Vector3()).toArray() } }));
          } else if (saved.current) camera.quaternion.copy(saved.current.quaternion);
          knowledgePresence.blend = 0;
          useKnowledgeRuntime.setState({ open: false, exiting: false, exit: null, enterKey: null });
          callback?.();
        }
      }
    }
    const distance = camera.position.distanceTo(controls.current?.target ?? new Vector3());
    const shell=gl.domElement.closest<HTMLElement>('.universe-shell');
    if(shell){shell.dataset.knowledgeBlend=knowledgePresence.blend.toFixed(3);shell.dataset.knowledgeDistance=distance.toFixed(1);shell.dataset.knowledgeDirection=camera.getWorldDirection(new Vector3()).toArray().map(n=>n.toFixed(3)).join(',');}
    if (Math.abs(distance - lastReported.current) > Math.max(20, distance * .025)) {
      lastReported.current = distance; useKnowledgeRuntime.setState({ distance });
    }
    if (state.clock.elapsedTime - labelCheck.current > .12) {
      labelCheck.current = state.clock.elapsedTime;
      const candidates = runtime.graph.nodes.filter(n => n.depth <= 1 || n.key === runtime.selected || projection.seeds.has(n.key) || n.depth <= (distance < 1400 ? 8 : distance < 6000 ? 2 : 1))
        .sort((a, b) => Number(b.key === runtime.selected) - Number(a.key === runtime.selected) || Number(projection.seeds.has(b.key)) - Number(projection.seeds.has(a.key)) || a.depth - b.depth);
      const placed: { x: number; y: number; width: number }[] = [];
      const keys: string[] = [];
      const mobile = size.width < 700;
      for (const n of candidates) {
        const pos = positions.get(n.key); if (!pos) continue;
        const screen = new Vector3(...pos).project(camera);
        if (screen.z < -1 || screen.z > 1 || Math.abs(screen.x) > .94 || Math.abs(screen.y) > .9) continue;
        const x = (screen.x + 1) * size.width / 2, y = (1 - screen.y) * size.height / 2 + 35;
        if (y < (mobile ? 225 : 100) || y > size.height - 80) continue;
        if (!mobile && (x < 235 || (runtime.selected || projection.active) && x > size.width - 390)) continue;
        if (mobile && runtime.selected && y > size.height * .57) continue;
        const width = Math.min(220, n.node.title.length * (n.depth === 0 ? 11 : 7) + 24);
        if (placed.some(p => Math.abs(p.y - y) < 40 && Math.abs(p.x - x) < (p.width + width) / 2 + 14)) continue;
        placed.push({ x, y, width }); keys.push(n.key);
        if (keys.length >= (mobile ? 12 : 45)) break;
      }
      setLabelKeys(previous => previous.join('|') === keys.join('|') ? previous : keys);
    }
  });
  if (!runtime.open || !galaxy) return null;
  const copy = knowledgeMessages[currentAppLocale().startsWith('ja') ? 'ja' : 'en'];
  const labels = runtime.graph.nodes.filter(n => labelKeys.includes(n.key));
  const select = (key: string, zoom = false) => {
    useKnowledgeRuntime.setState({ selected: key, anchor: key });
    if (zoom) { const position = positions.get(key); if (position) useKnowledgeRuntime.setState({ focus: { position, distance: 650, nonce: performance.now() } }); }
  };
  return <group>
    <OrbitControls ref={controls} makeDefault enabled={!runtime.exiting && !moving} enableRotate={false} enableDamping={!moving && !lowQuality} dampingFactor={.12} zoomSpeed={.65} panSpeed={.7} minDistance={250} maxDistance={70000} screenSpacePanning zoomToCursor mouseButtons={{LEFT:MOUSE.PAN,MIDDLE:MOUSE.DOLLY,RIGHT:MOUSE.PAN}} touches={{ONE:TOUCH.PAN,TWO:TOUCH.DOLLY_PAN}} />
    <KnowledgeFilaments graph={runtime.graph} positions={positions} distance={runtime.distance} selected={runtime.selected} hovered={runtime.hovered} relation={runtime.hoveredRelation ?? runtime.relation} highlighted={projection.active ? projection.edges : null}/>
    <KnowledgeBodies graph={runtime.graph} positions={positions} selected={runtime.selected} hovered={runtime.hovered} highlighted={projection.active ? projection.nodes : null} rings={runtime.rings} onPick={select} onHover={key=>useKnowledgeRuntime.setState({hovered:key})}/>
    {labels.map(n => {
      const pos = positions.get(n.key); if (!pos) return null;
      const isRoot = n.depth <= 1;
      return <Html key={n.key} position={pos} center zIndexRange={[32, 10]} style={{ pointerEvents: 'auto' }}>
        <button className={`knowledge-map-label ${isRoot ? 'is-cluster' : ''} ${runtime.selected === n.key ? 'is-selected' : ''} ${projection.active && !projection.nodes.has(n.key) ? 'is-dim' : ''}`} data-theme="dark"
          onClick={() => select(n.key)} onDoubleClick={() => select(n.key, true)}>
          {isRoot && <small>{galaxy.spaces.find(s => s.id === n.spaceId)?.title}</small>}
          <strong>{n.node.title || copy.untitled}</strong>
          {isRoot && <span>{metrics.get(n.key)?.count ?? 1} {copy.nodes}</span>}
        </button>
      </Html>;
    })}
  </group>;
}
