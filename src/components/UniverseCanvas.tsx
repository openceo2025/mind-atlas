import { Html, Line } from "@react-three/drei";
import { Canvas, ThreeEvent, createPortal, useFrame, useThree } from "@react-three/fiber";
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Ray,
  Scene,
  Vector3,
} from "three";
import {
  NOTEBOOK_FIRST_SHELL_RADIUS,
  findNodePath,
  getNodeHitRadius,
  getNodeVisualRadius,
  getManualChildSpreadLimit,
  getPlanarLimitForDepth,
  getNodeWorldPosition,
  getShellRadius,
  useAtlasStore,
} from "../store/atlasStore";
import type { AtlasNode } from "../types";
import { getStatusColor } from "../utils/status";

const FOCUS_DURATION_SECONDS = 1.05;
const CAMERA_FOV = 45;
const INITIAL_CAMERA_OFFSET = 0;
const MIN_CAMERA_OFFSET = -120;
const MAX_CAMERA_OFFSET = 90000;
const VISIBLE_DESCENDANT_DEPTH = 5;
const HOLD_TO_BIRTH_MS = 1520;
const WHITE_HOLE_CANCEL_PX = 12;
const WHITE_HOLE_MAX_ZOOM = 1.9;
const TEAR_SAMPLE_WINDOW_MS = 100;
const TEAR_STAGE_ONE_SCREEN_DELTA = 118;
const TEAR_STAGE_TWO_WORLD_DISTANCE = 84;
const INPUT_EVENT_SPHERE_RADIUS = 90000;
const ZOOM_OUT_PARENT_COOLDOWN_MS = 340;
const ZOOM_OUT_DETECTION_WINDOW_MS = 260;
const ZOOM_OUT_AMOUNT_THRESHOLD = 130;
const ZOOM_OUT_MIN_DURATION_MS = 60;
const FOCUS_WAVE_STEP_MS = 500;
const FOCUS_WAVE_DURATION_MS = 1000;
const DRAG_BOUNDARY_TUBE_RADIUS = 0.55;
const DRAG_BOUNDARY_INNER_TUBE_RADIUS = 0.24;

type Vec3Tuple = [number, number, number];

type BirthEffect = {
  id: string;
  direction: Vec3Tuple;
  startedAt: number;
  mode: "charging" | "burst";
};

type SpaceDragState = {
  pointerId: number;
  startScreen: { x: number; y: number };
  lastScreen: { x: number; y: number };
  startedAt: number;
  direction: Vec3Tuple;
  mode: "hold" | "rotate";
  created: boolean;
  canBirth: boolean;
};

type VisualNodeHandle = {
  setWorldPosition: (worldPosition: Vec3Tuple, parentWorldOverride?: Vec3Tuple) => void;
  getWorldPosition: () => Vec3Tuple;
};

const visualNodeHandles = new Map<string, VisualNodeHandle>();
let hiddenDragEdgeNodeId: string | null = null;
const hiddenDragEdgeListeners = new Set<() => void>();

function setHiddenDragEdgeNodeId(id: string | null) {
  if (hiddenDragEdgeNodeId === id) return;
  hiddenDragEdgeNodeId = id;
  hiddenDragEdgeListeners.forEach((listener) => listener());
}

function useHiddenDragEdgeNodeId() {
  return useSyncExternalStore(
    (listener) => {
      hiddenDragEdgeListeners.add(listener);
      return () => hiddenDragEdgeListeners.delete(listener);
    },
    () => hiddenDragEdgeNodeId,
    () => null,
  );
}

function syncVisualNodePosition(id: string, worldPosition: Vec3Tuple, parentWorldOverride?: Vec3Tuple, attempts = 4) {
  const handle = visualNodeHandles.get(id);
  if (handle) {
    handle.setWorldPosition(worldPosition, parentWorldOverride);
    return;
  }
  if (attempts <= 0) return;
  requestAnimationFrame(() => syncVisualNodePosition(id, worldPosition, parentWorldOverride, attempts - 1));
}

