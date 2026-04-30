import { Html, Line, MapControls } from "@react-three/drei";
import { Canvas, ThreeEvent, createPortal, useFrame, useThree } from "@react-three/fiber";
import { WheelEvent, useEffect, useMemo, useRef } from "react";
import { Color, Group, Mesh, MOUSE, OrthographicCamera, Scene, TOUCH } from "three";
import { INITIAL_ATLAS_ZOOM } from "../config/view";
import { resonanceLinks } from "../data/atlas";
import { getNodeWorldPosition, useAtlasStore } from "../store/atlasStore";
import type { Artifact, AtlasEvent, AtlasNode, WorkArea, WorkStatus } from "../types";
import { getStatusColor, getStatusLabel } from "../utils/status";

const WORLD_BOUNDS = {
  minX: -320,
  maxX: 320,
  minY: -230,
  maxY: 190,
};

const FOCUS_PAN_DURATION_SECONDS = 0.96;
const FOCUS_ZOOM_DURATION_SECONDS = FOCUS_PAN_DURATION_SECONDS * 1.5;

export function UniverseCanvas() {
  const focusParentLayer = useAtlasStore((state) => state.focusParentLayer);
  const wheelZoomOutRef = useRef({ amount: 0, startedAt: 0, lastFiredAt: 0 });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      focusParentLayer();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusParentLayer]);

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    const now = performance.now();
    const state = wheelZoomOutRef.current;

    if (event.deltaY <= 0) {
      state.amount = 0;
      state.startedAt = 0;
      return;
    }

    event.preventDefault();

    if (now - state.lastFiredAt < 680) {
      return;
    }

    if (!state.startedAt || now - state.startedAt > 520) {
      state.amount = 0;
      state.startedAt = now;
    }

    state.amount += Math.abs(event.deltaY);

    if (state.amount >= 260 && now - state.startedAt >= 120) {
      state.amount = 0;
      state.startedAt = 0;
      state.lastFiredAt = now;
      focusParentLayer();
    }
  };

  return (
    <section className="universe-shell" aria-label="Mind Atlas universe view" onWheel={handleWheel}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 180], zoom: INITIAL_ATLAS_ZOOM, near: 0.1, far: 1000 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
        onPointerMissed={() => undefined}
      >
        <ambientLight intensity={0.7} />
        <pointLight position={[120, 160, 110]} intensity={1.35} color="#f3d08a" />
        <pointLight position={[-180, -120, 80]} intensity={0.8} color="#78e6c5" />
        <BackgroundStarLayer />
        <NavigationController />
        <GridPlane />
        <ResonanceLinks />
        <WorkAreas />
      </Canvas>
    </section>
  );
}