export function UniverseCanvas() {
  const focusParentLayer = useAtlasStore((state) => state.focusParentLayer);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      focusParentLayer();
    };
    const preventBrowserZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", preventBrowserZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", preventBrowserZoom, { capture: true });
    };
  }, [focusParentLayer]);

  return (
    <section className="universe-shell" aria-label="Mind Atlas universe view">
      <Canvas
        camera={{ position: [0, 0, INITIAL_CAMERA_OFFSET], fov: CAMERA_FOV, near: 0.1, far: 120000 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      >
        <ambientLight intensity={0.7} />
        <pointLight position={[120, 160, 110]} intensity={1.35} color="#f3d08a" />
        <pointLight position={[-180, -120, 80]} intensity={0.8} color="#78e6c5" />
        <BackgroundStarLayer />
        <NavigationController />
        <ResonanceLinks />
        <NotebookNodes />
      </Canvas>
    </section>
  );
}

function NavigationController() {
  const focusRequest = useAtlasStore((state) => state.focusRequest);
  const setViewport = useAtlasStore((state) => state.setViewport);
  const addRootNodeAt = useAtlasStore((state) => state.addRootNodeAt);
  const { camera, gl, size } = useThree();
  const perspective = camera as PerspectiveCamera;
  const initialCenteredRef = useRef(false);
  const yawPitchRef = useRef({ yaw: 0, pitch: 0, offset: INITIAL_CAMERA_OFFSET });
  const dragRef = useRef<SpaceDragState | null>(null);
  const wheelZoomOutRef = useRef({ amount: 0, startedAt: 0, lastFiredAt: 0 });
  const wheelZoomInRef = useRef({ amount: 0, startedAt: 0, lastFiredAt: 0 });
  const wheelSuppressUntilRef = useRef(0);
  const transitionRef = useRef<{
    startYaw: number;
    startPitch: number;
    startOffset: number;
    targetYaw: number;
    targetPitch: number;
    targetOffset: number;
    elapsed: number;
    nonce: number;
  } | null>(null);
  const [birthEffect, setBirthEffect] = useState<BirthEffect | null>(null);

  useEffect(() => {
    const element = gl.domElement;
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    element.addEventListener("contextmenu", preventContextMenu);
    return () => element.removeEventListener("contextmenu", preventContextMenu);
  }, [gl.domElement]);

  useEffect(() => {
    if (!focusRequest) return;
    const targetVector = new Vector3(focusRequest.x, focusRequest.y, focusRequest.z);
    const targetDirection = targetVector.lengthSq() > 0.001 ? targetVector.clone().normalize() : new Vector3(0, 0, -1);
    const targetAngles = directionToYawPitch(targetDirection);
    const targetDistance = getCameraDistanceForDiameter(focusRequest.diameter, size.height, perspective.fov);
    const targetOffset = clamp(targetVector.length() - targetDistance, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
    const current = yawPitchRef.current;

    transitionRef.current = {
      startYaw: current.yaw,
      startPitch: current.pitch,
      startOffset: current.offset,
      targetYaw: closestAngle(current.yaw, targetAngles.yaw),
      targetPitch: targetAngles.pitch,
      targetOffset,
      elapsed: 0,
      nonce: focusRequest.nonce,
    };
  }, [focusRequest, perspective.fov, size.height]);

  useEffect(() => {
    if (initialCenteredRef.current) return;
    initialCenteredRef.current = true;

    requestAnimationFrame(() => {
      yawPitchRef.current = { yaw: 0, pitch: 0, offset: INITIAL_CAMERA_OFFSET };
      applyCameraPose(perspective, yawPitchRef.current);
      setViewport({ x: 0, y: 0, zoom: getViewportScale(INITIAL_CAMERA_OFFSET) });
    });
  }, [perspective, setViewport]);

  useFrame((_, delta) => {
    if (birthEffect?.mode === "burst" && performance.now() - birthEffect.startedAt > 820) {
      setBirthEffect(null);
    }

    const drag = dragRef.current;
    if (drag?.mode === "hold" && drag.canBirth && !drag.created) {
      const heldFor = performance.now() - drag.startedAt;
      if (heldFor >= HOLD_TO_BIRTH_MS) {
        drag.created = true;
        addRootNodeAt(drag.direction);
        setBirthEffect({
          id: `burst-${performance.now()}`,
          direction: drag.direction,
          startedAt: performance.now(),
          mode: "burst",
        });
      }
    }

    const transition = transitionRef.current;
    if (!transition) return;

    transition.elapsed += delta;
    const progress = Math.min(1, transition.elapsed / FOCUS_DURATION_SECONDS);
    const eased = easeInOutQuint(progress);
    const state = yawPitchRef.current;
    state.yaw = lerp(transition.startYaw, transition.targetYaw, eased);
    state.pitch = lerp(transition.startPitch, transition.targetPitch, eased);
    state.offset = lerp(transition.startOffset, transition.targetOffset, eased);
    applyCameraPose(perspective, state);
    setViewport({ x: state.yaw, y: state.pitch, zoom: getViewportScale(state.offset) });

    if (progress >= 1) {
      transitionRef.current = null;
    }
  });

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.stopPropagation();
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    const viewportZoom = getViewportScale(yawPitchRef.current.offset);
    const canBirth = viewportZoom <= WHITE_HOLE_MAX_ZOOM;
    const direction = directionFromRay(event.ray, NOTEBOOK_FIRST_SHELL_RADIUS);

    dragRef.current = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      lastScreen: { x: event.clientX, y: event.clientY },
      startedAt: performance.now(),
      direction,
      mode: "hold",
      created: false,
      canBirth,
    };
    transitionRef.current = null;

    if (canBirth) {
      setBirthEffect({
        id: `charge-${performance.now()}`,
        direction,
        startedAt: performance.now(),
        mode: "charging",
      });
    } else {
      setBirthEffect(null);
    }
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - drag.startScreen.x;
    const dy = event.clientY - drag.startScreen.y;
    const moved = Math.hypot(dx, dy);

    if (drag.mode === "hold" && moved > WHITE_HOLE_CANCEL_PX && !drag.created) {
      drag.mode = "rotate";
      setBirthEffect(null);
    }

    if (drag.mode === "rotate") {
      const deltaX = event.clientX - drag.lastScreen.x;
      const deltaY = event.clientY - drag.lastScreen.y;
      const state = yawPitchRef.current;
      const rotationGain = getRotationGain(state.offset);
      state.yaw -= deltaX * rotationGain;
      state.pitch = clamp(state.pitch + deltaY * rotationGain, -1.22, 1.22);
      transitionRef.current = null;
      applyCameraPose(perspective, state);
      setViewport({ x: state.yaw, y: state.pitch, zoom: getViewportScale(state.offset) });
    }

    drag.lastScreen = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (!drag.created && drag.mode === "hold" && drag.canBirth) {
      setBirthEffect(null);
    }
  };

  const handleWheel = (event: ThreeEvent<WheelEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    const now = performance.now();
    if (now < wheelSuppressUntilRef.current) return;

    const state = yawPitchRef.current;
    state.offset = clamp(state.offset - event.deltaY * 0.35, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
    transitionRef.current = null;
    applyCameraPose(perspective, state);
    setViewport({ x: state.yaw, y: state.pitch, zoom: getViewportScale(state.offset) });

    const zoomOutState = wheelZoomOutRef.current;
    const zoomInState = wheelZoomInRef.current;
    if (event.deltaY <= 0) {
      zoomOutState.amount = 0;
      zoomOutState.startedAt = 0;
    } else {
      zoomInState.amount = 0;
      zoomInState.startedAt = 0;
    }

    if (event.deltaY > 0) {
      if (now - zoomOutState.lastFiredAt < ZOOM_OUT_PARENT_COOLDOWN_MS) return;
      if (!zoomOutState.startedAt || now - zoomOutState.startedAt > ZOOM_OUT_DETECTION_WINDOW_MS) {
        zoomOutState.amount = 0;
        zoomOutState.startedAt = now;
      }
      zoomOutState.amount += Math.abs(event.deltaY);
      if (zoomOutState.amount >= ZOOM_OUT_AMOUNT_THRESHOLD && now - zoomOutState.startedAt >= ZOOM_OUT_MIN_DURATION_MS) {
        zoomOutState.amount = 0;
        zoomOutState.startedAt = 0;
        zoomOutState.lastFiredAt = now;
        wheelSuppressUntilRef.current = now + 900;
        useAtlasStore.getState().focusParentLayer();
      }
      return;
    }

    if (event.deltaY < 0) {
      const atlasState = useAtlasStore.getState();
      const selectedPath = findNodePath(atlasState.atlasRoot, atlasState.selectedNodeId);
      const selectedNode = selectedPath?.at(-1);
      if (selectedNode?.children.length !== 1) {
        zoomInState.amount = 0;
        zoomInState.startedAt = 0;
        return;
      }

      if (now - zoomInState.lastFiredAt < ZOOM_OUT_PARENT_COOLDOWN_MS) return;
      if (!zoomInState.startedAt || now - zoomInState.startedAt > ZOOM_OUT_DETECTION_WINDOW_MS) {
        zoomInState.amount = 0;
        zoomInState.startedAt = now;
      }
      zoomInState.amount += Math.abs(event.deltaY);
      if (zoomInState.amount >= ZOOM_OUT_AMOUNT_THRESHOLD && now - zoomInState.startedAt >= ZOOM_OUT_MIN_DURATION_MS) {
        zoomInState.amount = 0;
        zoomInState.startedAt = 0;
        zoomInState.lastFiredAt = now;
        wheelSuppressUntilRef.current = now + 900;
        atlasState.focusNode(selectedNode.children[0].id);
      }
    }
  };

  return (
    <>
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <sphereGeometry args={[INPUT_EVENT_SPHERE_RADIUS, 64, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={BackSide} />
      </mesh>
      {birthEffect ? <WhiteHoleEffect key={birthEffect.id} effect={birthEffect} /> : null}
    </>
  );
}

function NotebookNodes() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusNonce = useAtlasStore((state) => state.focusRequest?.nonce ?? 0);
  const [focusWaveStartedAt, setFocusWaveStartedAt] = useState(() => performance.now());
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];
  const rootIsSelected = selectedNodeId === atlasRoot.id;
  const effectiveSelectedNodeId = rootIsSelected ? atlasRoot.id : selectedNodeId;
  const highlightSelectedNodeId = rootIsSelected ? "" : selectedNodeId;
  const selectedParentId = selectedPath.length > 1 ? selectedPath[selectedPath.length - 2].id : null;
  const focusBaseIndex = selectedPath.length > 2 ? selectedPath.length - 2 : 0;
  const focusParent = selectedPath[focusBaseIndex];

  useEffect(() => {
    setFocusWaveStartedAt(performance.now());
  }, [focusNonce, selectedNodeId]);

  if (!atlasRoot.children.length) {
    return <EmptyAtlasPulse />;
  }

  if (focusBaseIndex > 0) {
    const parentPath = selectedPath.slice(0, focusBaseIndex + 1);
    const parentPosition = getNodeWorldPosition(parentPath);
    return (
      <group>
        <HierarchyNode
          node={focusParent}
          path={parentPath}
          worldPosition={parentPosition}
          localPosition={parentPosition}
          depth={Math.max(1, parentPath.length - 1)}
          visibleDepthRemaining={VISIBLE_DESCENDANT_DEPTH + 1}
          visibleDepthIndex={0}
          selectedNodeId={effectiveSelectedNodeId}
          highlightSelectedNodeId={highlightSelectedNodeId}
          selectedParentId={rootIsSelected ? null : selectedParentId}
          focusWaveStartedAt={focusWaveStartedAt}
        />
      </group>
    );
  }

  return (
    <group>
      {atlasRoot.children.map((node) => {
        const path = [atlasRoot, node];
        const position = getNodeWorldPosition(path);
        return (
          <HierarchyNode
            key={node.id}
            node={node}
            path={path}
            worldPosition={position}
            localPosition={position}
            depth={1}
            visibleDepthRemaining={VISIBLE_DESCENDANT_DEPTH}
            visibleDepthIndex={0}
            selectedNodeId={effectiveSelectedNodeId}
            highlightSelectedNodeId={highlightSelectedNodeId}
            selectedParentId={rootIsSelected ? null : selectedParentId}
            focusWaveStartedAt={focusWaveStartedAt}
          />
        );
      })}
    </group>
  );
}

function HierarchyNode({
  node,
  path,
  worldPosition,
  localPosition,
  depth,
  visibleDepthRemaining,
  visibleDepthIndex,
  selectedNodeId,
  highlightSelectedNodeId,
  selectedParentId,
  focusWaveStartedAt,
}: {
  node: AtlasNode;
  path: AtlasNode[];
  worldPosition: [number, number, number];
  localPosition: [number, number, number];
  depth: number;
  visibleDepthRemaining: number;
  visibleDepthIndex: number;
  selectedNodeId: string;
  highlightSelectedNodeId: string;
  selectedParentId: string | null;
  focusWaveStartedAt: number;
}) {
  const selectNode = useAtlasStore((state) => state.selectNode);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const moveNode = useAtlasStore((state) => state.moveNode);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const birthMarks = useAtlasStore((state) => state.birthMarks);
  const zoom = useAtlasStore((state) => state.viewport.zoom);
  const hiddenDragEdgeNodeId = useHiddenDragEdgeNodeId();
  const { camera, scene } = useThree();
  const perspective = camera as PerspectiveCamera;
  const isSelected = highlightSelectedNodeId === node.id;
  const parentId = path.length > 1 ? path[path.length - 2].id : null;
  const selectedIndexInPath = path.findIndex((item) => item.id === selectedNodeId);
  const activeDescendantDistance =
    selectedIndexInPath >= 0 ? path.length - 1 - selectedIndexInPath : null;
  const isDirectParentOfSelected = selectedParentId === node.id;
  const isActiveSibling = selectedParentId !== null && parentId === selectedParentId && !isSelected;
  const isFocusedBranch = activeDescendantDistance !== null || isDirectParentOfSelected;
  const statusColor = getStatusColor(node.status);
  const radius = getNodeVisualRadius(node, depth);
  const hitRadius = getNodeHitRadius(node, depth);
  const visualDepthIndex =
    activeDescendantDistance !== null
      ? activeDescendantDistance
      : isDirectParentOfSelected
        ? 0
        : isActiveSibling
          ? 1
          : visibleDepthIndex;
  const depthFade = getDepthFade(visualDepthIndex);
  const childrenVisible =
    visibleDepthRemaining > 0 &&
    node.children.length > 0 &&
    (isDirectParentOfSelected ||
      (activeDescendantDistance !== null && activeDescendantDistance < VISIBLE_DESCENDANT_DEPTH));
  const labelVisible = isSelected || (depth <= 1 ? zoom > 0.55 : zoom > getLabelZoom(depth));
  const parentEdgeVisible = path.length > 2 && hiddenDragEdgeNodeId !== node.id;
  const focusWaveDepth =
    activeDescendantDistance === 1
      ? activeDescendantDistance
      : null;
  const [dragVisual, setDragVisual] = useState<{ x: number; y: number; z: number; tension: number } | null>(null);
  const [dragBoundary, setDragBoundary] = useState<{
    depth: number;
    parentWorldPosition?: [number, number, number];
    siblingCount?: number;
  } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startScreen: { x: number; y: number };
    lastScreen: { x: number; y: number };
    lastAt: number;
    startWorld: Vec3Tuple;
    currentWorld: Vec3Tuple;
    layerRadius: number;
    stage: "moving" | "armed" | "birthing" | "handoff";
    canCreateChild: boolean;
    samples: Array<{ t: number; x: number; y: number }>;
    freezeWorld?: Vec3Tuple;
    armedPointerWorld?: Vec3Tuple;
    birthingStartedAt?: number;
    birthingPointerWorld?: Vec3Tuple;
    tearVector?: Vec3Tuple;
    handoffChildId?: string;
    handoffLayerRadius?: number;
    handoffChildWorld?: Vec3Tuple;
    hasMoved: boolean;
    torn: boolean;
  } | null>(null);
  const groupRef = useRef<Group>(null);
  const parentWorldRef = useRef<Vec3Tuple>(subtractPosition(worldPosition, localPosition));
  const visualWorldRef = useRef<Vec3Tuple>(worldPosition);
  const applyVisualWorldPositionRef = useRef<(nextWorld: Vec3Tuple, parentWorldOverride?: Vec3Tuple) => void>(() => undefined);
  const birthStartedAt = birthMarks[node.id];

  applyVisualWorldPositionRef.current = (nextWorld, parentWorldOverride) => {
    const parentWorld = parentWorldOverride ?? parentWorldRef.current;
    const nextLocal = subtractPosition(nextWorld, parentWorld);
    groupRef.current?.position.set(nextLocal[0], nextLocal[1], nextLocal[2]);
    visualWorldRef.current = nextWorld;
  };

  const applyVisualWorldPosition = (nextWorld: Vec3Tuple, parentWorldOverride?: Vec3Tuple) => {
    applyVisualWorldPositionRef.current(nextWorld, parentWorldOverride);
  };

  useLayoutEffect(() => {
    const parentWorld = subtractPosition(worldPosition, localPosition);
    parentWorldRef.current = parentWorld;
    if (!dragRef.current) {
      applyVisualWorldPosition(worldPosition, parentWorld);
    }
  }, [localPosition, worldPosition]);

  useEffect(() => {
    const handle: VisualNodeHandle = {
      setWorldPosition: (nextWorld, parentWorldOverride) => {
        applyVisualWorldPositionRef.current(nextWorld, parentWorldOverride);
      },
      getWorldPosition: () => visualWorldRef.current,
    };
    visualNodeHandles.set(node.id, handle);
    return () => {
      if (visualNodeHandles.get(node.id) === handle) {
        visualNodeHandles.delete(node.id);
      }
    };
  }, [node.id]);

  const completeBirthingDrag = (
    drag: NonNullable<typeof dragRef.current>,
    pointerWorld: [number, number, number],
  ) => {
    if (drag.stage !== "birthing") return;
    drag.stage = "handoff";
    drag.torn = true;
    const freezeWorld = drag.freezeWorld ?? drag.startWorld;
    const tearVector = drag.tearVector ?? subtractPosition(pointerWorld, freezeWorld);
    const parentDirection = normalizeVector(freezeWorld);
    const childDirection = childDirectionFromDrag(parentDirection, tearVector, depth + 1, node.children.length);
    const angle = Math.atan2(tearVector[1], tearVector[0]);
    const childId = addChildNode(node.id, "", {
      title: "Untitled moon",
      position: childDirection,
      insertIndex: angleToInsertIndex(angle, node.children.length + 1),
      focus: false,
      persist: false,
    });

    if (childId) {
      const childWorld = clampWorldForDepth(pointerWorld, depth + 1);
      drag.handoffChildId = childId;
      drag.handoffLayerRadius = getShellRadius(depth + 1);
      drag.handoffChildWorld = childWorld;
      setDragBoundary({
        depth: depth + 1,
        parentWorldPosition: drag.currentWorld,
        siblingCount: node.children.length + 1,
      });
      syncVisualNodePosition(childId, childWorld, drag.currentWorld);
      setHiddenDragEdgeNodeId(childId);
    }
    setDragVisual(null);
  };

  useFrame(() => {
    const drag = dragRef.current;
    if (!drag || drag.stage !== "birthing" || !drag.birthingStartedAt) return;
    if (performance.now() - drag.birthingStartedAt < HOLD_TO_BIRTH_MS) return;
    const pointerWorld = drag.birthingPointerWorld ?? addTuple(drag.freezeWorld ?? drag.startWorld, drag.tearVector ?? [0, 0, 0]);
    completeBirthingDrag(drag, pointerWorld);
  });

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      lastScreen: { x: event.clientX, y: event.clientY },
      lastAt: performance.now(),
      startWorld: worldPosition,
      currentWorld: worldPosition,
      layerRadius: vectorLength(worldPosition),
      stage: "moving",
      canCreateChild: true,
      samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }],
      hasMoved: false,
      torn: false,
    };
    setHiddenDragEdgeNodeId(node.id);
    setDragBoundary({
      depth,
      parentWorldPosition: path.length > 2 ? getNodeWorldPosition(path.slice(0, -1)) : undefined,
      siblingCount: path.length > 2 ? path[path.length - 2].children.length : undefined,
    });
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    if (drag.handoffChildId && drag.handoffLayerRadius) {
      const childWorld = clampWorldForDepth(intersectRaySphere(event.ray, drag.handoffLayerRadius), depth + 1);
      drag.handoffChildWorld = childWorld;
      syncVisualNodePosition(drag.handoffChildId, childWorld, drag.currentWorld);
      drag.lastScreen = { x: event.clientX, y: event.clientY };
      drag.lastAt = performance.now();
      return;
    }

    const pointerWorld = intersectRaySphere(event.ray, drag.layerRadius);
    const now = performance.now();
    const screenDistance = Math.hypot(event.clientX - drag.startScreen.x, event.clientY - drag.startScreen.y);

    if (drag.stage === "armed") {
      const freezeWorld = drag.freezeWorld ?? drag.startWorld;
      const armedPointerWorld = drag.armedPointerWorld ?? pointerWorld;
      const dx = pointerWorld[0] - freezeWorld[0];
      const dy = pointerWorld[1] - freezeWorld[1];
      const dz = pointerWorld[2] - freezeWorld[2];
      const whitePointMove = Math.hypot(
        pointerWorld[0] - armedPointerWorld[0],
        pointerWorld[1] - armedPointerWorld[1],
        pointerWorld[2] - armedPointerWorld[2],
      );
      setDragVisual({
        x: dx,
        y: dy,
        z: dz,
        tension: Math.min(1, whitePointMove / TEAR_STAGE_TWO_WORLD_DISTANCE),
      });

      if (whitePointMove >= TEAR_STAGE_TWO_WORLD_DISTANCE) {
        drag.stage = "birthing";
        drag.birthingStartedAt = now;
        drag.birthingPointerWorld = pointerWorld;
      }
      drag.tearVector = [dx, dy, dz];
      drag.lastScreen = { x: event.clientX, y: event.clientY };
      drag.lastAt = now;
      return;
    }

    if (drag.stage === "birthing") {
      const freezeWorld = drag.freezeWorld ?? drag.startWorld;
      const armedPointerWorld = drag.armedPointerWorld ?? pointerWorld;
      const dx = pointerWorld[0] - freezeWorld[0];
      const dy = pointerWorld[1] - freezeWorld[1];
      const dz = pointerWorld[2] - freezeWorld[2];
      const whitePointMove = Math.hypot(
        pointerWorld[0] - armedPointerWorld[0],
        pointerWorld[1] - armedPointerWorld[1],
        pointerWorld[2] - armedPointerWorld[2],
      );

      if (whitePointMove < TEAR_STAGE_TWO_WORLD_DISTANCE) {
        drag.stage = "armed";
        drag.birthingStartedAt = undefined;
        drag.birthingPointerWorld = undefined;
      }

      setDragVisual({
        x: dx,
        y: dy,
        z: dz,
        tension: Math.min(1, whitePointMove / TEAR_STAGE_TWO_WORLD_DISTANCE),
      });
      drag.tearVector = [dx, dy, dz];
      drag.birthingPointerWorld = pointerWorld;

      if (drag.stage === "birthing" && drag.birthingStartedAt && now - drag.birthingStartedAt >= HOLD_TO_BIRTH_MS) {
        completeBirthingDrag(drag, intersectRaySphere(event.ray, getShellRadius(depth + 1)));
      }

      drag.lastScreen = { x: event.clientX, y: event.clientY };
      drag.lastAt = now;
      return;
    }

    if (screenDistance > 3 && drag.stage === "moving") {
      const clampedPointerWorld = clampWorldForDepth(pointerWorld, depth);
      drag.currentWorld = clampedPointerWorld;
      drag.hasMoved = true;
      applyVisualWorldPosition(clampedPointerWorld);
      if (drag.canCreateChild && movedEnoughInRecentWindow(drag, event.clientX, event.clientY, now)) {
        drag.stage = "armed";
        drag.torn = true;
        drag.freezeWorld = clampedPointerWorld;
        drag.armedPointerWorld = pointerWorld;
        drag.startWorld = clampedPointerWorld;
        drag.samples = [];
        setDragVisual({ x: 0, y: 0, z: 0, tension: 0 });
      }
    }

    drag.lastScreen = { x: event.clientX, y: event.clientY };
    drag.lastAt = now;
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const screenDistance = Math.hypot(event.clientX - drag.startScreen.x, event.clientY - drag.startScreen.y);
    if (!drag.torn && screenDistance <= 3) {
      focusNode(node.id);
    }
    dragRef.current = null;
    if (drag.hasMoved || drag.torn) {
      moveNode(node.id, drag.currentWorld);
    }
    if (drag.handoffChildId && drag.handoffChildWorld) {
      moveNode(drag.handoffChildId, drag.handoffChildWorld);
    }
    setHiddenDragEdgeNodeId(null);
    setDragVisual(null);
    setDragBoundary(null);
  };

  const stretch = dragVisual ? Math.min(0.7, dragVisual.tension * 0.44) : 0;
  const stretchAngle = dragVisual ? Math.atan2(dragVisual.y, dragVisual.x) : 0;

  return (
    <group ref={groupRef}>
      {parentEdgeVisible ? (
        <Line
          points={[[0, 0, -1], [-localPosition[0], -localPosition[1], -localPosition[2] - 1]]}
          color={node.color}
          transparent
          opacity={(isFocusedBranch ? 0.28 : 0.12) * depthFade.opacity}
          lineWidth={0.6}
        />
      ) : null}

      {dragVisual ? (
        <ElasticTether
          vector={[dragVisual.x, dragVisual.y, dragVisual.z]}
          color={node.color}
          radius={radius}
          tension={dragVisual.tension}
          birthingStartedAt={dragRef.current?.stage === "birthing" ? dragRef.current.birthingStartedAt : undefined}
          showTearThreshold={dragRef.current?.stage === "armed" || dragRef.current?.stage === "birthing"}
        />
      ) : null}
      {dragBoundary
        ? createPortal(
        <DragBoundaryGuide
          depth={dragBoundary.depth}
          color={node.color}
          parentWorldPosition={dragBoundary.parentWorldPosition}
          siblingCount={dragBoundary.siblingCount}
        />,
          scene,
        )
        : null}

      <CameraFacingGroup>
        <NodeFocusRing
          radius={radius}
          baseColor={statusColor}
          isSelected={isSelected}
          depthFade={depthFade}
          waveDepth={focusWaveDepth}
          waveStartedAt={focusWaveStartedAt}
        />
        {birthStartedAt ? <BirthRing startedAt={birthStartedAt} radius={radius} color={node.color} /> : null}
      </CameraFacingGroup>

      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(event) => {
          event.stopPropagation();
          focusNode(node.id);
        }}
      >
        <sphereGeometry args={[hitRadius, 20, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group rotation={[0, 0, stretchAngle]}>
        <mesh
          scale={[1 + stretch, 1 - stretch * 0.34, 1 + stretch * 0.08]}
        >
          <sphereGeometry args={[radius, depth <= 1 ? 38 : 28, depth <= 1 ? 20 : 16]} />
          <PlanetMaterial node={node} depthFade={depthFade} />
        </mesh>
      </group>
      <mesh position={[-radius * 0.28, radius * 0.32, radius * 0.72]}>
        <sphereGeometry args={[Math.max(1.8, radius * 0.18), 16, 10]} />
        <meshBasicMaterial color="#fff7cf" transparent opacity={0.7 * depthFade.opacity} />
      </mesh>

      {childrenVisible
        ? node.children.map((child) => {
            const childPath = [...path, child];
            const childWorldPosition = getNodeWorldPosition(childPath);
            const position = subtractPosition(childWorldPosition, worldPosition);
            return (
              <HierarchyNode
                key={child.id}
                node={child}
                path={childPath}
                worldPosition={childWorldPosition}
                localPosition={position}
                depth={depth + 1}
                visibleDepthRemaining={visibleDepthRemaining - 1}
                visibleDepthIndex={visibleDepthIndex + 1}
                selectedNodeId={selectedNodeId}
                highlightSelectedNodeId={highlightSelectedNodeId}
                selectedParentId={selectedParentId}
                focusWaveStartedAt={focusWaveStartedAt}
              />
            );
          })
        : null}

      {labelVisible ? (
        <Html center position={[0, -radius - 14, 16]} transform={false} zIndexRange={[2, 0]}>
          <button
            className={`space-label ${isSelected ? "is-selected" : ""}`}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              selectNode(node.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              focusNode(node.id);
            }}
          >
            <span className="space-label-title">{node.title}</span>
            {node.tags[0] ? <span className="space-label-status">#{node.tags[0]}</span> : null}
          </button>
        </Html>
      ) : null}
    </group>
  );
}

function PlanetMaterial({
  node,
  depthFade,
}: {
  node: AtlasNode;
  depthFade: ReturnType<typeof getDepthFade>;
}) {
  const texture = useMemo(() => createPlanetTexture(node.color, node.texture, node.id), [node.color, node.id, node.texture]);
  const materialColor = useMemo(() => new Color(node.color).multiplyScalar(depthFade.brightness), [depthFade.brightness, node.color]);
  const emissive = useMemo(() => new Color(node.color), [node.color]);

  return (
    <meshStandardMaterial
      color={materialColor}
      map={texture}
      emissive={emissive}
      emissiveIntensity={0.12 * depthFade.brightness}
      roughness={0.66}
      metalness={0.04}
    />
  );
}

function NodeFocusRing({
  radius,
  baseColor,
  isSelected,
  depthFade,
  waveDepth,
  waveStartedAt,
}: {
  radius: number;
  baseColor: string;
  isSelected: boolean;
  depthFade: ReturnType<typeof getDepthFade>;
  waveDepth: number | null;
  waveStartedAt: number;
}) {
  const [waveGlow, setWaveGlow] = useState(0);

  useFrame(() => {
    if (!waveDepth) {
      setWaveGlow((current) => (current > 0 ? 0 : current));
      return;
    }

    const age = performance.now() - waveStartedAt - waveDepth * FOCUS_WAVE_STEP_MS;
    const nextGlow =
      age >= 0 && age <= FOCUS_WAVE_DURATION_MS
        ? Math.sin((age / FOCUS_WAVE_DURATION_MS) * Math.PI)
        : 0;
    setWaveGlow((current) => (Math.abs(current - nextGlow) > 0.025 ? nextGlow : current));
  });

  const highlightOpacity = (isSelected ? 0.46 : waveGlow * 0.42) * depthFade.opacity;
  const highlightRadius = radius * (isSelected ? 1.58 : 1.48 + waveGlow * 0.08);

  return (
    <>
      <mesh>
        <torusGeometry args={[radius * 1.34, Math.max(0.18, radius * 0.025), 16, 96]} />
        <meshBasicMaterial color={baseColor} transparent opacity={0.12 * depthFade.opacity} depthWrite={false} />
      </mesh>
      {highlightOpacity > 0.01 ? (
        <mesh>
          <torusGeometry args={[highlightRadius, Math.max(0.22, radius * 0.028), 16, 116]} />
          <meshBasicMaterial color="#f4d96f" transparent opacity={highlightOpacity} depthWrite={false} />
        </mesh>
      ) : null}
    </>
  );
}