function NavigationController() {
  const controlsRef = useRef<any>(null);
  const focusRequest = useAtlasStore((state) => state.focusRequest);
  const setViewport = useAtlasStore((state) => state.setViewport);
  const { camera, size } = useThree();
  const initialCenteredRef = useRef(false);
  const transitionRef = useRef<{
    startX: number;
    startY: number;
    startZoom: number;
    targetX: number;
    targetY: number;
    targetZoom: number;
    elapsed: number;
    panDuration: number;
    zoomDuration: number;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (!focusRequest || !controlsRef.current) return;
    const ortho = camera as OrthographicCamera;
    const targetZoom =
      focusRequest.zoom ?? getZoomForDiameter(focusRequest.diameter, size.height);
    const focusPanelWidth = getRightFocusPanelWidth(size.width);
    const targetX = focusRequest.x + focusPanelWidth / 2 / targetZoom;
    transitionRef.current = {
      startX: camera.position.x,
      startY: camera.position.y,
      startZoom: ortho.zoom,
      targetX,
      targetY: focusRequest.y,
      targetZoom,
      elapsed: 0,
      panDuration: FOCUS_PAN_DURATION_SECONDS,
      zoomDuration: FOCUS_ZOOM_DURATION_SECONDS,
      nonce: focusRequest.nonce,
    };
  }, [camera, focusRequest, setViewport, size.height, size.width]);

  useEffect(() => {
    if (initialCenteredRef.current || !controlsRef.current) return;
    initialCenteredRef.current = true;

    requestAnimationFrame(() => {
      const ortho = camera as OrthographicCamera;
      const focusPanelWidth = getRightFocusPanelWidth(size.width);
      const x = focusPanelWidth / 2 / INITIAL_ATLAS_ZOOM;

      camera.position.set(x, 0, 180);
      ortho.zoom = INITIAL_ATLAS_ZOOM;
      camera.updateProjectionMatrix();
      controlsRef.current.target.set(x, 0, 0);
      controlsRef.current.update();
      setViewport({ x, y: 0, zoom: INITIAL_ATLAS_ZOOM });
    });
  }, [camera, setViewport, size.width]);

  useFrame((_, delta) => {
    const transition = transitionRef.current;
    if (!transition || !controlsRef.current) return;

    transition.elapsed += delta;
    const panProgress = Math.min(1, transition.elapsed / transition.panDuration);
    const zoomProgress = Math.min(1, transition.elapsed / transition.zoomDuration);
    const panEased = easeInOutQuint(panProgress);
    const zoomEased = easeInOutQuint(zoomProgress);
    const zoom = lerp(transition.startZoom, transition.targetZoom, zoomEased);
    const x = lerp(transition.startX, transition.targetX, panEased);
    const y = lerp(transition.startY, transition.targetY, panEased);
    const ortho = camera as OrthographicCamera;

    camera.position.set(x, y, 180);
    ortho.zoom = zoom;
    camera.updateProjectionMatrix();
    controlsRef.current.target.set(x, y, 0);
    controlsRef.current.update();
    setViewport({ x, y, zoom });

    if (panProgress >= 1 && zoomProgress >= 1) {
      transitionRef.current = null;
    }
  });

  return (
    <MapControls
      ref={controlsRef}
      enableRotate={false}
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning
      minZoom={0.42}
      maxZoom={32}
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
      onChange={() => {
        if (transitionRef.current) return;
        const ortho = camera as OrthographicCamera;
        setViewport({
          x: camera.position.x,
          y: camera.position.y,
          zoom: ortho.zoom,
        });
      }}
    />
  );
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function easeInOutQuint(value: number) {
  return value < 0.5 ? 16 * value * value * value * value * value : 1 - Math.pow(-2 * value + 2, 5) / 2;
}

function getZoomForDiameter(diameter: number, viewportHeight: number) {
  const targetPixels = viewportHeight / 4;
  return Math.min(32, Math.max(0.52, targetPixels / Math.max(diameter, 1)));
}

function getRightFocusPanelWidth(viewportWidth: number) {
  const panel = document.querySelector<HTMLElement>(".focus-panel");
  if (!panel) return 0;

  const rect = panel.getBoundingClientRect();
  const isRightDocked = rect.left > viewportWidth * 0.48 && rect.width > 0;
  return isRightDocked ? rect.width + Math.max(0, viewportWidth - rect.right) : 0;
}

function BackgroundStarLayer() {
  const backgroundScene = useMemo(() => new Scene(), []);
  const backgroundCamera = useMemo(() => new OrthographicCamera(), []);
  const backgroundColor = useMemo(() => new Color("#050706"), []);
  const { gl, scene, camera, size } = useThree();

  useEffect(() => {
    backgroundCamera.left = -size.width / 2;
    backgroundCamera.right = size.width / 2;
    backgroundCamera.top = size.height / 2;
    backgroundCamera.bottom = -size.height / 2;
    backgroundCamera.near = -1000;
    backgroundCamera.far = 1000;
    backgroundCamera.position.set(0, 0, 20);
    backgroundCamera.zoom = 1;
    backgroundCamera.updateProjectionMatrix();
  }, [backgroundCamera, size.height, size.width]);

  useFrame(() => {
    gl.autoClear = true;
    gl.setClearColor(backgroundColor, 1);
    gl.render(backgroundScene, backgroundCamera);
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(scene, camera);
    gl.autoClear = true;
  }, 1);

  return createPortal(<StarField />, backgroundScene);
}