function ElasticTether({
  vector,
  color,
  radius,
  tension,
  birthingStartedAt,
  showTearThreshold = false,
}: {
  vector: [number, number, number];
  color: string;
  radius: number;
  tension: number;
  birthingStartedAt?: number;
  showTearThreshold?: boolean;
}) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 2 && !showTearThreshold) return null;
  const neck = Math.max(1.2, radius * (0.22 - tension * 0.11));
  const direction = length > 0.001 ? scaleTuple(vector, 1 / length) : ([1, 0, 0] as [number, number, number]);
  const pointVector = addTuple(vector, scaleTuple(direction, radius));
  const thresholdRadius = TEAR_STAGE_TWO_WORLD_DISTANCE + radius;

  return (
    <group>
      {showTearThreshold ? (
        <CameraFacingGroup>
          <mesh>
            <torusGeometry args={[thresholdRadius, Math.max(0.32, radius * 0.018), 14, 160]} />
            <meshBasicMaterial color={color} transparent opacity={0.34} depthWrite={false} />
          </mesh>
          <mesh>
            <torusGeometry args={[thresholdRadius * 0.985, Math.max(0.18, radius * 0.008), 10, 160]} />
            <meshBasicMaterial color="#fff4c5" transparent opacity={0.18} depthWrite={false} />
          </mesh>
        </CameraFacingGroup>
      ) : null}
      <Line
        points={[
          [0, 0, 5],
          [pointVector[0], pointVector[1], pointVector[2] + 5],
        ]}
        color={color}
        transparent
        opacity={0.5 + tension * 0.32}
        lineWidth={Math.max(1, neck)}
      />
      <mesh position={[pointVector[0], pointVector[1], pointVector[2] + 5]}>
        <sphereGeometry args={[Math.max(1.4, radius * (0.18 - tension * 0.08)), 14, 10]} />
        <meshBasicMaterial color="#fff2b9" transparent opacity={0.62 + tension * 0.28} />
      </mesh>
      {birthingStartedAt ? (
        <WhiteHoleChargeMarker startedAt={birthingStartedAt} position={[pointVector[0], pointVector[1], pointVector[2] + 5]} />
      ) : null}
    </group>
  );
}

function WhiteHoleChargeMarker({
  startedAt,
  position,
}: {
  startedAt: number;
  position: [number, number, number];
}) {
  const groupRef = useRef<Group>(null);
  const [age, setAge] = useState(0);

  useFrame(() => {
    const nextAge = performance.now() - startedAt;
    setAge(nextAge);
    if (!groupRef.current) return;
    const charge = Math.min(1, nextAge / HOLD_TO_BIRTH_MS);
    groupRef.current.scale.setScalar((0.36 + charge * 1.08) * (1 + Math.sin(nextAge * 0.018) * 0.035));
  });

  const charge = Math.min(1, age / HOLD_TO_BIRTH_MS);

  return (
    <group ref={groupRef} position={position}>
      <CameraFacingGroup>
        <mesh>
          <sphereGeometry args={[5 + charge * 9, 32, 18]} />
          <meshBasicMaterial color="#fffdf2" transparent opacity={0.52 + charge * 0.22} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[13 + charge * 24, 1.4 + charge * 1.8, 18, 112]} />
          <meshBasicMaterial color="#fff2ac" transparent opacity={0.72} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[(13 + charge * 24) * 1.5, 0.7 + charge, 18, 112]} />
          <meshBasicMaterial color="#8df5cf" transparent opacity={0.34 + charge * 0.18} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </CameraFacingGroup>
    </group>
  );
}