function StarField() {
  const layers = useMemo(() => {
    let seed = 97;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const configs = [
      { count: 680, opacity: 0.32, size: 1.05, parallax: 0.014, z: -5, color: "#9fb2a8" },
      { count: 390, opacity: 0.42, size: 1.28, parallax: 0.026, z: -4, color: "#bbcbbf" },
      { count: 245, opacity: 0.52, size: 1.55, parallax: 0.042, z: -3, color: "#d4dfd6" },
      { count: 132, opacity: 0.64, size: 1.86, parallax: 0.064, z: -2, color: "#eef5e8" },
      { count: 52, opacity: 0.78, size: 2.22, parallax: 0.092, z: -1, color: "#fff0b6" },
    ];

    return configs.map((config) => {
      const values = new Float32Array(config.count * 3);
      for (let index = 0; index < config.count; index += 1) {
        values[index * 3] = -2100 + rand() * 4200;
        values[index * 3 + 1] = -1200 + rand() * 2400;
        values[index * 3 + 2] = config.z + rand() * 0.4;
      }
      return { ...config, positions: values };
    });
  }, []);

  const refs = useRef<Array<Group | null>>([]);

  useFrame(({ camera }) => {
    layers.forEach((layer, index) => {
      const group = refs.current[index];
      if (!group) return;
      group.position.x = -camera.position.x * layer.parallax;
      group.position.y = -camera.position.y * layer.parallax;
    });
  });

  return (
    <group>
      {layers.map((layer, index) => (
        <group
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
        >
          <points>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[layer.positions, 3]} />
            </bufferGeometry>
            <pointsMaterial
              color={layer.color}
              size={layer.size}
              sizeAttenuation={false}
              transparent
              opacity={layer.opacity}
              depthWrite={false}
            />
          </points>
        </group>
      ))}
    </group>
  );
}

function GridPlane() {
  const lines = useMemo(() => {
    const result: [number, number, number][][] = [];
    for (let x = -300; x <= 300; x += 60) {
      result.push([
        [x, WORLD_BOUNDS.minY, -18],
        [x, WORLD_BOUNDS.maxY, -18],
      ]);
    }
    for (let y = -210; y <= 180; y += 60) {
      result.push([
        [WORLD_BOUNDS.minX, y, -18],
        [WORLD_BOUNDS.maxX, y, -18],
      ]);
    }
    return result;
  }, []);

  return (
    <group>
      {lines.map((points, index) => (
        <Line key={index} points={points} color="#28453c" transparent opacity={0.22} lineWidth={0.6} />
      ))}
    </group>
  );
}

function WorkAreas() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  return (
    <group>
      {atlasRoot.children.map((node) => (
        <HierarchyNode key={node.id} node={node} depth={1} selectedNodeId={selectedNodeId} activePath={[atlasRoot.id, selectedNodeId]} />
      ))}
    </group>
  );
}