function DragBoundaryGuide({
  depth,
  color,
  parentWorldPosition,
  siblingCount = 1,
}: {
  depth: number;
  color: string;
  parentWorldPosition?: [number, number, number];
  siblingCount?: number;
}) {
  const shellRadius = getShellRadius(depth);
  if (depth > 1 && parentWorldPosition) {
    return (
      <ChildDragBoundaryGuide
        depth={depth}
        siblingCount={siblingCount}
        color={color}
        shellRadius={shellRadius}
        parentWorldPosition={parentWorldPosition}
      />
    );
  }

  const planarLimit = getPlanarLimitForDepth(depth);
  const ringRadius = shellRadius * planarLimit;
  const z = -Math.sqrt(Math.max(0.0001, 1 - planarLimit * planarLimit)) * shellRadius;

  return (
    <group position={[0, 0, z]}>
      <mesh>
        <torusGeometry args={[ringRadius, DRAG_BOUNDARY_TUBE_RADIUS, 14, 192]} />
        <meshBasicMaterial color={color} transparent opacity={0.34} depthWrite={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[ringRadius * 0.985, DRAG_BOUNDARY_INNER_TUBE_RADIUS, 10, 192]} />
        <meshBasicMaterial color="#fff4c5" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ChildDragBoundaryGuide({
  depth,
  siblingCount,
  color,
  shellRadius,
  parentWorldPosition,
}: {
  depth: number;
  siblingCount: number;
  color: string;
  shellRadius: number;
  parentWorldPosition: [number, number, number];
}) {
  const parentDirection = normalizeVector(parentWorldPosition);
  const spreadLimit = getManualChildSpreadLimit(depth, siblingCount);
  const centerWorld = scaleTuple(parentDirection, shellRadius * Math.cos(spreadLimit));
  const ringRadius = shellRadius * Math.sin(spreadLimit);
  const groupRef = useRef<Group>(null);
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...parentDirection).normalize());
  }, [parentDirection]);

  return (
    <group ref={groupRef} position={centerWorld}>
      <mesh>
        <torusGeometry args={[ringRadius, DRAG_BOUNDARY_TUBE_RADIUS, 14, 160]} />
        <meshBasicMaterial color={color} transparent opacity={0.34} depthWrite={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[ringRadius * 0.985, DRAG_BOUNDARY_INNER_TUBE_RADIUS, 10, 160]} />
        <meshBasicMaterial color="#fff4c5" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

function WhiteHoleEffect({ effect }: { effect: BirthEffect }) {
  const groupRef = useRef<Group>(null);
  const [age, setAge] = useState(0);
  const position = scaleTuple(effect.direction, NOTEBOOK_FIRST_SHELL_RADIUS);

  useFrame(() => {
    const nextAge = performance.now() - effect.startedAt;
    setAge(nextAge);
    if (!groupRef.current) return;
    const charge = effect.mode === "charging" ? Math.min(1, nextAge / HOLD_TO_BIRTH_MS) : 1;
    const breathe = 1 + Math.sin(nextAge * 0.018) * 0.035;
    groupRef.current.scale.setScalar((0.35 + charge * 1.1) * breathe);
  });

  const charge = effect.mode === "charging" ? Math.min(1, age / HOLD_TO_BIRTH_MS) : 1;
  const burstAge = effect.mode === "burst" ? age : 0;
  const opacity = effect.mode === "burst" ? Math.max(0, 1 - burstAge / 680) : 0.34 + charge * 0.48;
  const ringRadius = effect.mode === "burst" ? 22 + burstAge * 0.12 : 12 + charge * 26;

  return (
    <group position={position}>
      <CameraFacingGroup>
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[6 + charge * 10, 32, 18]} />
          <meshBasicMaterial color="#fffdf2" transparent opacity={opacity * 0.72} blending={AdditiveBlending} />
        </mesh>
        <mesh>
          <torusGeometry args={[ringRadius, 1.6 + charge * 1.8, 18, 112]} />
          <meshBasicMaterial color="#fff2ac" transparent opacity={opacity} blending={AdditiveBlending} />
        </mesh>
        <mesh>
          <torusGeometry args={[ringRadius * 1.54, 0.8 + charge, 18, 112]} />
          <meshBasicMaterial color="#8df5cf" transparent opacity={opacity * 0.42} blending={AdditiveBlending} />
        </mesh>
      </group>
      </CameraFacingGroup>
    </group>
  );
}

function BirthRing({ startedAt, radius, color }: { startedAt: number; radius: number; color: string }) {
  const [age, setAge] = useState(0);

  useFrame(() => {
    setAge(performance.now() - startedAt);
  });

  if (age > 1850) return null;

  const progress = Math.min(1, age / 1850);
  return (
    <mesh>
      <torusGeometry args={[radius * (1.18 + progress * 1.35), Math.max(0.12, radius * 0.03 * (1 - progress)), 16, 104]} />
      <meshBasicMaterial color={color} transparent opacity={Math.max(0, 0.5 * (1 - progress))} blending={AdditiveBlending} />
    </mesh>
  );
}

function EmptyAtlasPulse() {
  const meshRef = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 1.7) * 0.04);
  });

  return (
    <group position={[0, 0, -NOTEBOOK_FIRST_SHELL_RADIUS]}>
      <CameraFacingGroup>
        <mesh ref={meshRef}>
          <torusGeometry args={[42, 0.7, 16, 120]} />
          <meshBasicMaterial color="#fff4c5" transparent opacity={0.18} />
        </mesh>
        <mesh>
          <sphereGeometry args={[3.4, 18, 10]} />
          <meshBasicMaterial color="#fffdf2" transparent opacity={0.42} blending={AdditiveBlending} />
        </mesh>
      </CameraFacingGroup>
    </group>
  );
}