function HierarchyNode({
  node,
  depth,
  selectedNodeId,
  activePath,
}: {
  node: AtlasNode;
  depth: number;
  selectedNodeId: string;
  activePath: string[];
}) {
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectNode = useAtlasStore((state) => state.selectNode);
  const zoom = useAtlasStore((state) => state.viewport.zoom);
  const selection = useAtlasStore((state) => state.selected);
  const isSelected = selectedNodeId === node.id || (selection.kind !== "node" && selection.id === node.id);
  const isFocusedBranch = activePath.includes(node.id) || isSelected;
  const pulseRef = useRef<Mesh>(null);
  const statusColor = getStatusColor(node.status);
  const labelVisible = depth <= 1 ? zoom > 0.55 : zoom > getLabelZoom(depth) || isSelected;
  const childrenVisible = node.children.length > 0 && (isFocusedBranch || zoom >= getChildVisibilityZoom(depth));

  useFrame(({ clock }) => {
    if (!pulseRef.current) return;
    const active = node.status === "needs_review" || node.status === "running" || node.status === "error";
    const pulse = active ? 1 + Math.sin(clock.elapsedTime * (2.1 + depth * 0.18)) * 0.065 : 1;
    pulseRef.current.scale.setScalar(pulse);
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    selectNode(node.id);
  };

  return (
    <group position={node.position ?? [0, 0, 5]}>
      <mesh ref={pulseRef}>
        <torusGeometry args={[node.radius * (depth <= 1 ? 1.42 : 1.95), Math.max(0.16, node.radius * 0.035), 14, 96]} />
        <meshBasicMaterial color={statusColor} transparent opacity={isSelected ? 0.56 : depth <= 1 ? 0.24 : 0.18} />
      </mesh>
      {depth <= 1 ? (
        <mesh>
          <torusGeometry args={[node.radius * 2.05, 0.35, 14, 132]} />
          <meshBasicMaterial color={node.color} transparent opacity={0.18} />
        </mesh>
      ) : null}
      <mesh onClick={handleClick} onDoubleClick={() => focusNode(node.id)}>
        <sphereGeometry args={[node.radius, depth <= 1 ? 40 : 24, depth <= 1 ? 22 : 12]} />
        <meshStandardMaterial
          color={node.color}
          emissive={statusColor}
          emissiveIntensity={isSelected ? 0.72 : depth <= 1 ? 0.24 : 0.34}
          roughness={0.58}
          metalness={0.06}
        />
      </mesh>
      <mesh position={[node.radius * -0.28, node.radius * 0.32, node.radius * 0.74]}>
        <sphereGeometry args={[Math.max(0.55, node.radius * 0.2), 16, 10]} />
        <meshBasicMaterial color="#fff7cf" transparent opacity={0.68} />
      </mesh>

      {childrenVisible
        ? node.children.map((child, index) => {
            const position = getChildOrbitPosition(node, index, depth);
            return (
              <group key={child.id}>
                <Line
                  points={[[0, 0, -1], [position[0], position[1], -1]]}
                  color={node.color}
                  transparent
                  opacity={depth <= 1 ? 0.22 : 0.16}
                  lineWidth={0.5}
                />
                <HierarchyNode
                  node={{ ...child, position }}
                  depth={depth + 1}
                  selectedNodeId={selectedNodeId}
                  activePath={isSelected ? [...activePath, child.id] : activePath}
                />
              </group>
            );
          })
        : null}

      {labelVisible ? (
        <Html center position={[0, getNodeLabelOffsetY(node.radius, depth, zoom), 14]} transform={false}>
          <button
            className={`space-label hierarchy-label depth-${depth} ${isSelected ? "is-selected" : ""}`}
            type="button"
            onClick={() => selectNode(node.id)}
            onDoubleClick={() => focusNode(node.id)}
          >
            <span className="space-label-title">{node.title}</span>
            <span className="space-label-status" style={{ color: statusColor }}>
              {depth <= 1 ? getStatusLabel(node.status) : node.kind}
            </span>
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function getChildOrbitPosition(parent: AtlasNode, index: number, depth: number): [number, number, number] {
  const angle = (Math.PI * 2 * index) / Math.max(parent.children.length, 1) - Math.PI / 4 + (depth + 1) * 0.23;
  const orbit = parent.radius * (depth <= 1 ? 2.08 : 2.32);
  return [Math.cos(angle) * orbit, Math.sin(angle) * orbit, 5];
}

function getChildVisibilityZoom(depth: number) {
  if (depth <= 1) return 0;
  if (depth === 2) return 4.1;
  return 7.8 + (depth - 3) * 2.4;
}

function getLabelZoom(depth: number) {
  if (depth <= 2) return 1.15;
  return 4.4 + (depth - 3) * 2.2;
}

function getNodeLabelOffsetY(radius: number, depth: number, zoom: number) {
  const screenGapPx = depth <= 1 ? 12 : 8;
  const gap = screenGapPx / Math.max(zoom, 0.1);
  return -radius - gap;
}

function WorkAreaNode({ area }: { area: WorkArea }) {
  const selectWorkArea = useAtlasStore((state) => state.selectWorkArea);
  const selectArtifact = useAtlasStore((state) => state.selectArtifact);
  const selectEvent = useAtlasStore((state) => state.selectEvent);
  const focusWorkArea = useAtlasStore((state) => state.focusWorkArea);
  const focusPoint = useAtlasStore((state) => state.focusPoint);
  const selection = useAtlasStore((state) => state.selected);
  const zoom = useAtlasStore((state) => state.viewport.zoom);
  const isSelected = selection.kind === "workArea" && selection.id === area.id;
  const statusColor = getStatusColor(area.status);
  const pulseRef = useRef<Mesh>(null);

  const satellites = useMemo(() => {
    const artifactItems = area.artifacts.map((artifact, index) => ({
      id: artifact.id,
      kind: "artifact" as const,
      title: artifact.title,
      status: artifact.status,
      index,
      totalIndex: index,
      payload: artifact,
    }));
    const eventItems = area.events.slice(-4).map((event, index) => ({
      id: event.id,
      kind: "event" as const,
      title: event.type,
      status: area.status,
      index,
      totalIndex: artifactItems.length + index,
      payload: event,
    }));
    return [...artifactItems, ...eventItems];
  }, [area.artifacts, area.events, area.status]);

  useFrame(({ clock }) => {
    if (!pulseRef.current) return;
    const active = area.status === "needs_review" || area.status === "running" || area.status === "error";
    const pulse = active ? 1 + Math.sin(clock.elapsedTime * 2.2) * 0.08 : 1;
    pulseRef.current.scale.setScalar(pulse);
  });

  const handleAreaClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    selectWorkArea(area.id);
  };

  const labelVisible = zoom > 0.55;
  const detailVisible = zoom > 1.15 || isSelected;

  return (
    <group position={area.position}>
      <mesh ref={pulseRef}>
        <torusGeometry args={[area.radius * 1.42, 0.75, 18, 132]} />
        <meshBasicMaterial color={statusColor} transparent opacity={isSelected ? 0.56 : 0.26} />
      </mesh>
      <mesh>
        <torusGeometry args={[area.radius * 2.05, 0.35, 14, 132]} />
        <meshBasicMaterial color={area.color} transparent opacity={0.18} />
      </mesh>
      <mesh onClick={handleAreaClick} onDoubleClick={() => focusWorkArea(area.id)}>
        <sphereGeometry args={[area.radius, 40, 22]} />
        <meshStandardMaterial
          color={area.color}
          emissive={statusColor}
          emissiveIntensity={isSelected ? 0.55 : 0.22}
          roughness={0.62}
          metalness={0.08}
        />
      </mesh>
      <mesh position={[area.radius * -0.28, area.radius * 0.32, area.radius * 0.74]}>
        <sphereGeometry args={[area.radius * 0.22, 20, 14]} />
        <meshBasicMaterial color="#fff7cf" transparent opacity={0.76} />
      </mesh>

      {satellites.map((item) => {
        const angle = (Math.PI * 2 * item.totalIndex) / Math.max(satellites.length, 1) - Math.PI / 4;
        const orbit = area.radius * (item.kind === "artifact" ? 2.05 : 2.42);
        const x = Math.cos(angle) * orbit;
        const y = Math.sin(angle) * orbit;
        const selected =
          selection.kind === item.kind && selection.id === item.id && selection.parentId === area.id;

        return (
          <SatelliteNode
            key={item.id}
            area={area}
            item={item}
            position={[x, y, 5]}
            selected={selected}
            showLabel={detailVisible}
            onSelect={() => {
              item.kind === "artifact" ? selectArtifact(area.id, item.id) : selectEvent(area.id, item.id);
              focusPoint(area.position[0] + x, area.position[1] + y, item.kind === "artifact" ? 11.2 : 7.6);
            }}
          />
        );
      })}

      {labelVisible ? (
        <Html center position={[0, -area.radius - 17, 14]} transform={false}>
          <button
            className={`space-label ${isSelected ? "is-selected" : ""}`}
            type="button"
            onClick={() => selectWorkArea(area.id)}
            onDoubleClick={() => focusWorkArea(area.id)}
          >
            <span className="space-label-title">{area.title}</span>
            <span className="space-label-status" style={{ color: statusColor }}>
              {getStatusLabel(area.status)}
            </span>
          </button>
        </Html>
      ) : null}
    </group>
  );
}

type SatelliteItem =
  | {
      id: string;
      kind: "artifact";
      title: string;
      status: WorkStatus;
      index: number;
      totalIndex: number;
      payload: Artifact;
    }
  | {
      id: string;
      kind: "event";
      title: string;
      status: WorkStatus;
      index: number;
      totalIndex: number;
      payload: AtlasEvent;
    };

function SatelliteNode({
  area,
  item,
  position,
  selected,
  showLabel,
  onSelect,
}: {
  area: WorkArea;
  item: SatelliteItem;
  position: [number, number, number];
  selected: boolean;
  showLabel: boolean;
  onSelect: () => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const statusColor = getStatusColor(item.status);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const base = selected ? 1.36 : 1;
    meshRef.current.scale.setScalar(base + Math.sin(clock.elapsedTime * 1.6 + item.totalIndex) * 0.025);
  });

  return (
    <group position={position}>
      <Line points={[[0, 0, -1], [-position[0], -position[1], -1]]} color={area.color} transparent opacity={0.22} lineWidth={0.5} />
      <mesh
        ref={meshRef}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <sphereGeometry args={[item.kind === "artifact" ? 5.6 : 3.8, 24, 12]} />
        <meshStandardMaterial
          color={item.kind === "artifact" ? statusColor : "#d7ead9"}
          emissive={statusColor}
          emissiveIntensity={selected ? 0.78 : 0.28}
          roughness={0.5}
        />
      </mesh>
      {showLabel || selected ? (
        <Html center position={[0, item.kind === "artifact" ? -13 : -10, 10]} transform={false}>
          <button className={`satellite-label ${selected ? "is-selected" : ""}`} type="button" onClick={onSelect}>
            {item.kind === "artifact" ? item.payload.title : item.payload.type}
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function ResonanceLinks() {
  const workAreas = useAtlasStore((state) => state.workAreas);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const tagLinks = useMemo(() => buildTagResonanceLinks(atlasRoot, selectedNodeId), [atlasRoot, selectedNodeId]);

  return (
    <group>
      {resonanceLinks.map((link) => {
        const source = workAreas.find((area) => area.id === link.sourceId);
        const target = workAreas.find((area) => area.id === link.targetId);
        if (!source || !target) return null;

        const [sx, sy, sz] = source.position;
        const [tx, ty, tz] = target.position;
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;
        const dx = tx - sx;
        const dy = ty - sy;
        const length = Math.max(Math.hypot(dx, dy), 1);
        const bend = 22 + link.strength * 28;
        const ctrl: [number, number, number] = [midX - (dy / length) * bend, midY + (dx / length) * bend, 3];
        const points: [number, number, number][] = [
          [sx, sy, sz - 4],
          ctrl,
          [tx, ty, tz - 4],
        ];

        return (
          <group key={link.id}>
            <Line points={points} color={link.color} transparent opacity={0.62} lineWidth={1.5} />
            <Html center position={[ctrl[0], ctrl[1], 22]} transform={false}>
              <div className="resonance-label">{link.label}</div>
            </Html>
          </group>
        );
      })}
      {tagLinks.map((link) => {
        const midX = (link.source[0] + link.target[0]) / 2;
        const midY = (link.source[1] + link.target[1]) / 2;
        const dx = link.target[0] - link.source[0];
        const dy = link.target[1] - link.source[1];
        const length = Math.max(Math.hypot(dx, dy), 1);
        const bend = 12;
        const ctrl: [number, number, number] = [midX - (dy / length) * bend, midY + (dx / length) * bend, 2];
        const points: [number, number, number][] = [
          [link.source[0], link.source[1], link.source[2] - 6],
          ctrl,
          [link.target[0], link.target[1], link.target[2] - 6],
        ];
        return (
          <Line key={link.id} points={points} color="#8df5cf" transparent opacity={0.18} lineWidth={0.7} />
        );
      })}
    </group>
  );
}

function buildTagResonanceLinks(root: AtlasNode, selectedNodeId: string) {
  const tagged: Array<{ id: string; tags: string[]; position: [number, number, number] }> = [];

  const walk = (node: AtlasNode, path: AtlasNode[]) => {
    const nextPath = [...path, node];
    if (node.id !== root.id && node.tags.length) {
      tagged.push({ id: node.id, tags: node.tags, position: getNodeWorldPosition(nextPath) });
    }
    node.children.forEach((child) => walk(child, nextPath));
  };

  root.children.forEach((child) => walk(child, [root]));

  const selected = tagged.find((node) => node.id === selectedNodeId);
  if (!selected) return [];

  const links: Array<{ id: string; tag: string; source: [number, number, number]; target: [number, number, number] }> = [];
  for (const target of tagged) {
    if (target.id === selected.id) continue;
    const shared = selected.tags.find((tag) => target.tags.includes(tag));
    if (!shared) continue;
    links.push({
      id: `${selected.id}-${target.id}-${shared}`,
      tag: shared,
      source: selected.position,
      target: target.position,
    });
    if (links.length >= 8) return links;
  }
  return links;
}