function ResonanceLinks() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const tagLinks = useMemo(() => buildTagResonanceLinks(atlasRoot, selectedNodeId), [atlasRoot, selectedNodeId]);

  return (
    <group>
      {tagLinks.map((link) => {
        const midX = (link.source[0] + link.target[0]) / 2;
        const midY = (link.source[1] + link.target[1]) / 2;
        const midZ = (link.source[2] + link.target[2]) / 2;
        const dx = link.target[0] - link.source[0];
        const dy = link.target[1] - link.source[1];
        const length = Math.max(Math.hypot(dx, dy), 1);
        const bend = 26;
        const ctrl: [number, number, number] = [midX - (dy / length) * bend, midY + (dx / length) * bend, midZ];
        return (
          <Line
            key={link.id}
            points={[link.source, ctrl, link.target]}
            color="#8df5cf"
            transparent
            opacity={0.14}
            lineWidth={0.8}
          />
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

  const links: Array<{ id: string; source: [number, number, number]; target: [number, number, number] }> = [];
  for (const target of tagged) {
    if (target.id === selected.id) continue;
    const shared = selected.tags.find((tag) => target.tags.includes(tag));
    if (!shared) continue;
    links.push({ id: `${selected.id}-${target.id}-${shared}`, source: selected.position, target: target.position });
    if (links.length >= 10) return links;
  }
  return links;
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
      { count: 2200, opacity: 0.3, size: 0.95, parallax: 0.012, z: -5, color: "#9fb2a8" },
      { count: 1420, opacity: 0.4, size: 1.2, parallax: 0.024, z: -4, color: "#bbcbbf" },
      { count: 860, opacity: 0.5, size: 1.48, parallax: 0.04, z: -3, color: "#d4dfd6" },
      { count: 460, opacity: 0.62, size: 1.78, parallax: 0.06, z: -2, color: "#eef5e8" },
      { count: 180, opacity: 0.76, size: 2.14, parallax: 0.086, z: -1, color: "#fff0b6" },
    ];

    return configs.map((config) => {
      const values = new Float32Array(config.count * 3);
      for (let index = 0; index < config.count; index += 1) {
        values[index * 3] = -8200 + rand() * 16400;
        values[index * 3 + 1] = -5200 + rand() * 10400;
        values[index * 3 + 2] = config.z + rand() * 0.4;
      }
      return { ...config, positions: values };
    });
  }, []);

  const refs = useRef<Array<Group | null>>([]);

  useFrame(({ camera }) => {
    const direction = new Vector3();
    camera.getWorldDirection(direction);
    const yaw = Math.atan2(direction.x, -direction.z);
    const pitch = Math.asin(clamp(direction.y, -1, 1));
    layers.forEach((layer, index) => {
      const group = refs.current[index];
      if (!group) return;
      const motion = 2200 * layer.parallax;
      group.position.x = -yaw * motion;
      group.position.y = -pitch * motion;
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

function CameraFacingGroup({ children }: { children: ReactNode }) {
  const groupRef = useRef<Group>(null);

  useFrame(({ camera }) => {
    if (!groupRef.current) return;
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  return <group ref={groupRef}>{children}</group>;
}

function createPlanetTexture(color: string, texture: AtlasNode["texture"], seedText: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (!context) return null;

  let seed = 1;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 33 + seedText.charCodeAt(index)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967295;
  };

  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.28;

  if (texture === "bands") {
    for (let y = 0; y < canvas.height; y += 7) {
      context.fillStyle = rand() > 0.48 ? "#fff4bf" : "#0b1813";
      context.fillRect(0, y + rand() * 5, canvas.width, 1.4 + rand() * 5.2);
    }
  } else if (texture === "mist") {
    for (let index = 0; index < 32; index += 1) {
      const gradient = context.createRadialGradient(
        rand() * canvas.width,
        rand() * canvas.height,
        0,
        rand() * canvas.width,
        rand() * canvas.height,
        10 + rand() * 34,
      );
      gradient.addColorStop(0, rand() > 0.5 ? "rgba(255,255,255,0.7)" : "rgba(11,24,19,0.55)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  } else if (texture === "cell") {
    for (let index = 0; index < 54; index += 1) {
      const x = rand() * canvas.width;
      const y = rand() * canvas.height;
      context.strokeStyle = rand() > 0.5 ? "rgba(255,244,191,0.62)" : "rgba(7,17,14,0.42)";
      context.lineWidth = 1 + rand() * 2;
      context.beginPath();
      context.arc(x, y, 4 + rand() * 12, 0, Math.PI * 2);
      context.stroke();
    }
  } else {
    const count = texture === "freckles" ? 118 : texture === "craters" ? 42 : 74;
    for (let index = 0; index < count; index += 1) {
      const size = texture === "craters" ? 4 + rand() * 10 : 1.5 + rand() * 4;
      context.beginPath();
      context.arc(rand() * canvas.width, rand() * canvas.height, size, 0, Math.PI * 2);
      context.fillStyle = rand() > 0.45 ? "#fff4bf" : "#07110e";
      context.fill();
      if (texture === "craters") {
        context.strokeStyle = "rgba(255,255,255,0.34)";
        context.lineWidth = 1;
        context.stroke();
      }
    }
  }

  context.globalAlpha = 0.24;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.58, "transparent");
  gradient.addColorStop(1, "#000000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const planetTexture = new CanvasTexture(canvas);
  planetTexture.needsUpdate = true;
  return planetTexture;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function easeInOutQuint(value: number) {
  return value < 0.5 ? 16 * value * value * value * value * value : 1 - Math.pow(-2 * value + 2, 5) / 2;
}

function directionToYawPitch(direction: Vector3) {
  const normalized = direction.clone().normalize();
  return {
    yaw: Math.atan2(normalized.x, -normalized.z),
    pitch: Math.asin(clamp(normalized.y, -1, 1)),
  };
}

function applyCameraPose(camera: PerspectiveCamera, state: { yaw: number; pitch: number; offset: number }) {
  const direction = directionFromYawPitch(state.yaw, state.pitch);
  camera.position.copy(direction.clone().multiplyScalar(state.offset));
  camera.lookAt(camera.position.clone().add(direction));
  camera.updateProjectionMatrix();
}

function directionFromYawPitch(yaw: number, pitch: number) {
  const cosPitch = Math.cos(pitch);
  return new Vector3(Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch).normalize();
}

function closestAngle(from: number, to: number) {
  const delta = ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + delta;
}

function getCameraDistanceForDiameter(diameter: number, viewportHeight: number, fov: number) {
  const targetWorldHeight = Math.max(diameter * 4.4, 72);
  const verticalFov = (fov * Math.PI) / 180;
  const distance = targetWorldHeight / (2 * Math.tan(verticalFov / 2));
  return Math.min(620, Math.max(42, distance * Math.max(0.72, 920 / Math.max(viewportHeight, 1))));
}

function getViewportScale(distance: number) {
  return Math.min(32, Math.max(0.3, 1 + distance / 360));
}

function getRotationGain(offset: number) {
  const distance = Math.max(0, offset - MIN_CAMERA_OFFSET);
  return 0.0023 / (1 + distance / 900);
}

function getDepthFade(index: number) {
  const normalized = Math.min(1, Math.max(0, index / VISIBLE_DESCENDANT_DEPTH));
  return {
    opacity: Math.max(0.05, 1 - Math.pow(normalized, 0.72) * 0.95),
    brightness: Math.max(0.045, Math.pow(0.52, index)),
  };
}

function getLabelZoom(depth: number) {
  if (depth <= 2) return 1.15;
  return 4.4 + (depth - 3) * 2.2;
}

function directionFromRay(ray: Ray, radius: number): [number, number, number] {
  return normalizeVector(intersectRaySphere(ray, radius));
}

function intersectRaySphere(ray: Ray, radius: number): [number, number, number] {
  const origin = ray.origin;
  const direction = ray.direction.clone().normalize();
  const a = direction.dot(direction);
  const b = 2 * origin.dot(direction);
  const c = origin.dot(origin) - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant >= 0) {
    const sqrt = Math.sqrt(discriminant);
    const t1 = (-b - sqrt) / (2 * a);
    const t2 = (-b + sqrt) / (2 * a);
    const t = t1 > 0 ? t1 : t2 > 0 ? t2 : radius;
    const point = origin.clone().add(direction.multiplyScalar(t));
    return [point.x, point.y, point.z];
  }

  const fallback = direction.multiplyScalar(radius);
  return [fallback.x, fallback.y, fallback.z];
}

function childDirectionFromDrag(parentDirection: [number, number, number], dragVector: [number, number, number], depth: number, childCount: number) {
  const forward = normalizeVector(parentDirection);
  const reference: [number, number, number] = Math.abs(forward[1]) > 0.86 ? [1, 0, 0] : [0, 1, 0];
  const tangentA = normalizeVector(crossTuple(reference, forward));
  const tangentB = normalizeVector(crossTuple(forward, tangentA));
  const projectedA = dotTuple(dragVector, tangentA);
  const projectedB = dotTuple(dragVector, tangentB);
  const fallbackAngle = (Math.PI * 2 * childCount) / Math.max(childCount + 1, 1) + depth * 0.37;
  const angle = Math.abs(projectedA) + Math.abs(projectedB) > 0.001 ? Math.atan2(projectedB, projectedA) : fallbackAngle;
  const tangent = normalizeVector(addTuple(scaleTuple(tangentA, Math.cos(angle)), scaleTuple(tangentB, Math.sin(angle))));
  const spread = getManualChildSpreadLimit(depth, childCount + 1);
  return normalizeVector(addTuple(scaleTuple(forward, Math.cos(spread)), scaleTuple(tangent, Math.sin(spread))));
}

function movedEnoughInRecentWindow(
  drag: {
    samples: Array<{ t: number; x: number; y: number }>;
  },
  x: number,
  y: number,
  now: number,
) {
  drag.samples.push({ t: now, x, y });
  drag.samples = drag.samples.filter((sample) => now - sample.t <= TEAR_SAMPLE_WINDOW_MS * 2.2);
  const targetTime = now - TEAR_SAMPLE_WINDOW_MS;
  let closest: { t: number; x: number; y: number } | undefined;
  for (const sample of drag.samples) {
    if (sample.t > targetTime) continue;
    if (!closest || Math.abs(sample.t - targetTime) < Math.abs(closest.t - targetTime)) {
      closest = sample;
    }
  }
  if (!closest) return false;
  return Math.hypot(x - closest.x, y - closest.y) >= TEAR_STAGE_ONE_SCREEN_DELTA;
}

function clampWorldForDepth(worldPosition: [number, number, number], depth: number) {
  if (depth > 1) {
    return scaleTuple(normalizeVector(worldPosition), getShellRadius(depth));
  }

  const direction = normalizeVector(worldPosition);
  const planarLimit = getPlanarLimitForDepth(depth);
  const planar = Math.hypot(direction[0], direction[1]);
  const limitedPlanar = Math.min(planar, planarLimit);
  const planarScale = planar > 0 ? limitedPlanar / planar : 0;
  return scaleTuple(
    normalizeVector([
      direction[0] * planarScale,
      direction[1] * planarScale,
      -Math.sqrt(Math.max(0.0001, 1 - limitedPlanar * limitedPlanar)),
    ]),
    getShellRadius(depth),
  );
}

function subtractPosition(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
  const length = vectorLength(vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function vectorLength(vector: [number, number, number]) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function addTuple(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleTuple(vector: [number, number, number], amount: number): [number, number, number] {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dotTuple(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossTuple(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function angleToInsertIndex(angle: number, slots: number) {
  const normalized = (angle + Math.PI * 2.5) % (Math.PI * 2);
  return Math.min(slots - 1, Math.max(0, Math.round((normalized / (Math.PI * 2)) * (slots - 1))));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
