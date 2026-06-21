import { Html, Line } from "@react-three/drei";
import { Canvas, ThreeEvent, createPortal, useFrame, useThree } from "@react-three/fiber";
import { ClipboardCopy, ClipboardPaste, Copy, MoveUp, Scissors, Trash2 } from "lucide-react";
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
  NOTEBOOK_SHELL_GAP,
  NOTEBOOK_NODE_RADIUS,
  findNode,
  findNodePath,
  getNodeHitRadius,
  getNodeVisualRadius,
  getManualChildSpreadLimit,
  getPlanarLimitForDepth,
  getShellRadius,
  getAiContextNodeIds,
  useAtlasStore,
} from "../store/atlasStore";
import { deriveAtlasLayout, deriveAtlasLayoutFrame, type AtlasLayoutFrame, type AtlasLayoutMode, type AtlasLayoutViewport, type Vec3 } from "../layout/atlasLayout";
import { MINIMAP_NAVIGATE_EVENT, MINIMAP_ZOOM_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT, UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "../events";
import { buildContextCopy, CONTEXT_COPY_PRESETS, copyContextMarkdown, type ContextCopyPreset } from "../context/contextCopy";
import { createNodeClipboardText, nodeTreeHasAttachments, parseNodeClipboardText } from "../nodeClipboard";
import { emitOnboardingEvent, getOnboardingCurrentSpaceStep } from "../onboarding/useOnboarding";
import type { AtlasTheme } from "../theme";
import { isPersistedCameraPose, persistUiStatePatch, type PersistedCameraPose } from "../uiPersistence";
import type { AtlasNode, NotificationPulse, NotificationPulseKind } from "../types";
import { getStatusColor } from "../utils/status";

const FOCUS_DURATION_SECONDS = 1.05;
const FOCUS_PITCH_LIMIT = Math.PI / 2 - 0.04;
const FOCUS_TRANSITION_COMPLETE_EVENT = "mind-atlas-focus-transition-complete";
const keyboardLastChildByParentId = new Map<string, string>();
const CAMERA_FOV = 45;
const INITIAL_CAMERA_OFFSET = 0;
const MIN_CAMERA_OFFSET = -120;
const MAX_CAMERA_OFFSET = 90000;
const FOCUSED_NODE_CAMERA_DISTANCE = 300;
const LAYOUT_MOTION_DURATION_SECONDS = 1.18;
const LOW_QUALITY_MOTION_DURATION_SECONDS = 0.42;
const LAYOUT_MOTION_STAGGER_SECONDS = 0.036;
const LAYOUT_MOTION_MAX_STAGGER_SECONDS = 0.24;
const LAYOUT_VISIBILITY_HOLD_MS = 1700;
const LAYOUT_BACKSTAGE_Z_OFFSET = -430;
const GENERATED_LAYOUT_MAX_CAMERA_DISTANCE = 1800;
const GENERATED_LAYOUT_MOBILE_MAX_CAMERA_DISTANCE = 6400;
const GENERATED_LAYOUT_MOBILE_FIT_PADDING = 1.55;
const GENERATED_LAYOUT_MOBILE_LANDSCAPE_FIT_PADDING = 1.38;
const MOBILE_PORTRAIT_CAMERA_DISTANCE_MULTIPLIER = 3;
const VISIBLE_DESCENDANT_DEPTH = 5;
const GENERATED_LAYOUT_VISIBLE_DESCENDANT_DEPTH = VISIBLE_DESCENDANT_DEPTH;
const HOLD_TO_BIRTH_MS = 1520;
const WHITE_HOLE_CANCEL_PX = 12;
const ROOT_BIRTH_FOCUS_MIDPOINT = 0.5;
const ROOT_BIRTH_MAX_ZOOM_IN_OFFSET = NOTEBOOK_NODE_RADIUS * 2;
const ROOT_BIRTH_BLOCKED_HINT_MS = 2000;
const BIRTH_EFFECT_VISUAL_SCALE = 0.8;
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
const NOTIFICATION_PULSE_DURATION_MS = 8200;
const MAX_ANIMATED_NOTIFICATION_PULSES = 5;
const NODE_VISIBILITY_CHECK_MS = 250;
const NODE_SCREEN_MARGIN_NDC = 1.18;
const CAMERA_CULL_CHECK_MS = 120;
const CAMERA_CULL_HOLD_MS = 900;
const CAMERA_CULL_MARGIN_NDC = 1.72;
const CAMERA_CULL_MOBILE_MARGIN_NDC = 2.24;
const VR_TILT_DEAD_ZONE_DEGREES = 7.2;
const VR_TILT_MAX_DEGREES = 22;
const VR_TILT_PAN_X_PIXELS_PER_SECOND = 220;
const VR_TILT_PAN_Y_PIXELS_PER_SECOND = 170;
const VR_PAN_EVENT_INTERVAL_MS = 1200;
const DESKTOP_CANVAS_DPR: [number, number] = [1, 1.75];
const MOBILE_CANVAS_DPR: [number, number] = [1, 1.15];
const LOW_QUALITY_CANVAS_DPR: [number, number] = [0.75, 1];
const MOBILE_LANDSCAPE_FOCUS_DISTANCE_MULTIPLIER = 0.29;
const UNIVERSE_PAN_DELTA_EVENT = "mindatlas:universe-pan-delta";
type RenderQuality = "high" | "low";
const NOTIFICATION_SNOOZE_OPTIONS = [
  { label: "2時間後", delayMs: 2 * 60 * 60 * 1000 },
  { label: "半日後", delayMs: 12 * 60 * 60 * 1000 },
  { label: "1日後", delayMs: 24 * 60 * 60 * 1000 },
  { label: "1週間後", delayMs: 7 * 24 * 60 * 60 * 1000 },
] as const;

type Vec3Tuple = [number, number, number];
type NotificationSnoozePromptState = ReturnType<typeof useAtlasStore.getState>["notificationSnoozePrompt"];
type NotificationKindRecord = Record<string, { nodeId: string; kind: NotificationPulseKind; lastPulseAt?: number }>;

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
  blockedBirthHintEmitted: boolean;
};

type UniversePanDeltaDetail = {
  deltaX: number;
  deltaY: number;
};

type VisualNodeHandle = {
  setWorldPosition: (worldPosition: Vec3Tuple, parentWorldOverride?: Vec3Tuple) => void;
  getWorldPosition: () => Vec3Tuple;
};

type NodeRenderMeta = {
  node: AtlasNode;
  pathIds: string[];
};

type NodeContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

type FocusTransitionCompleteDetail = {
  nodeId: string;
  nonce: number;
};

type NodeVisibilityState = {
  lastCheckedAt: number;
  allOffscreen: boolean | null;
};

type VrOrientationSample = {
  beta: number;
  gamma: number;
  screenAngle: number;
};

type UniverseThemeColors = {
  background: string;
  edge: string;
  ring: string;
  ringHighlight: string;
  secondaryRing: string;
  specular: string;
  birthCore: string;
  birthRing: string;
  birthAccent: string;
  boundaryInner: string;
};

const UNIVERSE_THEME_COLORS: Record<AtlasTheme, UniverseThemeColors> = {
  dark: {
    background: "#050706",
    edge: "",
    ring: "",
    ringHighlight: "#f4d96f",
    secondaryRing: "#fff4c5",
    specular: "#fff7cf",
    birthCore: "#fffdf2",
    birthRing: "#fff2ac",
    birthAccent: "#8df5cf",
    boundaryInner: "#fff4c5",
  },
  light: {
    background: "#f7fbff",
    edge: "#1e6fcb",
    ring: "#2f7ed8",
    ringHighlight: "#0b63ce",
    secondaryRing: "#72a9e7",
    specular: "#4a96df",
    birthCore: "#eaf5ff",
    birthRing: "#1f73d1",
    birthAccent: "#24a6d8",
    boundaryInner: "#76afea",
  },
};

function getUniverseThemeColors(theme: AtlasTheme) {
  return UNIVERSE_THEME_COLORS[theme];
}

const visualNodeHandles = new Map<string, VisualNodeHandle>();
let hiddenDragEdgeNodeId: string | null = null;
const hiddenDragEdgeListeners = new Set<() => void>();
type MobileRaycastMode = { kind: "idle" } | { kind: "space-drag" } | { kind: "node-drag"; nodeId: string };
let mobileRaycastMode: MobileRaycastMode = { kind: "idle" };
let mobilePerformanceModeSnapshot = false;

function setHiddenDragEdgeNodeId(id: string | null) {
  if (hiddenDragEdgeNodeId === id) return;
  hiddenDragEdgeNodeId = id;
  hiddenDragEdgeListeners.forEach((listener) => listener());
}

function setMobileRaycastMode(mode: MobileRaycastMode) {
  mobileRaycastMode = mode;
}

function createConditionalMeshRaycast(shouldSkip: () => boolean): Mesh["raycast"] {
  return function conditionalMeshRaycast(this: Mesh, raycaster, intersects) {
    if (shouldSkip()) return;
    Mesh.prototype.raycast.call(this, raycaster, intersects);
  };
}

function shouldSkipSpaceRaycast() {
  return mobilePerformanceModeSnapshot && mobileRaycastMode.kind === "node-drag";
}

function shouldSkipNodeRaycast(nodeId: string) {
  if (!mobilePerformanceModeSnapshot) return false;
  if (mobileRaycastMode.kind === "space-drag") return true;
  if (mobileRaycastMode.kind === "node-drag") return mobileRaycastMode.nodeId !== nodeId;
  return false;
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

function useMobilePerformanceMode() {
  const mobilePerformanceMode = useSyncExternalStore(subscribeMobilePerformanceMode, isMobilePerformanceDevice, () => false);
  mobilePerformanceModeSnapshot = mobilePerformanceMode;
  return mobilePerformanceMode;
}

function subscribeMobilePerformanceMode(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const coarsePointerQuery = window.matchMedia?.("(pointer: coarse)");
  window.addEventListener("resize", listener);
  window.addEventListener("orientationchange", listener);
  coarsePointerQuery?.addEventListener?.("change", listener);
  return () => {
    window.removeEventListener("resize", listener);
    window.removeEventListener("orientationchange", listener);
    coarsePointerQuery?.removeEventListener?.("change", listener);
  };
}

function isMobilePerformanceDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchDevice = navigator.maxTouchPoints > 0;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  return (coarsePointer || touchDevice || mobileUa) && shortSide <= 620 && longSide <= 980;
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

function CanvasClearColor({ theme }: { theme: AtlasTheme }) {
  const { gl } = useThree();
  const backgroundColor = useMemo(() => new Color(getUniverseThemeColors(theme).background), [theme]);

  useEffect(() => {
    gl.setClearColor(backgroundColor, 1);
  }, [backgroundColor, gl]);

  return null;
}

export function UniverseCanvas({
  theme,
  vrPanEnabled,
  renderQuality,
  layoutMode,
  pageActive,
  initialCameraPose,
}: {
  theme: AtlasTheme;
  vrPanEnabled: boolean;
  renderQuality: RenderQuality;
  layoutMode: AtlasLayoutMode;
  pageActive: boolean;
  initialCameraPose: PersistedCameraPose | null;
}) {
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const mobilePerformanceMode = useMobilePerformanceMode();
  const lowQuality = renderQuality === "low";
  const canvasDpr = lowQuality ? LOW_QUALITY_CANVAS_DPR : mobilePerformanceMode ? MOBILE_CANVAS_DPR : DESKTOP_CANVAS_DPR;
  const canvasGl = useMemo(
    () => ({
      antialias: !lowQuality,
      alpha: false,
      preserveDrawingBuffer: !lowQuality,
      powerPreference: "high-performance" as const,
    }),
    [lowQuality],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isKeyboardComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return;

      if (isSpaceEditorShortcutTarget(event.target)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        resetUniverseHome(() => setNodeContextMenu(null));
        return;
      }

      const spaceEditorNodeId = getSpaceEditorNodeIdFromTarget(event.target);
      const shortcutOriginNodeId = getNodeKeyboardShortcutOriginId(event.target, spaceEditorNodeId);

      if ((event.key === "F2" || event.key === " ") && shortcutOriginNodeId && !isInteractiveShortcutTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        useAtlasStore.getState().requestTitleEdit(shortcutOriginNodeId);
        setNodeContextMenu(null);
        return;
      }

      if (!event.shiftKey && shortcutOriginNodeId && (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const store = useAtlasStore.getState();
        if (event.key === "Enter") {
          store.addSiblingNode(shortcutOriginNodeId);
        } else {
          store.addChildNode(shortcutOriginNodeId);
        }
        setNodeContextMenu(null);
        return;
      }

      if (event.key === "Tab" && shortcutOriginNodeId) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setNodeContextMenu(null);
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && !isEditableShortcutTarget(event.target)) {
        const store = useAtlasStore.getState();
        if (store.selectedNodeId === store.atlasRoot.id) return;
        event.preventDefault();
        event.stopPropagation();
        store.deleteNode(store.selectedNodeId);
        setNodeContextMenu(null);
        return;
      }

      if (!isArrowNavigationKey(event.key) || event.shiftKey) return;
      if (!shortcutOriginNodeId) return;

      const store = useAtlasStore.getState();
      const navigationKey = getLayoutKeyboardNavigationKey(layoutMode, event.key);
      const targetNodeId = getKeyboardNavigationTarget(store.atlasRoot, shortcutOriginNodeId, navigationKey);
      if (!targetNodeId) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      store.focusNode(targetNodeId);
      setNodeContextMenu(null);
    };
    const preventBrowserZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("wheel", preventBrowserZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("wheel", preventBrowserZoom, { capture: true });
    };
  }, [layoutMode]);

  useEffect(() => {
    const closeMenu = () => setNodeContextMenu(null);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
  }, []);

  return (
    <section className="universe-shell" aria-label="Mind Atlas universe view">
      <Canvas
        camera={{ position: [0, 0, INITIAL_CAMERA_OFFSET], fov: CAMERA_FOV, near: 0.1, far: 120000 }}
        dpr={canvasDpr}
        gl={canvasGl}
        frameloop={pageActive ? "always" : "demand"}
      >
        <CanvasClearColor theme={theme} />
        <ambientLight intensity={lowQuality ? (theme === "light" ? 1.25 : 1.05) : theme === "light" ? 1.05 : 0.7} />
        {!lowQuality ? (
          <>
            <pointLight position={[120, 160, 110]} intensity={theme === "light" ? 1.1 : 1.35} color={theme === "light" ? "#d8ecff" : "#f3d08a"} />
            <pointLight position={[-180, -120, 80]} intensity={theme === "light" ? 0.95 : 0.8} color={theme === "light" ? "#8fc5ff" : "#78e6c5"} />
            <BackgroundStarLayer theme={theme} />
          </>
        ) : null}
        <NavigationController theme={theme} vrPanEnabled={vrPanEnabled} renderQuality={renderQuality} layoutMode={layoutMode} pageActive={pageActive} initialCameraPose={initialCameraPose} />
        <NotebookNodes theme={theme} renderQuality={renderQuality} layoutMode={layoutMode} pageActive={pageActive} onOpenNodeContextMenu={setNodeContextMenu} />
        <NotificationPulseLayer theme={theme} renderQuality={renderQuality} layoutMode={layoutMode} pageActive={pageActive} />
      </Canvas>
      <NodeContextMenu menu={nodeContextMenu} onClose={() => setNodeContextMenu(null)} />
    </section>
  );
}

function resetUniverseHome(closeNodeContextMenu: () => void) {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  closeNodeContextMenu();
  const store = useAtlasStore.getState();
  store.clearMultiSelection();
  emitOnboardingEvent("home-logo-clicked");
  store.focusNode(store.atlasRoot.id);
}

function isKeyboardComposing(event: KeyboardEvent) {
  return event.isComposing || event.key === "Process" || event.keyCode === 229;
}

function getSpaceEditorNodeIdFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null;
  const editor = target.closest("textarea.space-title-editor, textarea.space-body-editor");
  return editor instanceof HTMLTextAreaElement ? editor.dataset.nodeId ?? null : null;
}

function isSpaceEditorShortcutTarget(target: EventTarget | null) {
  return Boolean(getSpaceEditorNodeIdFromTarget(target));
}

function getNodeKeyboardShortcutOriginId(target: EventTarget | null, spaceEditorNodeId: string | null) {
  const selectedNodeId = useAtlasStore.getState().selectedNodeId;
  if (spaceEditorNodeId) {
    return spaceEditorNodeId === selectedNodeId ? spaceEditorNodeId : selectedNodeId;
  }
  if (isInteractiveShortcutTarget(target)) return null;
  return selectedNodeId;
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isInteractiveShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a[href]",
        "[contenteditable='true']",
        "[role='button']",
        "[role='tab']",
        "[role='menuitem']",
        "[data-keyboard-shortcuts='off']",
      ].join(", "),
    ),
  );
}

function isArrowNavigationKey(key: string) {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

function getLayoutKeyboardNavigationKey(layoutMode: AtlasLayoutMode, key: string) {
  if (layoutMode !== "tree" && layoutMode !== "mind-map") return key;
  if (key === "ArrowUp") return "ArrowDown";
  if (key === "ArrowDown") return "ArrowUp";
  return key;
}

function getKeyboardNavigationTarget(root: AtlasNode, originNodeId: string, key: string) {
  const path = findNodePath(root, originNodeId);
  if (!path) return null;
  const node = path.at(-1);

  if (key === "ArrowUp") {
    const rememberedChildId = keyboardLastChildByParentId.get(originNodeId);
    if (rememberedChildId && node?.children.some((child) => child.id === rememberedChildId)) return rememberedChildId;
    return node?.children[0]?.id ?? null;
  }

  if (key === "ArrowDown") {
    if (path.length <= 1) return null;
    const parentId = path[path.length - 2].id;
    keyboardLastChildByParentId.set(parentId, originNodeId);
    return parentId;
  }

  if (path.length < 2) return null;
  const siblings = path[path.length - 2].children;
  const currentIndex = siblings.findIndex((sibling) => sibling.id === originNodeId);
  if (currentIndex < 0) return null;

  if (key === "ArrowLeft") {
    return siblings[currentIndex - 1]?.id ?? null;
  }

  if (key === "ArrowRight") {
    return siblings[currentIndex + 1]?.id ?? null;
  }

  return null;
}

function NotificationPulseLayer({
  theme,
  renderQuality,
  layoutMode,
  pageActive,
}: {
  theme: AtlasTheme;
  renderQuality: RenderQuality;
  layoutMode: AtlasLayoutMode;
  pageActive: boolean;
}) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const pulses = useAtlasStore((state) => state.notificationPulses);
  const tickNotificationPulses = useAtlasStore((state) => state.tickNotificationPulses);
  const lastPruneRef = useRef(0);
  const { size } = useThree();
  const layoutViewport = getGeneratedLayoutViewport(layoutMode, size.width, size.height);
  const renderablePulses = useMemo(
    () => pulses.filter((pulse) => pulse.nodeId !== atlasRoot.id && Boolean(findNode(atlasRoot, pulse.nodeId))),
    [atlasRoot, pulses],
  );
  const animatedPulses = useMemo(() => selectAnimatedNotificationPulses(renderablePulses, renderQuality), [renderablePulses, renderQuality]);
  const layoutFrame = useMemo(
    () => deriveAtlasLayoutFrame(atlasRoot, layoutMode, undefined, { focusNodeId: selectedNodeId, viewport: layoutViewport, viewportWidth: size.width, viewportHeight: size.height }),
    [atlasRoot, layoutMode, layoutViewport, selectedNodeId, size.height, size.width],
  );

  useFrame(() => {
    if (!pageActive) return;
    const now = performance.now();
    if (now - lastPruneRef.current < 900) return;
    lastPruneRef.current = now;
    tickNotificationPulses();
  });

  return (
    <>
      {animatedPulses.map((pulse) => {
        const position = layoutFrame.visibleIds.has(pulse.nodeId) ? layoutFrame.positions.get(pulse.nodeId) : undefined;
        if (!position) return null;
        return (
          <GlobalNotificationPulse
            key={pulse.id}
            position={position}
            kind={pulse.kind}
            createdAt={pulse.createdAt}
            theme={theme}
            renderQuality={renderQuality}
            pageActive={pageActive}
          />
        );
      })}
    </>
  );
}

function selectAnimatedNotificationPulses(pulses: NotificationPulse[], renderQuality: RenderQuality) {
  const maxPulses = renderQuality === "low" ? 2 : MAX_ANIMATED_NOTIFICATION_PULSES;
  if (pulses.length <= maxPulses) return pulses;
  return [...pulses]
    .sort((a, b) => notificationPriority(b.kind) - notificationPriority(a.kind) || b.createdAt - a.createdAt)
    .slice(0, maxPulses);
}

function GlobalNotificationPulse({
  position,
  kind,
  createdAt,
  theme,
  renderQuality,
  pageActive,
}: {
  position: [number, number, number];
  kind: NotificationPulseKind;
  createdAt: number;
  theme: AtlasTheme;
  renderQuality: RenderQuality;
  pageActive: boolean;
}) {
  const [age, setAge] = useState(0);
  const color = getNotificationPulseColor(kind, theme);
  const lowQuality = renderQuality === "low";

  useFrame(() => {
    if (!pageActive) return;
    setAge(performance.now() - createdAt);
  });

  if (age > NOTIFICATION_PULSE_DURATION_MS) return null;

  const progress = Math.min(1, age / NOTIFICATION_PULSE_DURATION_MS);
  const wave = Math.sin(progress * Math.PI);
  const motion = springOvershoot(progress);
  const radius = 48 + motion * 1560;
  const opacity = (theme === "light" ? 0.62 : 0.72) * Math.pow(1 - progress, 0.78) * (0.52 + wave * 0.48);

  return (
    <group position={position}>
      <CameraFacingGroup>
        <mesh>
          <torusGeometry args={[radius, 1.4 + wave * 2.4, lowQuality ? 8 : 18, lowQuality ? 48 : 220]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} blending={AdditiveBlending} depthWrite={false} depthTest={false} />
        </mesh>
        {!lowQuality ? (
          <mesh>
            <torusGeometry args={[radius * 0.58, 0.9 + wave * 1.4, 14, 180]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * 0.58} blending={AdditiveBlending} depthWrite={false} depthTest={false} />
          </mesh>
        ) : null}
        <mesh>
          <sphereGeometry args={[4.5 + wave * 3.5, lowQuality ? 8 : 18, lowQuality ? 6 : 10]} />
          <meshBasicMaterial color={color} transparent opacity={0.36 + wave * 0.36} blending={AdditiveBlending} depthWrite={false} depthTest={false} />
        </mesh>
      </CameraFacingGroup>
    </group>
  );
}

function getNotificationPulseColor(kind: NotificationPulseKind, theme: AtlasTheme) {
  if (kind === "error") return "#ff6b6b";
  if (kind === "codex") return theme === "light" ? "#0b63ce" : "#86b7ff";
  if (kind === "openclaw") return theme === "light" ? "#087f5b" : "#62e6b8";
  if (kind === "claude") return theme === "light" ? "#8f4a00" : "#ffcc80";
  if (kind === "cost") return "#f59f48";
  if (kind === "done") return "#8bd8d2";
  return "#f7d765";
}

function buildNotificationPathKinds(
  root: AtlasNode,
  unreadNotifications: NotificationKindRecord,
) {
  const kinds = new Map<string, NotificationPulseKind>();
  for (const unread of Object.values(selectAnimatedNotificationKindSources(unreadNotifications))) {
    const path = findNodePath(root, unread.nodeId);
    if (!path) continue;
    markNotificationPath(kinds, path, unread.kind);
  }
  markStatusNotificationPaths(root, [root], kinds);
  return kinds;
}

function selectAnimatedNotificationKindSources(unreadNotifications: NotificationKindRecord): NotificationKindRecord {
  const entries = Object.entries(unreadNotifications);
  if (entries.length <= MAX_ANIMATED_NOTIFICATION_PULSES) return unreadNotifications;
  return Object.fromEntries(
    entries
      .sort(([, a], [, b]) => notificationPriority(b.kind) - notificationPriority(a.kind) || (b.lastPulseAt ?? 0) - (a.lastPulseAt ?? 0))
      .slice(0, MAX_ANIMATED_NOTIFICATION_PULSES),
  );
}

function markStatusNotificationPaths(
  node: AtlasNode,
  path: AtlasNode[],
  kinds: Map<string, NotificationPulseKind>,
) {
  if (isNotificationErrorSource(node)) {
    markNotificationPath(kinds, path, "error");
  }
  for (const child of node.children) {
    markStatusNotificationPaths(child, [...path, child], kinds);
  }
}

function isNotificationErrorSource(node: AtlasNode) {
  return (
    node.status === "error" &&
    !node.propagatedErrorSourceId &&
    (node.kind === "event" || node.author === "system" || node.tags.includes("error"))
  );
}

function markNotificationPath(kinds: Map<string, NotificationPulseKind>, path: AtlasNode[], kind: NotificationPulseKind) {
  for (const node of path.slice(1)) {
    const current = kinds.get(node.id);
    if (!current || notificationPriority(kind) > notificationPriority(current)) {
      kinds.set(node.id, kind);
    }
  }
}

function notificationPriority(kind: NotificationPulseKind) {
  if (kind === "error") return 5;
  if (kind === "codex" || kind === "openclaw" || kind === "claude") return 4;
  if (kind === "needs_review") return 3;
  if (kind === "cost") return 2;
  return 1;
}

function isAutoFocusSuppressed() {
  const state = useAtlasStore.getState();
  return state.commandInputEditing || state.multiSelectedNodeIds.length > 0;
}

function NavigationController({
  theme,
  vrPanEnabled,
  renderQuality,
  layoutMode,
  pageActive,
  initialCameraPose,
}: {
  theme: AtlasTheme;
  vrPanEnabled: boolean;
  renderQuality: RenderQuality;
  layoutMode: AtlasLayoutMode;
  pageActive: boolean;
  initialCameraPose: PersistedCameraPose | null;
}) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const focusRequest = useAtlasStore((state) => state.focusRequest);
  const setViewport = useAtlasStore((state) => state.setViewport);
  const addRootNodeAt = useAtlasStore((state) => state.addRootNodeAt);
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const { camera, gl, size } = useThree();
  const perspective = camera as PerspectiveCamera;
  const keyboardPortraitLock = commandInputEditing && isKeyboardOverlayPortraitActive();
  const mobilePortraitCamera = isMobilePortraitCamera(size.width, size.height, keyboardPortraitLock);
  const mobileCamera = isMobileCamera(size.width, size.height);
  const mobileLandscapeCamera = isMobileLandscapeCamera(size.width, size.height, keyboardPortraitLock);
  const initialCenteredRef = useRef(false);
  const yawPitchRef = useRef({ yaw: 0, pitch: 0, offset: INITIAL_CAMERA_OFFSET, panX: 0, panY: 0 });
  const dragRef = useRef<SpaceDragState | null>(null);
  const wheelZoomOutRef = useRef({ amount: 0, startedAt: 0, lastFiredAt: 0 });
  const wheelZoomInRef = useRef({ amount: 0, startedAt: 0, lastFiredAt: 0 });
  const wheelSuppressUntilRef = useRef(0);
  const onboardingFastFocusSuppressUntilRef = useRef(0);
  const backgroundClickRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const multiTouchRef = useRef(false);
  const nodeVisibilityRef = useRef<NodeVisibilityState>({ lastCheckedAt: 0, allOffscreen: null });
  const vrBaselineRef = useRef<VrOrientationSample | null>(null);
  const vrOrientationRef = useRef<VrOrientationSample | null>(null);
  const vrPanEventLastEmittedAtRef = useRef(0);
  const vrManualPanPendingRef = useRef(false);
  const cameraPosePersistedAtRef = useRef(0);
  const initialCameraPoseRef = useRef(initialCameraPose);
  const spaceRaycast = useMemo(() => createConditionalMeshRaycast(shouldSkipSpaceRaycast), []);
  const transitionRef = useRef<{
    startYaw: number;
    startPitch: number;
    startOffset: number;
    startPanX: number;
    startPanY: number;
    targetYaw: number;
    targetPitch: number;
    targetOffset: number;
    targetPanX: number;
    targetPanY: number;
    elapsed: number;
    duration: number;
    nonce: number;
    nodeId: string;
  } | null>(null);
  const [birthEffect, setBirthEffect] = useState<BirthEffect | null>(null);
  const inputSphereSegments: [number, number] = renderQuality === "low" ? [32, 16] : [64, 32];

  const setViewportFromCameraState = (state: { yaw: number; pitch: number; offset: number; panX?: number; panY?: number }, forcePersist = false) => {
    const viewport = { x: state.yaw, y: state.pitch, zoom: getViewportScale(state.offset) };
    setViewport(viewport);
    const now = performance.now();
    if (!forcePersist && now - cameraPosePersistedAtRef.current < 900) return;
    cameraPosePersistedAtRef.current = now;
    persistUiStatePatch({
      viewport,
      cameraPose: {
        yaw: state.yaw,
        pitch: state.pitch,
        offset: state.offset,
      },
    });
  };

  useEffect(
    () => () => {
      if (mobileRaycastMode.kind === "space-drag") setMobileRaycastMode({ kind: "idle" });
    },
    [],
  );

  useEffect(() => {
    const persistCurrentCameraPose = () => setViewportFromCameraState(yawPitchRef.current, true);
    const persistWhenHidden = () => {
      if (document.visibilityState === "hidden") persistCurrentCameraPose();
    };
    document.addEventListener("visibilitychange", persistWhenHidden);
    document.addEventListener("freeze", persistCurrentCameraPose);
    window.addEventListener("pagehide", persistCurrentCameraPose);
    window.addEventListener("beforeunload", persistCurrentCameraPose);
    return () => {
      document.removeEventListener("visibilitychange", persistWhenHidden);
      document.removeEventListener("freeze", persistCurrentCameraPose);
      window.removeEventListener("pagehide", persistCurrentCameraPose);
      window.removeEventListener("beforeunload", persistCurrentCameraPose);
    };
  }, []);

  useEffect(() => {
    const element = gl.domElement;
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    element.addEventListener("contextmenu", preventContextMenu);
    return () => element.removeEventListener("contextmenu", preventContextMenu);
  }, [gl.domElement]);

  useEffect(() => {
    if (!pageActive) return;
    const element = gl.domElement;
    const handleDomWheel = (event: WheelEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("textarea, input, select")) return;
      event.preventDefault();
      handleWheelDelta(event.deltaY);
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        multiTouchRef.current = false;
        return;
      }
      event.preventDefault();
      dragRef.current = null;
      setBirthEffect(null);
      multiTouchRef.current = true;
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2 || !multiTouchRef.current) return;
      event.preventDefault();
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        multiTouchRef.current = false;
      }
    };

    element.addEventListener("wheel", handleDomWheel, { passive: false });
    element.addEventListener("touchstart", handleTouchStart, { passive: false });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd);
    element.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      element.removeEventListener("wheel", handleDomWheel);
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  });

  useEffect(() => {
    if (!focusRequest) return;
    const layoutViewport = getGeneratedLayoutViewport(layoutMode, size.width, size.height, keyboardPortraitLock);
    const generatedLayoutActive = layoutMode !== "phyllotaxis";
    const mobileGeneratedLayout = generatedLayoutActive && layoutViewport !== "desktop";
    const generatedLayoutFocus = generatedLayoutActive
      ? getGeneratedLayoutFocusView(atlasRoot, layoutMode, focusRequest.nodeId ?? atlasRoot.id, layoutViewport, {
          centerBounds: mobileGeneratedLayout,
          viewportWidth: size.width,
          viewportHeight: size.height,
        })
      : null;
    const targetVector = generatedLayoutFocus?.target ?? getFocusTargetVector(atlasRoot, layoutMode, focusRequest, layoutViewport);
    const targetDirection = generatedLayoutActive
      ? new Vector3(0, 0, -1)
      : targetVector.lengthSq() > 0.001
        ? targetVector.clone().normalize()
        : new Vector3(0, 0, -1);
    const targetAngles = directionToYawPitch(targetDirection);
    const generatedFocusDiameter = generatedLayoutFocus?.diameter ?? focusRequest.diameter;
    const targetDiameter = Math.max(focusRequest.diameter, generatedFocusDiameter);
    const targetDistance =
      mobileGeneratedLayout
        ? getGeneratedLayoutMobileCameraDistance(targetDiameter, size.height, perspective.fov, layoutViewport)
        : getCameraDistanceForDiameter(
            targetDiameter,
            size.height,
            perspective.fov,
            generatedLayoutActive ? GENERATED_LAYOUT_MAX_CAMERA_DISTANCE : 620,
          );
    const targetRadius = generatedLayoutActive ? Math.abs(targetVector.z) : targetVector.length();
    const targetIsRoot = !generatedLayoutActive && focusRequest.nodeId === atlasRoot.id;
    const focusDistance = generatedLayoutActive ? targetDistance : targetDistance * (mobileLandscapeCamera ? MOBILE_LANDSCAPE_FOCUS_DISTANCE_MULTIPLIER : 1);
    const generatedMaxCameraDistance = mobileGeneratedLayout ? GENERATED_LAYOUT_MOBILE_MAX_CAMERA_DISTANCE : GENERATED_LAYOUT_MAX_CAMERA_DISTANCE;
    const targetOffset =
      generatedLayoutActive
        ? clamp(targetRadius - focusDistance, targetRadius - generatedMaxCameraDistance, MAX_CAMERA_OFFSET)
        : targetIsRoot && mobileCamera
        ? getInitialCameraOffset(mobilePortraitCamera)
        : getFocusTargetOffset(
            targetRadius,
            focusDistance,
            false,
          );
    const generatedMobilePanYOffset = mobileGeneratedLayout
      ? getGeneratedLayoutMobilePanYOffset(focusDistance, size.height, perspective.fov, layoutViewport)
      : 0;
    const current = yawPitchRef.current;

    transitionRef.current = {
      startYaw: current.yaw,
      startPitch: current.pitch,
      startOffset: current.offset,
      startPanX: current.panX,
      startPanY: current.panY,
      targetYaw: closestAngle(current.yaw, targetAngles.yaw),
      targetPitch: clamp(targetAngles.pitch, -FOCUS_PITCH_LIMIT, FOCUS_PITCH_LIMIT),
      targetOffset,
      targetPanX: generatedLayoutActive ? targetVector.x : 0,
      targetPanY: generatedLayoutActive ? targetVector.y + generatedMobilePanYOffset : 0,
      elapsed: 0,
      duration: renderQuality === "low" ? LOW_QUALITY_MOTION_DURATION_SECONDS : LAYOUT_MOTION_DURATION_SECONDS,
      nonce: focusRequest.nonce,
      nodeId: focusRequest.nodeId ?? "",
    };
  }, [atlasRoot, focusRequest, keyboardPortraitLock, layoutMode, mobileCamera, mobileLandscapeCamera, perspective.fov, renderQuality, size.height, size.width]);

  useEffect(() => {
    if (initialCenteredRef.current) return;
    initialCenteredRef.current = true;

    requestAnimationFrame(() => {
      const initialOffset = getInitialCameraOffset(mobilePortraitCamera);
      const restoredPose = initialCameraPoseRef.current;
      yawPitchRef.current = isPersistedCameraPose(restoredPose)
        ? {
            yaw: restoredPose.yaw,
            pitch: clamp(restoredPose.pitch, -1.22, 1.22),
            offset: clamp(restoredPose.offset, getMinCameraOffset(mobilePortraitCamera), MAX_CAMERA_OFFSET),
            panX: 0,
            panY: 0,
          }
        : { yaw: 0, pitch: 0, offset: initialOffset, panX: 0, panY: 0 };
      applyCameraPose(perspective, yawPitchRef.current);
      setViewportFromCameraState(yawPitchRef.current, true);
    });
  }, [mobilePortraitCamera, perspective]);

  useEffect(() => {
    if (!pageActive || !vrPanEnabled || typeof window === "undefined") {
      vrBaselineRef.current = null;
      vrOrientationRef.current = null;
      vrManualPanPendingRef.current = false;
      return;
    }

    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.beta !== "number" || typeof event.gamma !== "number") return;
      const sample: VrOrientationSample = {
        beta: event.beta,
        gamma: event.gamma,
        screenAngle: getCurrentScreenAngle(),
      };
      const baseline = vrBaselineRef.current;
      if (!baseline || normalizeScreenAngle(baseline.screenAngle) !== normalizeScreenAngle(sample.screenAngle)) {
        vrBaselineRef.current = sample;
        vrManualPanPendingRef.current = false;
        vrPanEventLastEmittedAtRef.current = 0;
      }
      vrOrientationRef.current = sample;
    };

    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    return () => {
      window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
      vrBaselineRef.current = null;
      vrOrientationRef.current = null;
      vrManualPanPendingRef.current = false;
    };
  }, [pageActive, vrPanEnabled]);

  useFrame((_, delta) => {
    if (!pageActive) return;
    if (birthEffect?.mode === "burst" && performance.now() - birthEffect.startedAt > 820) {
      setBirthEffect(null);
    }

    const visibilityViewport = getGeneratedLayoutViewport(layoutMode, size.width, size.height, keyboardPortraitLock);
    reportNodeVisibility(atlasRoot, perspective, nodeVisibilityRef.current, visibilityViewport);

    const drag = dragRef.current;
    if (layoutMode === "phyllotaxis" && drag?.mode === "hold" && drag.canBirth && !drag.created) {
      const heldFor = performance.now() - drag.startedAt;
      if (heldFor >= HOLD_TO_BIRTH_MS) {
        drag.created = true;
        addRootNodeAt(drag.direction);
        emitOnboardingEvent("root-node-created");
        setBirthEffect({
          id: `burst-${performance.now()}`,
          direction: drag.direction,
          startedAt: performance.now(),
          mode: "burst",
        });
      }
    }
    if (layoutMode === "phyllotaxis" && drag?.mode === "hold" && !drag.canBirth && !drag.blockedBirthHintEmitted) {
      const heldFor = performance.now() - drag.startedAt;
      if (heldFor >= ROOT_BIRTH_BLOCKED_HINT_MS) {
        drag.blockedBirthHintEmitted = true;
        emitOnboardingEvent("root-birth-blocked-zoom");
      }
    }

    if (vrPanEnabled && !transitionRef.current && !dragRef.current && !multiTouchRef.current) {
      applyVrTiltPan(delta);
    }

    const transition = transitionRef.current;
    if (!transition) return;

    transition.elapsed += delta;
    const progress = Math.min(1, transition.elapsed / transition.duration);
    const eased = getLayoutMotionProgress(progress, renderQuality);
    const state = yawPitchRef.current;
    state.yaw = lerp(transition.startYaw, transition.targetYaw, eased);
    state.pitch = lerp(transition.startPitch, transition.targetPitch, eased);
    state.offset = lerp(transition.startOffset, transition.targetOffset, eased);
    state.panX = lerp(transition.startPanX, transition.targetPanX, eased);
    state.panY = lerp(transition.startPanY, transition.targetPanY, eased);
    applyCameraPose(perspective, state);
    setViewportFromCameraState(state);

    if (progress >= 1) {
      transitionRef.current = null;
      window.dispatchEvent(
        new CustomEvent<FocusTransitionCompleteDetail>(FOCUS_TRANSITION_COMPLETE_EVENT, {
          detail: { nodeId: transition.nodeId, nonce: transition.nonce },
        }),
      );
    }
  });

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.stopPropagation();
    window.dispatchEvent(new Event(UNIVERSE_BACKGROUND_INTERACTION_EVENT));
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    backgroundClickRef.current = event.button === 0 ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
    const canBirth = layoutMode === "phyllotaxis" && canStartRootBirth(yawPitchRef.current.offset, size.height, perspective.fov);
    const direction = directionFromRay(event.ray, NOTEBOOK_FIRST_SHELL_RADIUS);
    setMobileRaycastMode({ kind: "space-drag" });

    dragRef.current = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      lastScreen: { x: event.clientX, y: event.clientY },
      startedAt: performance.now(),
      direction,
      mode: "hold",
      created: false,
      canBirth,
      blockedBirthHintEmitted: false,
    };
    transitionRef.current = null;

    if (canBirth) {
      emitOnboardingEvent("root-birth-start");
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
    const backgroundClick = backgroundClickRef.current;
    if (backgroundClick?.pointerId === event.pointerId && Math.hypot(event.clientX - backgroundClick.x, event.clientY - backgroundClick.y) > 6) {
      backgroundClickRef.current = null;
    }

    if (drag.mode === "hold" && moved > WHITE_HOLE_CANCEL_PX && !drag.created) {
      drag.mode = "rotate";
      setBirthEffect(null);
    }

    if (drag.mode === "rotate") {
      const deltaX = event.clientX - drag.lastScreen.x;
      const deltaY = event.clientY - drag.lastScreen.y;
      applyPanDelta(deltaX, deltaY);
      markVrManualPan(deltaX, deltaY);
    }

    drag.lastScreen = { x: event.clientX, y: event.clientY };
  };

  const applyPanDelta = (
    deltaX: number,
    deltaY: number,
    options: { emitOnboarding?: boolean } = {},
  ) => {
    if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) return;
    if (options.emitOnboarding !== false && Math.hypot(deltaX, deltaY) > 4) emitOnboardingEvent("pan");
    const state = yawPitchRef.current;
    if (layoutMode !== "phyllotaxis") {
      const worldPerPixel = getWorldUnitsPerPixel(Math.abs(state.offset), size.height, perspective.fov);
      state.panX -= deltaX * worldPerPixel;
      state.panY += deltaY * worldPerPixel;
      state.yaw = 0;
      state.pitch = 0;
      transitionRef.current = null;
      applyCameraPose(perspective, state);
      setViewportFromCameraState(state);
      return;
    }
    const rotationGain = getRotationGain(state.offset);
    state.yaw -= deltaX * rotationGain;
    state.pitch = clamp(state.pitch + deltaY * rotationGain, -1.22, 1.22);
    transitionRef.current = null;
    applyCameraPose(perspective, state);
    setViewportFromCameraState(state);
  };

  useEffect(() => {
    if (!pageActive) return;
    const handleUniversePanDelta = (event: Event) => {
      const detail = (event as CustomEvent<UniversePanDeltaDetail>).detail;
      if (typeof detail?.deltaX !== "number" || typeof detail.deltaY !== "number") return;
      applyPanDelta(detail.deltaX, detail.deltaY);
      markVrManualPan(detail.deltaX, detail.deltaY);
    };

    window.addEventListener(UNIVERSE_PAN_DELTA_EVENT, handleUniversePanDelta);
    return () => window.removeEventListener(UNIVERSE_PAN_DELTA_EVENT, handleUniversePanDelta);
  });

  const markVrManualPan = (deltaX: number, deltaY: number) => {
    if (!vrPanEnabled || Math.hypot(deltaX, deltaY) <= 4) return;
    vrManualPanPendingRef.current = true;
  };

  const recenterVrBaseline = () => {
    if (!vrPanEnabled) return;
    const sample = vrOrientationRef.current;
    if (!sample) {
      vrManualPanPendingRef.current = false;
      return;
    }
    vrBaselineRef.current = { ...sample };
    vrPanEventLastEmittedAtRef.current = 0;
    vrManualPanPendingRef.current = false;
  };

  const applyVrTiltPan = (deltaSeconds: number) => {
    const baseline = vrBaselineRef.current;
    const sample = vrOrientationRef.current;
    if (!baseline || !sample) return;
    const offset = getVrTiltOffset(sample, baseline);
    if (isVrTiltInsideDeadZone(offset)) {
      return;
    }
    const normalizedX = normalizeVrTilt(offset.x);
    const normalizedY = normalizeVrTilt(offset.y);
    if (Math.abs(normalizedX) < 0.001 && Math.abs(normalizedY) < 0.001) return;

    applyPanDelta(
      normalizedX * VR_TILT_PAN_X_PIXELS_PER_SECOND * deltaSeconds,
      normalizedY * VR_TILT_PAN_Y_PIXELS_PER_SECOND * deltaSeconds,
      { emitOnboarding: false },
    );

    const now = performance.now();
    if (now - vrPanEventLastEmittedAtRef.current > VR_PAN_EVENT_INTERVAL_MS) {
      vrPanEventLastEmittedAtRef.current = now;
      emitOnboardingEvent("pan");
    }
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const backgroundClick = backgroundClickRef.current;
    if (
      backgroundClick?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - backgroundClick.x, event.clientY - backgroundClick.y) <= 6
    ) {
      const store = useAtlasStore.getState();
      store.clearMultiSelection();
      store.selectNodeInPlace(store.atlasRoot.id);
      window.dispatchEvent(new Event(UNIVERSE_BACKGROUND_CLICK_EVENT));
    }
    backgroundClickRef.current = null;
    if (vrManualPanPendingRef.current) recenterVrBaseline();
    dragRef.current = null;
    setMobileRaycastMode({ kind: "idle" });
    if (!drag.created && drag.mode === "hold" && drag.canBirth) {
      setBirthEffect(null);
    }
  };

  const handleWheelDelta = (deltaY: number) => {
    const now = performance.now();
    if (now < wheelSuppressUntilRef.current) return;
    const onboardingSpaceStep = getOnboardingCurrentSpaceStep();
    const suppressOnboardingFastFocus = onboardingSpaceStep !== null || now < onboardingFastFocusSuppressUntilRef.current;
    if (onboardingSpaceStep === "zoom") {
      onboardingFastFocusSuppressUntilRef.current = now + 1800;
    }
    if (Math.abs(deltaY) > 0.5) emitOnboardingEvent("zoom");

    const state = yawPitchRef.current;
    state.offset = clamp(state.offset - deltaY * 0.35, getMinCameraOffset(mobilePortraitCamera), MAX_CAMERA_OFFSET);
    transitionRef.current = null;
    applyCameraPose(perspective, state);
    setViewportFromCameraState(state);

    const zoomOutState = wheelZoomOutRef.current;
    const zoomInState = wheelZoomInRef.current;
    if (layoutMode === "tree") {
      // Tree is a flat generated layout, so wheel input should remain pure zoom.
      zoomOutState.amount = 0;
      zoomOutState.startedAt = 0;
      zoomInState.amount = 0;
      zoomInState.startedAt = 0;
      return;
    }
    const suppressActiveSwitch = isAutoFocusSuppressed();
    if (suppressOnboardingFastFocus) {
      zoomOutState.amount = 0;
      zoomOutState.startedAt = 0;
      zoomInState.amount = 0;
      zoomInState.startedAt = 0;
      return;
    }
    if (deltaY <= 0) {
      zoomOutState.amount = 0;
      zoomOutState.startedAt = 0;
    } else {
      zoomInState.amount = 0;
      zoomInState.startedAt = 0;
    }

    if (deltaY > 0) {
      if (now - zoomOutState.lastFiredAt < ZOOM_OUT_PARENT_COOLDOWN_MS) return;
      if (!zoomOutState.startedAt || now - zoomOutState.startedAt > ZOOM_OUT_DETECTION_WINDOW_MS) {
        zoomOutState.amount = 0;
        zoomOutState.startedAt = now;
      }
      zoomOutState.amount += Math.abs(deltaY);
      if (zoomOutState.amount >= ZOOM_OUT_AMOUNT_THRESHOLD && now - zoomOutState.startedAt >= ZOOM_OUT_MIN_DURATION_MS) {
        zoomOutState.amount = 0;
        zoomOutState.startedAt = 0;
        zoomOutState.lastFiredAt = now;
        wheelSuppressUntilRef.current = now + 900;
        const atlasState = useAtlasStore.getState();
        if (suppressActiveSwitch) {
          atlasState.focusParentLayerCameraOnly();
        } else {
          atlasState.focusParentLayer();
        }
      }
      return;
    }

    if (deltaY < 0) {
      const atlasState = useAtlasStore.getState();
      let targetChildId: string | null = null;
      if (!suppressActiveSwitch) {
        const selectedPath = findNodePath(atlasState.atlasRoot, atlasState.selectedNodeId);
        const selectedNode = selectedPath?.at(-1);
        if (selectedNode?.children.length !== 1) {
          zoomInState.amount = 0;
          zoomInState.startedAt = 0;
          return;
        }
        targetChildId = selectedNode.children[0].id;
      }

      if (now - zoomInState.lastFiredAt < ZOOM_OUT_PARENT_COOLDOWN_MS) return;
      if (!zoomInState.startedAt || now - zoomInState.startedAt > ZOOM_OUT_DETECTION_WINDOW_MS) {
        zoomInState.amount = 0;
        zoomInState.startedAt = now;
      }
      zoomInState.amount += Math.abs(deltaY);
      if (zoomInState.amount >= ZOOM_OUT_AMOUNT_THRESHOLD && now - zoomInState.startedAt >= ZOOM_OUT_MIN_DURATION_MS) {
        zoomInState.amount = 0;
        zoomInState.startedAt = 0;
        zoomInState.lastFiredAt = now;
        wheelSuppressUntilRef.current = now + 900;
        if (suppressActiveSwitch) {
          atlasState.focusSingleChildCameraOnly();
        } else if (targetChildId) {
          atlasState.focusNode(targetChildId);
        }
      }
    }
  };

  useEffect(() => {
    if (!pageActive) return;
    const handleMinimapNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ yaw?: unknown; pitch?: unknown }>).detail;
      if (typeof detail?.yaw !== "number" || typeof detail.pitch !== "number") return;
      const state = yawPitchRef.current;
      state.yaw = detail.yaw;
      state.pitch = clamp(detail.pitch, -1.22, 1.22);
      transitionRef.current = null;
      wheelZoomOutRef.current.amount = 0;
      wheelZoomInRef.current.amount = 0;
      applyCameraPose(perspective, state);
      setViewportFromCameraState(state);
    };

    const handleMinimapZoom = (event: Event) => {
      const detail = (event as CustomEvent<{ deltaY?: unknown }>).detail;
      if (typeof detail?.deltaY !== "number") return;
      handleWheelDelta(detail.deltaY);
    };

    window.addEventListener(MINIMAP_NAVIGATE_EVENT, handleMinimapNavigate);
    window.addEventListener(MINIMAP_ZOOM_EVENT, handleMinimapZoom);
    return () => {
      window.removeEventListener(MINIMAP_NAVIGATE_EVENT, handleMinimapNavigate);
      window.removeEventListener(MINIMAP_ZOOM_EVENT, handleMinimapZoom);
    };
  });

  return (
    <>
      <mesh
        raycast={spaceRaycast}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <sphereGeometry args={[INPUT_EVENT_SPHERE_RADIUS, inputSphereSegments[0], inputSphereSegments[1]]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={BackSide} />
      </mesh>
      {birthEffect ? <WhiteHoleEffect key={birthEffect.id} effect={birthEffect} theme={theme} /> : null}
    </>
  );
}

function NodeContextMenu({ menu, onClose }: { menu: NodeContextMenuState | null; onClose: () => void }) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const deleteNode = useAtlasStore((state) => state.deleteNode);
  const pasteNodeSubtree = useAtlasStore((state) => state.pasteNodeSubtree);
  const promoteNodeOneLevel = useAtlasStore((state) => state.promoteNodeOneLevel);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [clipboardNode, setClipboardNode] = useState<AtlasNode | null>(null);
  const [clipboardState, setClipboardState] = useState<"checking" | "available" | "unavailable">("unavailable");
  const [copyContextPreset, setCopyContextPreset] = useState("");
  const nodePath = menu ? findNodePath(atlasRoot, menu.nodeId) : null;
  const node = nodePath?.at(-1);

  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [menu, onClose]);

  useEffect(() => {
    let cancelled = false;
    setClipboardNode(null);

    if (!menu || !node || node.id === atlasRoot.id) {
      setClipboardState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setClipboardState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setClipboardState("checking");
    navigator.clipboard
      .readText()
      .then((text) => {
        if (cancelled) return;
        const parsedNode = parseNodeClipboardText(text);
        setClipboardNode(parsedNode);
        setClipboardState(parsedNode ? "available" : "unavailable");
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Failed to inspect clipboard for Mind Atlas data", error);
        setClipboardState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [atlasRoot.id, menu, node]);

  if (!menu || !node || node.id === atlasRoot.id) return null;

  const handleDelete = () => {
    if (node.children.length > 0) {
      const confirmed = window.confirm("子どもも全て削除されます。よろしいですか？");
      if (!confirmed) return;
    }
    deleteNode(node.id);
    onClose();
  };

  const handleCopyAsText = async () => {
    try {
      await navigator.clipboard.writeText(serializeNodeTreeForLlm(node));
      onClose();
    } catch (error) {
      console.error("Failed to copy node tree text", error);
    }
  };

  const handleCopyContext = async (preset: ContextCopyPreset) => {
    try {
      await copyContextMarkdown(atlasRoot, node.id, preset);
      onClose();
    } catch (error) {
      console.error("Failed to copy context text", error);
    }
  };

  const handleCopyObject = async () => {
    try {
      const hasAttachments = nodeTreeHasAttachments(node);
      await writeClipboardText(createNodeClipboardText(node));
      if (hasAttachments) {
        window.alert("画像・動画などの添付ファイルが含まれています。クリップボードにはファイル本体ではなくメタデータのみコピーされます。");
      }
      onClose();
    } catch (error) {
      console.error("Failed to copy Mind Atlas node object", error);
    }
  };

  const handleCutObject = async () => {
    try {
      const hasAttachments = nodeTreeHasAttachments(node);
      await writeClipboardText(createNodeClipboardText(node));
      if (hasAttachments) {
        window.alert("画像・動画などの添付ファイルが含まれています。クリップボードにはファイル本体ではなくメタデータのみコピーされます。");
      }
      deleteNode(node.id);
      onClose();
    } catch (error) {
      console.error("Failed to cut Mind Atlas node object", error);
    }
  };

  const handlePasteObject = async () => {
    let copiedNode = clipboardNode;
    try {
      const clipboardText = await navigator.clipboard.readText();
      const latestNode = parseNodeClipboardText(clipboardText);
      if (!latestNode) {
        setClipboardNode(null);
        setClipboardState("unavailable");
        return;
      }
      copiedNode = latestNode;
    } catch (error) {
      if (!copiedNode) {
        console.error("Failed to read Mind Atlas node object from clipboard", error);
        return;
      }
    }

    const pastedId = pasteNodeSubtree(node.id, copiedNode);
    if (pastedId) onClose();
  };

  const handlePromoteOneLevel = () => {
    promoteNodeOneLevel(node.id);
    onClose();
  };

  const canPaste = clipboardState === "available" && clipboardNode !== null;
  const canPromote = Boolean(nodePath && nodePath.length >= 3);

  return (
    <div
      ref={menuRef}
      className="context-menu node-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="Node actions"
    >
      <button type="button" onClick={handleCopyObject}>
        <ClipboardCopy size={15} /> オブジェクトコピー
      </button>
      <button type="button" onClick={handleCutObject}>
        <Scissors size={15} /> 切り取り
      </button>
      <button
        type="button"
        onClick={handlePasteObject}
        disabled={!canPaste}
        title={canPaste ? "Mind Atlas object paste" : "Mind Atlasで読み込めるオブジェクトデータがクリップボードにありません"}
      >
        <ClipboardPaste size={15} /> 貼り付け
      </button>
      <button
        type="button"
        onClick={handlePromoteOneLevel}
        disabled={!canPromote}
        title={canPromote ? "直接の親と兄弟になるように一つ上の階層へ移動" : "これ以上、上の階層には移動できません"}
      >
        <MoveUp size={15} /> 一つ上の階層に移動
      </button>
      <button type="button" onClick={handleCopyAsText}>
        <Copy size={15} /> テキストにコピー
      </button>
      <label className="node-context-copy-select">
        <Copy size={15} />
        <select
          value={copyContextPreset}
          onChange={(event) => {
            const preset = event.target.value as ContextCopyPreset;
            setCopyContextPreset(event.target.value);
            if (preset) void handleCopyContext(preset);
          }}
          aria-label="Copy with context"
        >
          <option value="">Copy with context</option>
          {CONTEXT_COPY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} ({buildContextCopy(atlasRoot, node.id, preset.id)?.stats.estimatedTokens.toLocaleString() ?? "0"} tokens)
            </option>
          ))}
        </select>
      </label>
      <button className="destructive-menu-button" type="button" onClick={handleDelete}>
        <Trash2 size={15} /> 削除
      </button>
    </div>
  );
}

async function writeClipboardText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard write is not available.");
  }
}

type LlmExportEntry = {
  node: AtlasNode;
  ref: string;
  parentRef: string;
  titlePath: string[];
  depth: number;
  childIndex: number;
  siblingCount: number;
};

function serializeNodeTreeForLlm(root: AtlasNode) {
  const entries = buildLlmExportEntries(root);
  const lines = [
    "# Mind Atlas Structured Tree Export",
    "",
    "The following text is a tree-shaped Mind Atlas context export.",
    "Read it as a hierarchy, not as one flat chat transcript.",
    "`ref` is the compact tree address. For example, [0.2.1] is child 1 of child 2 of the copied root [0].",
    "`parentRef`, `childIndex`, `childRefs`, `depth`, and `titlePath` preserve parent-child structure even when many node bodies are listed in sequence.",
    "Use TREE_OUTLINE first for orientation, then read NODE blocks for full text and metadata.",
    "",
    "Notation:",
    "- NODE_BEGIN / NODE_END delimit one node.",
    "- body is the user or AI text stored in that node.",
    "- attachments are metadata only unless content is explicitly present in body.",
    "- AI/tool metadata such as provider, model, mode, and usage describes how that node was produced.",
    "- Long platform ids are included as `id` for exact lookup, but `ref` is easier to reason about.",
    "",
    "Subtree summary:",
    `- rootRef: [0]`,
    `- rootTitle: ${cleanNodeTitle(root)}`,
    `- totalNodes: ${entries.length}`,
    "",
    "TREE_OUTLINE_BEGIN",
    ...entries.map(formatOutlineEntry),
    "TREE_OUTLINE_END",
    "",
    ...entries.flatMap(formatNodeBlock),
  ];
  return lines.join("\n");
}

function buildLlmExportEntries(
  node: AtlasNode,
  ref = "0",
  parentRef = "none",
  ancestorTitles: string[] = [],
  depth = 0,
  childIndex = 0,
  siblingCount = 1,
): LlmExportEntry[] {
  const titlePath = [...ancestorTitles, cleanNodeTitle(node)];
  const entry: LlmExportEntry = {
    node,
    ref,
    parentRef,
    titlePath,
    depth,
    childIndex,
    siblingCount,
  };
  return [
    entry,
    ...node.children.flatMap((child, index) =>
      buildLlmExportEntries(child, `${ref}.${index + 1}`, ref, titlePath, depth + 1, index + 1, node.children.length),
    ),
  ];
}

function formatOutlineEntry(entry: LlmExportEntry) {
  const indent = "  ".repeat(entry.depth);
  const childCount = entry.node.children.length;
  const meta = `${entry.node.author}/${entry.node.nodeType}/${entry.node.status}`;
  return `${indent}- [${entry.ref}] ${cleanNodeTitle(entry.node)} (${meta}; children=${childCount})`;
}

function formatNodeBlock(entry: LlmExportEntry): string[] {
  const { node } = entry;
  const childRefs = node.children.length
    ? node.children.map((child, index) => `[${entry.ref}.${index + 1}] ${cleanNodeTitle(child)}`).join("; ")
    : "none";
  const metadata = [
    `ref: [${entry.ref}]`,
    `parentRef: ${entry.parentRef === "none" ? "none" : `[${entry.parentRef}]`}`,
    `childIndex: ${entry.depth === 0 ? "root" : `${entry.childIndex} of ${entry.siblingCount}`}`,
    `id: ${node.id}`,
    `title: ${cleanNodeTitle(node)}`,
    `titlePath: ${entry.titlePath.join(" > ")}`,
    `depth: ${entry.depth}`,
    `kind: ${node.kind}`,
    `nodeType: ${node.nodeType}`,
    `author: ${node.author}`,
    `status: ${node.status}`,
    node.provider ? `provider: ${node.provider}` : "",
    node.runMode ? `runMode: ${node.runMode}` : "",
    node.modelId ? `model: ${node.modelId}` : "",
    node.aiRunId ? `aiRunId: ${node.aiRunId}` : "",
    node.tags.length ? `tags: ${node.tags.map((tag) => `#${tag}`).join(" ")}` : "tags: none",
    node.attachments.length ? `attachments: ${node.attachments.map(formatAttachmentForExport).join("; ")}` : "attachments: none",
    node.usage ? `usage: ${formatUsageForExport(node.usage)}` : "",
    `childRefs: ${childRefs}`,
  ].filter(Boolean);

  return [
    "",
    "NODE_BEGIN",
    ...metadata,
    "summary:",
    indentBlock(node.summary || "(empty)"),
    "nextDecision:",
    indentBlock(node.nextDecision || "(empty)"),
    "body:",
    indentBlock(node.body || "(empty)"),
    "NODE_END",
  ];
}

function cleanNodeTitle(node: AtlasNode) {
  return node.title.trim() || "Untitled";
}

function indentBlock(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatAttachmentForExport(attachment: AtlasNode["attachments"][number]) {
  return `${attachment.name} (${attachment.kind}, ${attachment.mimeType}, ${formatBytesForExport(attachment.size)})`;
}

function formatBytesForExport(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatUsageForExport(usage: NonNullable<AtlasNode["usage"]>) {
  return [
    typeof usage.inputTokens === "number" ? `inputTokens=${usage.inputTokens}` : "",
    typeof usage.outputTokens === "number" ? `outputTokens=${usage.outputTokens}` : "",
    typeof usage.totalTokens === "number" ? `totalTokens=${usage.totalTokens}` : "",
    typeof usage.maxOutputTokens === "number" ? `maxOutputTokens=${usage.maxOutputTokens}` : "",
    usage.finishReason ? `finishReason=${usage.finishReason}` : "",
    usage.outputLimitHit ? "outputLimitHit=true" : "",
    typeof usage.estimatedCostUsd === "number" ? `estimatedCostUsd=${usage.estimatedCostUsd}` : "",
    typeof usage.durationMs === "number" ? `durationMs=${usage.durationMs}` : "",
  ].filter(Boolean).join(", ");
}

function NotebookNodes({
  theme,
  renderQuality,
  layoutMode,
  pageActive,
  onOpenNodeContextMenu,
}: {
  theme: AtlasTheme;
  renderQuality: RenderQuality;
  layoutMode: AtlasLayoutMode;
  pageActive: boolean;
  onOpenNodeContextMenu: (menu: NodeContextMenuState) => void;
}) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const cameraFocusNodeId = useAtlasStore((state) => state.cameraFocusNodeId);
  const multiSelectedNodeIds = useAtlasStore((state) => state.multiSelectedNodeIds);
  const aiContextOptions = useAtlasStore((state) => state.aiContextOptions);
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const activeCommandMode = useAtlasStore((state) => state.activeCommandMode);
  const unreadNotifications = useAtlasStore((state) => state.unreadNotifications);
  const notificationPulses = useAtlasStore((state) => state.notificationPulses);
  const notificationSnoozePrompt = useAtlasStore((state) => state.notificationSnoozePrompt);
  const dismissNotificationSnoozePrompt = useAtlasStore((state) => state.dismissNotificationSnoozePrompt);
  const focusRequest = useAtlasStore((state) => state.focusRequest);
  const focusNonce = focusRequest?.nonce ?? 0;
  const mobileLabelScope = useMobilePerformanceMode();
  const { camera, size } = useThree();
  const perspective = camera as PerspectiveCamera;
  const [focusWaveStartedAt, setFocusWaveStartedAt] = useState(() => performance.now());
  const [renderSelectedNodeId, setRenderSelectedNodeId] = useState(selectedNodeId);
  const selectedPath = findNodePath(atlasRoot, renderSelectedNodeId) ?? findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];
  const cameraFocusPath = cameraFocusNodeId ? findNodePath(atlasRoot, cameraFocusNodeId) : null;
  const renderFocusPath = cameraFocusPath ?? selectedPath;
  const rootIsSelected = renderSelectedNodeId === atlasRoot.id;
  const effectiveSelectedNodeId = rootIsSelected ? atlasRoot.id : renderSelectedNodeId;
  const highlightSelectedNodeId = rootIsSelected ? "" : renderSelectedNodeId;
  const selectedParentId = selectedPath.length > 1 ? selectedPath[selectedPath.length - 2].id : null;
  const focusBaseIndex = cameraFocusPath ? Math.max(0, renderFocusPath.length - 1) : selectedPath.length > 2 ? selectedPath.length - 2 : 0;
  const focusParent = renderFocusPath[focusBaseIndex];
  const selectedPathIndexByNodeId = useMemo(
    () => new Map(selectedPath.map((node, index) => [node.id, index])),
    [selectedPath],
  );
  const notificationKindsByNodeId = useMemo(() => buildNotificationPathKinds(atlasRoot, unreadNotifications), [atlasRoot, unreadNotifications]);
  const activeNotificationSnoozePrompt =
    notificationSnoozePrompt && notificationSnoozePrompt.expiresAt > Date.now() ? notificationSnoozePrompt : null;
  const multiSelectedNodeIdSet = useMemo(() => new Set(multiSelectedNodeIds), [multiSelectedNodeIds]);
  const aiContextPreviewNodeIds = useMemo(() => {
    if (!commandInputEditing || activeCommandMode === "note") return new Set<string>();
    return new Set(getAiContextNodeIds(atlasRoot, selectedNodeId, { ...aiContextOptions, selectedNodeIds: multiSelectedNodeIds }));
  }, [activeCommandMode, aiContextOptions, atlasRoot, commandInputEditing, multiSelectedNodeIds, selectedNodeId]);
  const nodeRenderMetaById = useMemo(() => buildNodeRenderMeta(atlasRoot), [atlasRoot]);
  const mandatoryRenderNodeIds = useMemo(
    () =>
      buildMandatoryRenderNodeIds(
        atlasRoot.id,
        nodeRenderMetaById,
        [
          selectedNodeId,
          renderSelectedNodeId,
          cameraFocusNodeId,
          ...multiSelectedNodeIds,
          ...notificationPulses.map((pulse) => pulse.nodeId),
          ...aiContextPreviewNodeIds,
          activeNotificationSnoozePrompt?.nodeId ?? null,
        ],
      ),
    [
      activeNotificationSnoozePrompt?.nodeId,
      aiContextPreviewNodeIds,
      atlasRoot.id,
      cameraFocusNodeId,
      multiSelectedNodeIds,
      nodeRenderMetaById,
      notificationPulses,
      renderSelectedNodeId,
      selectedNodeId,
    ],
  );
  const layoutViewport = getGeneratedLayoutViewport(layoutMode, size.width, size.height);
  const layoutFrame = useMemo(
    () => deriveAtlasLayoutFrame(atlasRoot, layoutMode, undefined, { focusNodeId: selectedNodeId, viewport: layoutViewport, viewportWidth: size.width, viewportHeight: size.height }),
    [atlasRoot, layoutMode, layoutViewport, selectedNodeId, size.height, size.width],
  );
  const currentLayoutPositions = layoutFrame.positions;
  const currentVisibleNodeIds = layoutFrame.visibleIds;
  const previousVisibleNodeIdsRef = useRef<Set<string> | null>(null);
  const previousLayoutPositionsRef = useRef<Map<string, Vec3>>(currentLayoutPositions);
  const retainedLayoutPositionsRef = useRef<Map<string, Vec3>>(new Map());
  const visibilityTimeoutsRef = useRef<number[]>([]);
  const [exitingNodeIds, setExitingNodeIds] = useState<Set<string>>(() => new Set());
  const cameraCullStateRef = useRef<{ lastCheckedAt: number; retainedUntil: Map<string, number> }>({
    lastCheckedAt: 0,
    retainedUntil: new Map(),
  });
  const cameraVisibleNodeIdsRef = useRef<Set<string> | null>(null);
  const [cameraVisibleNodeIds, setCameraVisibleNodeIds] = useState<Set<string> | null>(null);

  useEffect(
    () => () => {
      visibilityTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      visibilityTimeoutsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    if (layoutMode === "phyllotaxis" || renderQuality === "low") {
      visibilityTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      visibilityTimeoutsRef.current = [];
      previousVisibleNodeIdsRef.current = new Set(currentVisibleNodeIds);
      previousLayoutPositionsRef.current = currentLayoutPositions;
      retainedLayoutPositionsRef.current = new Map();
      setExitingNodeIds((current) => (current.size ? new Set() : current));
      return;
    }

    const previousVisibleNodeIds = previousVisibleNodeIdsRef.current;
    if (!previousVisibleNodeIds) {
      previousVisibleNodeIdsRef.current = new Set(currentVisibleNodeIds);
      previousLayoutPositionsRef.current = currentLayoutPositions;
      return;
    }

    const nextExitingIds = [...previousVisibleNodeIds].filter((id) => !currentVisibleNodeIds.has(id));
    if (nextExitingIds.length) {
      nextExitingIds.forEach((id) => {
        const retainedPosition = previousLayoutPositionsRef.current.get(id) ?? currentLayoutPositions.get(id);
        if (retainedPosition) retainedLayoutPositionsRef.current.set(id, retainedPosition);
      });
      setExitingNodeIds((current) => new Set([...current, ...nextExitingIds]));
      const timeout = window.setTimeout(() => {
        nextExitingIds.forEach((id) => retainedLayoutPositionsRef.current.delete(id));
        setExitingNodeIds((current) => {
          const next = new Set(current);
          nextExitingIds.forEach((id) => next.delete(id));
          return next;
        });
      }, LAYOUT_VISIBILITY_HOLD_MS);
      visibilityTimeoutsRef.current.push(timeout);

      previousVisibleNodeIdsRef.current = new Set(currentVisibleNodeIds);
      previousLayoutPositionsRef.current = currentLayoutPositions;
      return;
    }

    previousVisibleNodeIdsRef.current = new Set(currentVisibleNodeIds);
    previousLayoutPositionsRef.current = currentLayoutPositions;
  }, [currentLayoutPositions, currentVisibleNodeIds, layoutMode, renderQuality]);

  const layoutRenderNodeIds = useMemo(
    () => {
      if (layoutMode === "phyllotaxis" || renderQuality === "low") return currentVisibleNodeIds;
      return new Set([...currentVisibleNodeIds, ...exitingNodeIds]);
    },
    [currentVisibleNodeIds, exitingNodeIds, layoutMode, renderQuality],
  );
  const layoutPositions = useMemo(
    () => {
      if (layoutMode === "phyllotaxis" || renderQuality === "low") return currentLayoutPositions;
      return new Map([...retainedLayoutPositionsRef.current, ...currentLayoutPositions]);
    },
    [currentLayoutPositions, exitingNodeIds, layoutMode, renderQuality],
  );
  const enteringNodeIds =
    layoutMode === "phyllotaxis" || renderQuality === "low" || !previousVisibleNodeIdsRef.current
      ? new Set<string>()
      : new Set([...currentVisibleNodeIds].filter((id) => !previousVisibleNodeIdsRef.current?.has(id)));

  useEffect(() => {
    cameraCullStateRef.current.retainedUntil.clear();
    cameraVisibleNodeIdsRef.current = null;
    setCameraVisibleNodeIds(null);
  }, [atlasRoot, layoutMode, renderQuality]);

  useFrame(() => {
    const now = performance.now();
    const cullState = cameraCullStateRef.current;
    if (now - cullState.lastCheckedAt < CAMERA_CULL_CHECK_MS) return;
    cullState.lastCheckedAt = now;

    const nextVisibleNodeIds = buildCameraCulledNodeIds({
      camera: perspective,
      candidateNodeIds: layoutRenderNodeIds,
      mandatoryNodeIds: mandatoryRenderNodeIds,
      marginNdc: mobileLabelScope ? CAMERA_CULL_MOBILE_MARGIN_NDC : CAMERA_CULL_MARGIN_NDC,
      nodeRenderMetaById,
      now,
      positions: layoutPositions,
      previousNodeIds: cameraVisibleNodeIdsRef.current,
      retainedUntil: cullState.retainedUntil,
      rootId: atlasRoot.id,
    });

    if (areSetsEqual(cameraVisibleNodeIdsRef.current, nextVisibleNodeIds)) return;
    cameraVisibleNodeIdsRef.current = nextVisibleNodeIds;
    setCameraVisibleNodeIds(nextVisibleNodeIds);
  });

  const renderVisibleNodeIds = useMemo(
    () => mergeCameraRenderNodeIds(layoutRenderNodeIds, cameraVisibleNodeIds, mandatoryRenderNodeIds, atlasRoot.id),
    [atlasRoot.id, cameraVisibleNodeIds, layoutRenderNodeIds, mandatoryRenderNodeIds],
  );

  useEffect(() => {
    if (findNode(atlasRoot, renderSelectedNodeId)) return;
    setRenderSelectedNodeId(selectedNodeId);
  }, [atlasRoot, renderSelectedNodeId, selectedNodeId]);

  useEffect(() => {
    if (layoutMode !== "phyllotaxis") {
      setRenderSelectedNodeId(selectedNodeId);
      return;
    }
    if (!focusRequest || focusRequest.nodeId !== selectedNodeId) {
      setRenderSelectedNodeId(selectedNodeId);
      return;
    }

    const currentPath = findNodePath(atlasRoot, renderSelectedNodeId);
    const nextPath = findNodePath(atlasRoot, selectedNodeId);
    if (isStrictAncestorPath(nextPath, currentPath)) {
      setRenderSelectedNodeId(selectedNodeId);
      return;
    }

    let active = true;
    const completeRenderSelection = () => {
      if (!active) return;
      setRenderSelectedNodeId(selectedNodeId);
    };
    const handleFocusTransitionComplete = (event: Event) => {
      const detail = (event as CustomEvent<FocusTransitionCompleteDetail>).detail;
      if (detail?.nodeId !== selectedNodeId || detail.nonce !== focusRequest.nonce) return;
      completeRenderSelection();
    };
    const timeout = window.setTimeout(completeRenderSelection, FOCUS_DURATION_SECONDS * 1000 + 160);

    window.addEventListener(FOCUS_TRANSITION_COMPLETE_EVENT, handleFocusTransitionComplete);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.removeEventListener(FOCUS_TRANSITION_COMPLETE_EVENT, handleFocusTransitionComplete);
    };
  }, [atlasRoot, focusRequest, layoutMode, renderSelectedNodeId, selectedNodeId]);

  useEffect(() => {
    setFocusWaveStartedAt(performance.now());
  }, [focusNonce, selectedNodeId]);

  useEffect(() => {
    if (!pageActive) return;
    if (!notificationSnoozePrompt) return;
    const remainingMs = Math.max(0, notificationSnoozePrompt.expiresAt - Date.now());
    const timeout = window.setTimeout(() => {
      dismissNotificationSnoozePrompt(notificationSnoozePrompt.nodeId);
    }, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [dismissNotificationSnoozePrompt, notificationSnoozePrompt, pageActive]);

  if (!atlasRoot.children.length) {
    return <EmptyAtlasPulse theme={theme} />;
  }

  if (renderQuality === "low") {
    const lowRenderPaths = buildLowQualityRenderPaths(atlasRoot, selectedNodeId, notificationPulses, aiContextPreviewNodeIds);
    return (
      <group>
        {lowRenderPaths.map(({ path, visibleDepthRemaining, suppressParentEdge }) => {
          const node = path[path.length - 1];
          const position = getLayoutPosition(layoutPositions, node.id);
          const parentId = path.length > 1 ? path[path.length - 2].id : null;
          return (
            <HierarchyNode
              key={`low-${node.id}`}
              node={node}
              path={path}
              worldPosition={position}
              localPosition={position}
              depth={Math.max(1, path.length - 1)}
              visibleDepthRemaining={visibleDepthRemaining}
              visibleDepthIndex={0}
              selectedNodeId={effectiveSelectedNodeId}
              highlightSelectedNodeId={highlightSelectedNodeId}
              multiSelectedNodeIds={multiSelectedNodeIdSet}
              aiContextPreviewNodeIds={aiContextPreviewNodeIds}
              selectedPathIndexByNodeId={selectedPathIndexByNodeId}
              selectedPathLength={selectedPath.length}
              selectedParentId={rootIsSelected ? null : selectedParentId}
              focusWaveStartedAt={focusWaveStartedAt}
              notificationKind={notificationKindsByNodeId.get(node.id) ?? null}
              notificationKindsByNodeId={notificationKindsByNodeId}
              notificationSnoozePrompt={activeNotificationSnoozePrompt}
              mobileLabelScope={mobileLabelScope}
              suppressParentEdge={suppressParentEdge || parentId !== atlasRoot.id}
              renderQuality={renderQuality}
              theme={theme}
              layoutPositions={layoutPositions}
              visibleNodeIds={renderVisibleNodeIds}
              currentVisibleNodeIds={currentVisibleNodeIds}
              enteringNodeIds={enteringNodeIds}
              layoutMode={layoutMode}
              rootOverviewActive={rootIsSelected}
              onOpenNodeContextMenu={onOpenNodeContextMenu}
            />
          );
        })}
      </group>
    );
  }

  if (layoutMode === "phyllotaxis" && focusBaseIndex > 0) {
    const parentPath = renderFocusPath.slice(0, focusBaseIndex + 1);
    const parentPosition = getLayoutPosition(layoutPositions, focusParent.id);
    const visibleDepthRemaining = layoutMode === "phyllotaxis" ? VISIBLE_DESCENDANT_DEPTH + 1 : GENERATED_LAYOUT_VISIBLE_DESCENDANT_DEPTH;
    return (
      <group>
        <HierarchyNode
          node={focusParent}
          path={parentPath}
          worldPosition={parentPosition}
          localPosition={parentPosition}
          depth={Math.max(1, parentPath.length - 1)}
          visibleDepthRemaining={visibleDepthRemaining}
          visibleDepthIndex={0}
          selectedNodeId={effectiveSelectedNodeId}
          highlightSelectedNodeId={highlightSelectedNodeId}
          multiSelectedNodeIds={multiSelectedNodeIdSet}
          aiContextPreviewNodeIds={aiContextPreviewNodeIds}
          selectedPathIndexByNodeId={selectedPathIndexByNodeId}
          selectedPathLength={selectedPath.length}
          selectedParentId={rootIsSelected ? null : selectedParentId}
          focusWaveStartedAt={focusWaveStartedAt}
          notificationKind={notificationKindsByNodeId.get(focusParent.id) ?? null}
          notificationKindsByNodeId={notificationKindsByNodeId}
          notificationSnoozePrompt={activeNotificationSnoozePrompt}
          mobileLabelScope={mobileLabelScope}
          suppressParentEdge={false}
          renderQuality={renderQuality}
          theme={theme}
          layoutPositions={layoutPositions}
          visibleNodeIds={renderVisibleNodeIds}
          currentVisibleNodeIds={currentVisibleNodeIds}
          enteringNodeIds={enteringNodeIds}
          layoutMode={layoutMode}
          rootOverviewActive={rootIsSelected}
          onOpenNodeContextMenu={onOpenNodeContextMenu}
        />
      </group>
    );
  }

  return (
    <group>
      {atlasRoot.children.filter((node) => renderVisibleNodeIds.has(node.id)).map((node) => {
        const path = [atlasRoot, node];
        const position = getLayoutPosition(layoutPositions, node.id);
        const visibleDepthRemaining = layoutMode === "phyllotaxis" ? VISIBLE_DESCENDANT_DEPTH : GENERATED_LAYOUT_VISIBLE_DESCENDANT_DEPTH;
        return (
          <HierarchyNode
            key={node.id}
            node={node}
            path={path}
            worldPosition={position}
            localPosition={position}
            depth={1}
            visibleDepthRemaining={visibleDepthRemaining}
            visibleDepthIndex={0}
            selectedNodeId={effectiveSelectedNodeId}
            highlightSelectedNodeId={highlightSelectedNodeId}
            multiSelectedNodeIds={multiSelectedNodeIdSet}
            aiContextPreviewNodeIds={aiContextPreviewNodeIds}
            selectedPathIndexByNodeId={selectedPathIndexByNodeId}
            selectedPathLength={selectedPath.length}
            selectedParentId={rootIsSelected ? null : selectedParentId}
            focusWaveStartedAt={focusWaveStartedAt}
            notificationKind={notificationKindsByNodeId.get(node.id) ?? null}
            notificationKindsByNodeId={notificationKindsByNodeId}
            notificationSnoozePrompt={activeNotificationSnoozePrompt}
            mobileLabelScope={mobileLabelScope}
            suppressParentEdge={false}
            renderQuality={renderQuality}
            theme={theme}
            layoutPositions={layoutPositions}
            visibleNodeIds={renderVisibleNodeIds}
            currentVisibleNodeIds={currentVisibleNodeIds}
            enteringNodeIds={enteringNodeIds}
            layoutMode={layoutMode}
            rootOverviewActive={rootIsSelected}
            onOpenNodeContextMenu={onOpenNodeContextMenu}
          />
        );
      })}
    </group>
  );
}

function buildLowQualityRenderPaths(root: AtlasNode, selectedNodeId: string, notificationPulses: NotificationPulse[], aiContextPreviewNodeIds: Set<string>) {
  const entries: Array<{ path: AtlasNode[]; visibleDepthRemaining: number; suppressParentEdge: boolean }> = [];
  const added = new Set<string>();
  const selectedPath = findNodePath(root, selectedNodeId) ?? [root];
  const selectedNode = selectedPath[selectedPath.length - 1];

  const addPath = (path: AtlasNode[], visibleDepthRemaining: number, suppressParentEdge: boolean) => {
    const node = path[path.length - 1];
    if (!node || node.id === root.id || added.has(node.id)) return;
    added.add(node.id);
    markLowQualityRenderedDescendants(node, visibleDepthRemaining, added);
    entries.push({ path, visibleDepthRemaining, suppressParentEdge });
  };

  if (selectedNode.id === root.id) {
    root.children.forEach((child) => addPath([root, child], 1, false));
  } else {
    addPath(selectedPath, 2, selectedPath.length > 2);
  }

  for (const pulse of notificationPulses) {
    const path = findNodePath(root, pulse.nodeId);
    if (!path) continue;
    addPath(path, 0, path.length > 2);
  }

  for (const nodeId of aiContextPreviewNodeIds) {
    const path = findNodePath(root, nodeId);
    if (!path) continue;
    addPath(path, 0, path.length > 2);
  }

  return entries;
}

function buildNodeRenderMeta(root: AtlasNode) {
  const metaById = new Map<string, NodeRenderMeta>();
  const visit = (node: AtlasNode, pathIds: string[]) => {
    const nextPathIds = [...pathIds, node.id];
    metaById.set(node.id, {
      node,
      pathIds: nextPathIds,
    });
    node.children.forEach((child) => visit(child, nextPathIds));
  };
  visit(root, []);
  return metaById;
}

function buildMandatoryRenderNodeIds(rootId: string, metaById: Map<string, NodeRenderMeta>, nodeIds: Array<string | null | undefined> | Set<string>) {
  const ids = new Set<string>();
  for (const nodeId of nodeIds) {
    if (!nodeId) continue;
    addNodePathRenderIds(ids, metaById, nodeId);
  }
  ids.delete(rootId);
  return ids;
}

function buildCameraCulledNodeIds({
  camera,
  candidateNodeIds,
  mandatoryNodeIds,
  marginNdc,
  nodeRenderMetaById,
  now,
  positions,
  previousNodeIds,
  retainedUntil,
  rootId,
}: {
  camera: PerspectiveCamera;
  candidateNodeIds: Set<string>;
  mandatoryNodeIds: Set<string>;
  marginNdc: number;
  nodeRenderMetaById: Map<string, NodeRenderMeta>;
  now: number;
  positions: Map<string, Vec3>;
  previousNodeIds: Set<string> | null;
  retainedUntil: Map<string, number>;
  rootId: string;
}) {
  const nextNodeIds = new Set<string>();
  const projected = new Vector3();
  const forward = new Vector3();
  const toNode = new Vector3();
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  camera.getWorldDirection(forward);

  for (const nodeId of candidateNodeIds) {
    const position = positions.get(nodeId);
    if (!position) continue;
    toNode.set(position[0], position[1], position[2]).sub(camera.position);
    if (toNode.dot(forward) <= -NOTEBOOK_NODE_RADIUS) continue;
    projected.set(position[0], position[1], position[2]).project(camera);
    if (!isProjectedPositionInsideCullMargin(projected, marginNdc)) continue;
    addNodePathRenderIds(nextNodeIds, nodeRenderMetaById, nodeId);
  }

  for (const nodeId of mandatoryNodeIds) {
    if (!candidateNodeIds.has(nodeId)) continue;
    addNodePathRenderIds(nextNodeIds, nodeRenderMetaById, nodeId);
  }

  if (previousNodeIds) {
    for (const nodeId of previousNodeIds) {
      if (nodeId === rootId || nextNodeIds.has(nodeId) || !candidateNodeIds.has(nodeId) || !nodeRenderMetaById.has(nodeId)) {
        retainedUntil.delete(nodeId);
        continue;
      }
      const expiresAt = retainedUntil.get(nodeId) ?? now + CAMERA_CULL_HOLD_MS;
      if (expiresAt <= now) {
        retainedUntil.delete(nodeId);
        continue;
      }
      retainedUntil.set(nodeId, expiresAt);
      nextNodeIds.add(nodeId);
    }
  }

  nextNodeIds.delete(rootId);
  return nextNodeIds;
}

function mergeCameraRenderNodeIds(
  layoutNodeIds: Set<string>,
  cameraNodeIds: Set<string> | null,
  mandatoryNodeIds: Set<string>,
  rootId: string,
) {
  if (!cameraNodeIds) return layoutNodeIds;
  const merged = new Set<string>();
  for (const nodeId of layoutNodeIds) {
    if (nodeId === rootId) continue;
    if (cameraNodeIds.has(nodeId) || mandatoryNodeIds.has(nodeId)) merged.add(nodeId);
  }
  return merged;
}

function addNodePathRenderIds(target: Set<string>, metaById: Map<string, NodeRenderMeta>, nodeId: string) {
  const meta = metaById.get(nodeId);
  if (!meta) return;
  meta.pathIds.forEach((pathId) => target.add(pathId));
}

function isProjectedPositionInsideCullMargin(projected: Vector3, marginNdc: number) {
  return (
    projected.z >= -1 &&
    projected.z <= 1 &&
    Math.abs(projected.x) <= marginNdc &&
    Math.abs(projected.y) <= marginNdc
  );
}

function areSetsEqual(left: Set<string> | null, right: Set<string>) {
  if (!left || left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function getLayoutPosition(layoutPositions: Map<string, Vec3>, nodeId: string): Vec3 {
  return layoutPositions.get(nodeId) ?? [0, 0, 0];
}

function hasAiContextPreviewNode(node: AtlasNode, aiContextPreviewNodeIds: Set<string>): boolean {
  if (!aiContextPreviewNodeIds.size) return false;
  if (aiContextPreviewNodeIds.has(node.id)) return true;
  return node.children.some((child) => hasAiContextPreviewNode(child, aiContextPreviewNodeIds));
}

function markLowQualityRenderedDescendants(node: AtlasNode, visibleDepthRemaining: number, added: Set<string>) {
  if (visibleDepthRemaining <= 0) return;
  for (const child of node.children) {
    added.add(child.id);
    markLowQualityRenderedDescendants(child, visibleDepthRemaining - 1, added);
  }
}

function isStrictAncestorPath(ancestorPath: AtlasNode[] | null, descendantPath: AtlasNode[] | null) {
  if (!ancestorPath || !descendantPath || ancestorPath.length >= descendantPath.length) return false;
  return ancestorPath.every((node, index) => descendantPath[index]?.id === node.id);
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
  multiSelectedNodeIds,
  aiContextPreviewNodeIds,
  selectedPathIndexByNodeId,
  selectedPathLength,
  selectedParentId,
  focusWaveStartedAt,
  notificationKind,
  notificationKindsByNodeId,
  notificationSnoozePrompt,
  mobileLabelScope,
  suppressParentEdge,
  renderQuality,
  theme,
  layoutPositions,
  visibleNodeIds,
  currentVisibleNodeIds,
  enteringNodeIds,
  layoutMode,
  rootOverviewActive,
  onOpenNodeContextMenu,
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
  multiSelectedNodeIds: Set<string>;
  aiContextPreviewNodeIds: Set<string>;
  selectedPathIndexByNodeId: Map<string, number>;
  selectedPathLength: number;
  selectedParentId: string | null;
  focusWaveStartedAt: number;
  notificationKind: NotificationPulseKind | null;
  notificationKindsByNodeId: Map<string, NotificationPulseKind>;
  notificationSnoozePrompt: NotificationSnoozePromptState;
  mobileLabelScope: boolean;
  suppressParentEdge: boolean;
  renderQuality: RenderQuality;
  theme: AtlasTheme;
  layoutPositions: Map<string, Vec3>;
  visibleNodeIds: Set<string>;
  currentVisibleNodeIds: Set<string>;
  enteringNodeIds: Set<string>;
  layoutMode: AtlasLayoutMode;
  rootOverviewActive: boolean;
  onOpenNodeContextMenu: (menu: NodeContextMenuState) => void;
}) {
  const selectNodeInPlace = useAtlasStore((state) => state.selectNodeInPlace);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const toggleMultiSelectedNode = useAtlasStore((state) => state.toggleMultiSelectedNode);
  const moveNode = useAtlasStore((state) => state.moveNode);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const runNodeAction = useAtlasStore((state) => state.runNodeAction);
  const snoozeNodeNotification = useAtlasStore((state) => state.snoozeNodeNotification);
  const birthMarks = useAtlasStore((state) => state.birthMarks);
  const zoom = useAtlasStore((state) => state.viewport.zoom);
  const hiddenDragEdgeNodeId = useHiddenDragEdgeNodeId();
  const { camera, scene } = useThree();
  const perspective = camera as PerspectiveCamera;
  const isSelected = highlightSelectedNodeId === node.id;
  const isMultiSelected = multiSelectedNodeIds.has(node.id);
  const isAiContextPreviewNode = aiContextPreviewNodeIds.has(node.id);
  const previewNotificationKind = isAiContextPreviewNode ? "codex" : null;
  const effectiveNotificationKind = notificationKind === "error" ? notificationKind : previewNotificationKind ?? notificationKind;
  const parentId = path.length > 1 ? path[path.length - 2].id : null;
  const selectedIndexInPath = path.findIndex((item) => item.id === selectedNodeId);
  const canDragNodeInRootOverview = !rootOverviewActive || depth === 1;
  const layoutLocksNodeDrag = layoutMode !== "phyllotaxis";
  const dragFallsThroughToSpace = layoutLocksNodeDrag || (rootOverviewActive && !canDragNodeInRootOverview);
  const activeDescendantDistance =
    selectedIndexInPath >= 0 ? path.length - 1 - selectedIndexInPath : null;
  const activePathIndex = selectedPathIndexByNodeId.get(node.id);
  const activeAncestorDistance =
    typeof activePathIndex === "number" ? selectedPathLength - 1 - activePathIndex : null;
  const isDirectChildOfSelected = parentId === selectedNodeId;
  const isDirectParentOfSelected = activeAncestorDistance === 1;
  const isActiveAncestor = activeAncestorDistance !== null && activeAncestorDistance > 0;
  const isActiveSibling = selectedParentId !== null && parentId === selectedParentId && !isSelected;
  const isFocusedBranch = activeDescendantDistance !== null || isActiveAncestor;
  const themeColors = getUniverseThemeColors(theme);
  const structuralColor = theme === "light" ? themeColors.edge : node.color;
  const statusColor = getStatusColor(node.status);
  const ringColor = theme === "light" ? themeColors.ring : statusColor;
  const radius = getNodeVisualRadius(node, depth);
  const hitRadius = getNodeHitRadius(node, depth);
  const visualDepthIndex =
    activeDescendantDistance !== null
      ? activeDescendantDistance
      : activeAncestorDistance !== null
        ? Math.max(0, activeAncestorDistance - 1)
        : isActiveSibling
          ? 1
          : visibleDepthIndex;
  const depthFade = getLayoutAwareDepthFade(layoutMode, renderQuality, currentVisibleNodeIds.has(node.id), perspective, worldPosition, visualDepthIndex);
  const childrenVisible =
    visibleDepthRemaining > 0 &&
    node.children.length > 0 &&
    (layoutMode === "phyllotaxis" || node.children.some((child) => visibleNodeIds.has(child.id))) &&
    (isActiveAncestor ||
      (activeDescendantDistance !== null && activeDescendantDistance < VISIBLE_DESCENDANT_DEPTH) ||
      node.children.some((child) => hasAiContextPreviewNode(child, aiContextPreviewNodeIds)) ||
      layoutMode !== "phyllotaxis");
  const isLocalContextNode = isSelected || isMultiSelected || aiContextPreviewNodeIds.has(node.id) || isActiveAncestor || isActiveSibling || isDirectChildOfSelected;
  const mobileLabelVisible = isSelected || isDirectChildOfSelected;
  const lowQualityLabelVisible = isSelected || isDirectChildOfSelected;
  const labelVisible = renderQuality === "low"
    ? lowQualityLabelVisible
    : mobileLabelScope
    ? mobileLabelVisible
    : isLocalContextNode || (depth <= 1 ? zoom > 0.55 : zoom > getLabelZoom(depth));
  const interactiveLabelVisible = !mobileLabelScope || isSelected || isMultiSelected || isAiContextPreviewNode;
  const [layoutEdgeHidden, setLayoutEdgeHidden] = useState(false);
  const parentEdgeVisible = !suppressParentEdge && path.length > 2 && hiddenDragEdgeNodeId !== node.id && !layoutEdgeHidden;
  const lowQuality = renderQuality === "low";
  const rootActiveDirectChild = selectedNodeId === path[0]?.id && depth === 1;
  const hitSphereSegments: [number, number] = lowQuality ? [10, 6] : [20, 12];
  const planetSphereSegments: [number, number] = lowQuality
    ? depth <= 1
      ? [20, 12]
      : [14, 8]
    : depth <= 1
      ? [38, 20]
      : [28, 16];
  const showNotificationSnoozeActions = notificationSnoozePrompt?.nodeId === node.id && notificationSnoozePrompt.expiresAt > Date.now();
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
    startedAt: number;
    startWorld: Vec3Tuple;
    startPointerWorld: Vec3Tuple;
    currentWorld: Vec3Tuple;
    parentWorld?: Vec3Tuple;
    siblingCount: number;
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
    onboardingNodeDragEmitted?: boolean;
    suppressChildCreationForDrag: boolean;
    torn: boolean;
    shiftKey: boolean;
  } | null>(null);
  const passThroughPanRef = useRef<{
    pointerId: number;
    startScreen: { x: number; y: number };
    lastScreen: { x: number; y: number };
    shiftKey: boolean;
    hasPanned: boolean;
  } | null>(null);
  const groupRef = useRef<Group>(null);
  const parentWorldRef = useRef<Vec3Tuple>(subtractPosition(worldPosition, localPosition));
  const isNodeLayoutVisible = layoutMode === "phyllotaxis" || currentVisibleNodeIds.has(node.id);
  const isEnteringLayout = layoutMode !== "phyllotaxis" && renderQuality !== "low" && enteringNodeIds.has(node.id);
  const initialVisualWorld = isEnteringLayout ? getBackstagePosition(worldPosition) : worldPosition;
  const visualWorldRef = useRef<Vec3Tuple>(initialVisualWorld);
  const layoutTransitionRef = useRef<{
    startWorld: Vec3Tuple;
    targetWorld: Vec3Tuple;
    parentWorld: Vec3Tuple;
    elapsed: number;
    delay: number;
    duration: number;
    kind: "move" | "enter" | "exit";
  } | null>(null);
  const nodeHitRaycast = useMemo(() => createConditionalMeshRaycast(() => shouldSkipNodeRaycast(node.id)), [node.id]);
  const applyVisualWorldPositionRef = useRef<(nextWorld: Vec3Tuple, parentWorldOverride?: Vec3Tuple) => void>(() => undefined);
  const birthStartedAt = birthMarks[node.id];

  applyVisualWorldPositionRef.current = (nextWorld, parentWorldOverride) => {
    const parentWorld = parentWorldOverride ?? getVisualParentWorld(path, parentWorldRef.current);
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
    if (dragRef.current) return;
    if (layoutMode === "phyllotaxis" || renderQuality === "low") {
      layoutTransitionRef.current = null;
      setLayoutEdgeHidden(false);
      applyVisualWorldPosition(worldPosition, parentWorld);
      groupRef.current?.scale.setScalar(1);
      return;
    }

    const targetWorld = isNodeLayoutVisible ? worldPosition : getBackstagePosition(worldPosition);
    const currentWorld = visualWorldRef.current;
    if (distanceBetweenPositions(currentWorld, targetWorld) <= 0.01) {
      layoutTransitionRef.current = null;
      setLayoutEdgeHidden(false);
      applyVisualWorldPosition(targetWorld, parentWorld);
      groupRef.current?.scale.setScalar(isNodeLayoutVisible ? 1 : 0.56);
      return;
    }
    const transitionKind: "move" | "enter" | "exit" = isNodeLayoutVisible ? (isEnteringLayout ? "enter" : "move") : "exit";
    const existingTransition = layoutTransitionRef.current;
    if (
      existingTransition &&
      (existingTransition.kind === transitionKind || (existingTransition.kind === "enter" && transitionKind === "move")) &&
      distanceBetweenPositions(existingTransition.targetWorld, targetWorld) <= 0.01 &&
      distanceBetweenPositions(existingTransition.parentWorld, parentWorld) <= 0.01
    ) {
      return;
    }
    layoutTransitionRef.current = {
      startWorld: currentWorld,
      targetWorld,
      parentWorld,
      elapsed: 0,
      delay: getLayoutMotionDelay(visualDepthIndex),
      duration: LAYOUT_MOTION_DURATION_SECONDS,
      kind: transitionKind,
    };
    setLayoutEdgeHidden(true);
  }, [
    isEnteringLayout,
    isNodeLayoutVisible,
    layoutMode,
    localPosition[0],
    localPosition[1],
    localPosition[2],
    renderQuality,
    visualDepthIndex,
    worldPosition[0],
    worldPosition[1],
    worldPosition[2],
  ]);

  useFrame((_, delta) => {
    const transition = layoutTransitionRef.current;
    if (!transition || dragRef.current) return;
    transition.elapsed += delta;
    const delayedElapsed = Math.max(0, transition.elapsed - transition.delay);
    const progress = Math.min(1, delayedElapsed / transition.duration);
    const eased = getLayoutMotionProgress(progress, renderQuality);
    const nextWorld = lerpPosition(transition.startWorld, transition.targetWorld, eased);
    applyVisualWorldPosition(nextWorld, getVisualParentWorld(path, transition.parentWorld));
    groupRef.current?.scale.setScalar(getNodeTransitionScale(progress, transition.kind));
    if (progress >= 1) {
      layoutTransitionRef.current = null;
      applyVisualWorldPosition(transition.targetWorld, getVisualParentWorld(path, transition.parentWorld));
      groupRef.current?.scale.setScalar(transition.kind === "exit" ? 0.56 : 1);
      setLayoutEdgeHidden(false);
    }
  });

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

  useEffect(
    () => () => {
      if (mobileRaycastMode.kind === "node-drag" && mobileRaycastMode.nodeId === node.id) {
        setMobileRaycastMode({ kind: "idle" });
      }
      passThroughPanRef.current = null;
    },
    [node.id],
  );

  const completeBirthingDrag = (
    drag: NonNullable<typeof dragRef.current>,
    pointerWorld: [number, number, number],
  ) => {
    if (drag.stage !== "birthing") return;
    drag.stage = "handoff";
    drag.torn = true;
    const freezeWorld = drag.freezeWorld ?? drag.startWorld;
    const tearVector = drag.tearVector ?? subtractPosition(pointerWorld, freezeWorld);
    const childCount = node.children.length + 1;
    const childWorld = clampWorldForDepth(pointerWorld, depth + 1, drag.currentWorld, childCount);
    const angle = Math.atan2(tearVector[1], tearVector[0]);
    const childId = addChildNode(node.id, "", {
      title: "Untitled node",
      position: childWorld,
      insertIndex: angleToInsertIndex(angle, childCount),
      focus: false,
      persist: false,
    });

    if (childId) {
      emitOnboardingEvent("child-node-created", { childDepth: depth + 1 });
      drag.handoffChildId = childId;
      drag.handoffLayerRadius = getShellRadius(depth + 1);
      drag.handoffChildWorld = childWorld;
      setDragBoundary({
        depth: depth + 1,
        parentWorldPosition: drag.currentWorld,
        siblingCount: childCount,
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
    if (event.button === 2) {
      event.stopPropagation();
      if (node.id === "atlas-root") return;
      selectNodeInPlace(node.id);
      setMobileRaycastMode({ kind: "idle" });
      dragRef.current = null;
      passThroughPanRef.current = null;
      setDragVisual(null);
      setDragBoundary(null);
      setHiddenDragEdgeNodeId(null);
      onOpenNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
      return;
    }
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    if (dragFallsThroughToSpace) {
      passThroughPanRef.current = {
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        lastScreen: { x: event.clientX, y: event.clientY },
        shiftKey: event.nativeEvent.shiftKey,
        hasPanned: false,
      };
      return;
    }
    const layerRadius = vectorLength(worldPosition);
    setMobileRaycastMode({ kind: "node-drag", nodeId: node.id });
    dragRef.current = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      lastScreen: { x: event.clientX, y: event.clientY },
      lastAt: performance.now(),
      startedAt: performance.now(),
      startWorld: worldPosition,
      startPointerWorld: intersectRaySphere(event.ray, layerRadius),
      currentWorld: worldPosition,
      parentWorld: path.length > 2 ? getLayoutPosition(layoutPositions, path[path.length - 2].id) : undefined,
      siblingCount: path.length > 2 ? path[path.length - 2].children.length : 1,
      layerRadius,
      stage: "moving",
      canCreateChild: true,
      samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }],
      hasMoved: false,
      suppressChildCreationForDrag: getOnboardingCurrentSpaceStep() === "nodeDrag",
      torn: false,
      shiftKey: event.nativeEvent.shiftKey,
    };
    setHiddenDragEdgeNodeId(node.id);
    setDragBoundary({
      depth,
      parentWorldPosition: path.length > 2 ? getLayoutPosition(layoutPositions, path[path.length - 2].id) : undefined,
      siblingCount: path.length > 2 ? path[path.length - 2].children.length : undefined,
    });
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    const passThroughPan = passThroughPanRef.current;
    if (passThroughPan?.pointerId === event.pointerId) {
      event.stopPropagation();
      const deltaX = event.clientX - passThroughPan.lastScreen.x;
      const deltaY = event.clientY - passThroughPan.lastScreen.y;
      const screenDistance = Math.hypot(event.clientX - passThroughPan.startScreen.x, event.clientY - passThroughPan.startScreen.y);
      if (screenDistance > 3 && (Math.abs(deltaX) >= 0.01 || Math.abs(deltaY) >= 0.01)) {
        passThroughPan.hasPanned = true;
        window.dispatchEvent(new CustomEvent<UniversePanDeltaDetail>(UNIVERSE_PAN_DELTA_EVENT, { detail: { deltaX, deltaY } }));
      }
      passThroughPan.lastScreen = { x: event.clientX, y: event.clientY };
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();

    if (drag.handoffChildId && drag.handoffLayerRadius) {
      const childWorld = clampWorldForDepth(
        intersectRaySphere(event.ray, drag.handoffLayerRadius),
        depth + 1,
        drag.currentWorld,
        node.children.length + 1,
      );
      drag.handoffChildWorld = childWorld;
      syncVisualNodePosition(drag.handoffChildId, childWorld, drag.currentWorld);
      drag.lastScreen = { x: event.clientX, y: event.clientY };
      drag.lastAt = performance.now();
      return;
    }

    const rawPointerWorld = intersectRaySphere(event.ray, drag.layerRadius);
    const pointerWorld = addTuple(drag.startWorld, subtractPosition(rawPointerWorld, drag.startPointerWorld));
    const now = performance.now();
    const screenDistance = Math.hypot(event.clientX - drag.startScreen.x, event.clientY - drag.startScreen.y);
    if (!drag.onboardingNodeDragEmitted && drag.hasMoved && now - drag.startedAt >= 1000) {
      drag.onboardingNodeDragEmitted = true;
      emitOnboardingEvent("node-drag");
    }

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
      const clampedPointerWorld = clampWorldForDepth(pointerWorld, depth, drag.parentWorld, drag.siblingCount);
      drag.currentWorld = clampedPointerWorld;
      drag.hasMoved = true;
      if (!drag.onboardingNodeDragEmitted && now - drag.startedAt >= 1000) {
        drag.onboardingNodeDragEmitted = true;
        emitOnboardingEvent("node-drag");
      }
      applyVisualWorldPosition(clampedPointerWorld);
      if (
        drag.canCreateChild &&
        !drag.suppressChildCreationForDrag &&
        movedEnoughInRecentWindow(drag, event.clientX, event.clientY, now)
      ) {
        const initialWorld = drag.startWorld;
        drag.stage = "armed";
        drag.torn = true;
        drag.freezeWorld = initialWorld;
        drag.armedPointerWorld = initialWorld;
        drag.currentWorld = initialWorld;
        drag.hasMoved = false;
        drag.samples = [];
        applyVisualWorldPosition(initialWorld);
        setDragVisual({ x: 0, y: 0, z: 0, tension: 0 });
      }
    }

    drag.lastScreen = { x: event.clientX, y: event.clientY };
    drag.lastAt = now;
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    const passThroughPan = passThroughPanRef.current;
    if (passThroughPan?.pointerId === event.pointerId) {
      event.stopPropagation();
      const screenDistance = Math.hypot(event.clientX - passThroughPan.startScreen.x, event.clientY - passThroughPan.startScreen.y);
      passThroughPanRef.current = null;
      if (!passThroughPan.hasPanned && screenDistance <= 6) {
        if (passThroughPan.shiftKey || event.nativeEvent.shiftKey) {
          toggleMultiSelectedNode(node.id);
        } else {
          focusNode(node.id);
        }
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const screenDistance = Math.hypot(event.clientX - drag.startScreen.x, event.clientY - drag.startScreen.y);
    if (!drag.torn && screenDistance <= 3) {
      if (drag.shiftKey || event.nativeEvent.shiftKey) {
        toggleMultiSelectedNode(node.id);
      } else {
        focusNode(node.id);
      }
    }
    dragRef.current = null;
    setMobileRaycastMode({ kind: "idle" });
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
          color={structuralColor}
          transparent
          opacity={(isFocusedBranch ? (theme === "light" ? 0.46 : 0.28) : theme === "light" ? 0.22 : 0.12) * depthFade.opacity}
          lineWidth={0.6}
        />
      ) : null}

      {dragVisual ? (
        <ElasticTether
          vector={[dragVisual.x, dragVisual.y, dragVisual.z]}
          color={structuralColor}
          theme={theme}
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
          color={structuralColor}
          theme={theme}
          parentWorldPosition={dragBoundary.parentWorldPosition}
          siblingCount={dragBoundary.siblingCount}
        />,
          scene,
        )
        : null}

      <CameraFacingGroup>
        <NodeFocusRing
          radius={radius}
          baseColor={ringColor}
          isSelected={isSelected || isMultiSelected || isAiContextPreviewNode}
          status={node.status}
          depthFade={depthFade}
          waveDepth={focusWaveDepth}
          waveStartedAt={focusWaveStartedAt}
          notificationKind={effectiveNotificationKind}
          renderQuality={renderQuality}
          theme={theme}
        />
        {birthStartedAt ? <BirthRing startedAt={birthStartedAt} radius={radius} color={structuralColor} /> : null}
      </CameraFacingGroup>

      <mesh
        raycast={nodeHitRaycast}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => {
          event.stopPropagation();
          event.nativeEvent.preventDefault();
          if (node.id === "atlas-root") return;
          if (!isSelected) selectNodeInPlace(node.id);
          onOpenNodeContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          focusNode(node.id);
        }}
      >
        <sphereGeometry args={[hitRadius, hitSphereSegments[0], hitSphereSegments[1]]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group rotation={[0, 0, stretchAngle]}>
        <mesh
          scale={[1 + stretch, 1 - stretch * 0.34, 1 + stretch * 0.08]}
        >
          <sphereGeometry args={[radius, planetSphereSegments[0], planetSphereSegments[1]]} />
          {lowQuality ? (
            <LowQualityPlanetMaterial node={node} depthFade={depthFade} rootActiveDirectChild={rootActiveDirectChild} theme={theme} />
          ) : (
            <PlanetMaterial node={node} depthFade={depthFade} theme={theme} />
          )}
        </mesh>
      </group>
      {!lowQuality ? (
        <mesh position={[-radius * 0.28, radius * 0.32, radius * 0.72]}>
          <sphereGeometry args={[Math.max(1.8, radius * 0.18), 16, 10]} />
          <meshBasicMaterial color={themeColors.specular} transparent opacity={(theme === "light" ? 0.56 : 0.7) * depthFade.opacity} />
        </mesh>
      ) : null}

      {node.action && node.id === selectedNodeId ? (
        <Html center position={[0, 0, radius + 22]} transform={false} zIndexRange={[5, 1]}>
          <button
            className={`node-action-button ${node.action.kind === "codex_full_access" && node.action.decision === "deny" ? "is-deny" : "is-approve"}`}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void runNodeAction(node.id);
            }}
          >
            {node.action.label}
          </button>
        </Html>
      ) : null}

      {showNotificationSnoozeActions ? (
        <Html center position={[0, 0, radius + (node.action ? 62 : 26)]} transform={false} zIndexRange={[6, 2]}>
          <div className="node-snooze-actions" role="group" aria-label="Snooze notification">
            {NOTIFICATION_SNOOZE_OPTIONS.map((option) => (
              <button
                key={option.label}
                className="node-snooze-button"
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  snoozeNodeNotification(node.id, option.delayMs);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Html>
      ) : null}

      {childrenVisible
        ? node.children.filter((child) => visibleNodeIds.has(child.id)).map((child) => {
            const childPath = [...path, child];
            const childWorldPosition = getLayoutPosition(layoutPositions, child.id);
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
                multiSelectedNodeIds={multiSelectedNodeIds}
                aiContextPreviewNodeIds={aiContextPreviewNodeIds}
                selectedPathIndexByNodeId={selectedPathIndexByNodeId}
                selectedPathLength={selectedPathLength}
                selectedParentId={selectedParentId}
                focusWaveStartedAt={focusWaveStartedAt}
                notificationKind={notificationKindsByNodeId.get(child.id) ?? null}
                notificationKindsByNodeId={notificationKindsByNodeId}
                notificationSnoozePrompt={notificationSnoozePrompt}
                mobileLabelScope={mobileLabelScope}
                suppressParentEdge={suppressParentEdge}
                renderQuality={renderQuality}
                theme={theme}
                layoutPositions={layoutPositions}
                visibleNodeIds={visibleNodeIds}
                currentVisibleNodeIds={currentVisibleNodeIds}
                enteringNodeIds={enteringNodeIds}
                layoutMode={layoutMode}
                rootOverviewActive={rootOverviewActive}
                onOpenNodeContextMenu={onOpenNodeContextMenu}
              />
            );
          })
        : null}

      {labelVisible ? (
        <Html center position={[0, -radius - 14, 16]} transform={false} zIndexRange={[2, 0]}>
          {interactiveLabelVisible ? (
            <SpaceNodeEditor
              node={node}
              isSelected={isSelected || isMultiSelected}
              isPrimarySelected={isSelected}
              onSelect={() => selectNodeInPlace(node.id)}
              onFocusNode={() => focusNode(node.id)}
              onChange={(title) =>
                updateNode(node.id, {
                  title,
                })
              }
            />
          ) : (
            <SpaceNodePreview
              node={node}
              isSelected={isSelected || isMultiSelected}
              onFocusNode={() => focusNode(node.id)}
            />
          )}
        </Html>
      ) : null}
    </group>
  );
}

function SpaceNodePreview({
  node,
  isSelected,
  onFocusNode,
}: {
  node: AtlasNode;
  isSelected: boolean;
  onFocusNode: () => void;
}) {
  const text = node.title.trim() || "ここに記入";
  return (
    <div
      className={`node-text-card node-text-preview space-title-preview space-body-preview ${isSelected ? "is-selected" : ""}`}
      data-node-id={node.id}
      role="button"
      tabIndex={0}
      aria-label={`${node.title || "Node"} title preview`}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onFocusNode();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onFocusNode();
      }}
    >
      {text}
    </div>
  );
}

function SpaceNodeEditor({
  node,
  isSelected,
  isPrimarySelected,
  onSelect,
  onFocusNode,
  onChange,
}: {
  node: AtlasNode;
  isSelected: boolean;
  isPrimarySelected: boolean;
  onSelect: () => void;
  onFocusNode: () => void;
  onChange: (title: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const suppressMobileEditClickRef = useRef(false);
  const titleEditRequestId = useAtlasStore((state) => state.titleEditRequestId);
  const consumeTitleEditRequest = useAtlasStore((state) => state.consumeTitleEditRequest);
  const displayTitle = node.title || "";
  const [draftTitle, setDraftTitle] = useState(displayTitle);

  useLayoutEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draftTitle]);

  useEffect(() => {
    if (composingRef.current) return;
    setDraftTitle(displayTitle);
  }, [displayTitle, node.id]);

  useEffect(() => {
    if (titleEditRequestId !== node.id) return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      onSelect();
      textarea.focus({ preventScroll: true });
      const cursorPosition = textarea.value.length;
      textarea.setSelectionRange(cursorPosition, cursorPosition);
      resizeTextarea(textarea);
      consumeTitleEditRequest();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [consumeTitleEditRequest, node.id, onSelect, titleEditRequestId]);

  return (
    <textarea
      ref={textareaRef}
      className={`node-text-card node-text-editor space-title-editor space-body-editor ${isSelected ? "is-selected" : ""}`}
      data-node-id={node.id}
      data-selected={isPrimarySelected ? "true" : "false"}
      value={draftTitle}
      rows={1}
      placeholder="ここに記入"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (isMobilePointerEvent(event) && !isPrimarySelected) {
          event.preventDefault();
          suppressMobileEditClickRef.current = true;
          onFocusNode();
          event.currentTarget.blur();
          return;
        }
        onSelect();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressMobileEditClickRef.current) {
          suppressMobileEditClickRef.current = false;
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        onSelect();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (composingRef.current || event.nativeEvent.isComposing) return;
        if (event.key === "Tab") {
          event.preventDefault();
          const textarea = event.currentTarget;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const nextTitle = `${draftTitle.slice(0, start)}\t${draftTitle.slice(end)}`;
          setDraftTitle(nextTitle);
          onChange(nextTitle);
          window.requestAnimationFrame(() => {
            textarea.setSelectionRange(start + 1, start + 1);
            resizeTextarea(textarea);
          });
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onChange(event.currentTarget.value);
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onChange(event.currentTarget.value);
          event.currentTarget.blur();
        }
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const nextTitle = event.currentTarget.value;
        setDraftTitle(nextTitle);
        onChange(nextTitle);
        resizeTextarea(event.currentTarget);
      }}
      onChange={(event) => {
        const nextTitle = event.target.value;
        setDraftTitle(nextTitle);
        if (!composingRef.current && !isInputComposing(event.nativeEvent)) {
          onChange(nextTitle);
        }
        resizeTextarea(event.currentTarget);
      }}
      aria-label={`${node.title || "Node"} title`}
    />
  );
}

function isInputComposing(event: Event) {
  return event instanceof InputEvent && event.isComposing;
}

function isMobilePointerEvent(event: { pointerType?: string }) {
  return event.pointerType === "touch" || event.pointerType === "pen";
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, getTextareaMaxHeight(textarea))}px`;
  textarea.style.overflowY = textarea.scrollHeight > getTextareaMaxHeight(textarea) ? "auto" : "hidden";
}

function getTextareaMaxHeight(textarea: HTMLTextAreaElement) {
  const styles = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 18;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const maxLines = Number.parseInt(styles.getPropertyValue("--space-label-max-lines"), 10) || 4;
  return lineHeight * maxLines + paddingTop + paddingBottom;
}

function LowQualityPlanetMaterial({
  node,
  depthFade,
  rootActiveDirectChild,
  theme,
}: {
  node: AtlasNode;
  depthFade: ReturnType<typeof getDepthFade>;
  rootActiveDirectChild: boolean;
  theme: AtlasTheme;
}) {
  const materialColor = useMemo(() => {
    const lightDepthIndex = rootActiveDirectChild ? 0 : depthFade.index;
    const color = theme === "light"
      ? getLowQualityLightThemeBaseColor(new Color(node.color), lightDepthIndex, rootActiveDirectChild)
      : new Color(node.color);
    const backgroundColor = new Color(getUniverseThemeColors(theme).background);
    const depthBlend = rootActiveDirectChild && theme === "light"
      ? 0.02
      : getLowQualityDepthBlend(depthFade.index, theme);
    return color.lerp(backgroundColor, depthBlend);
  }, [depthFade.index, node.color, rootActiveDirectChild, theme]);

  return <meshBasicMaterial color={materialColor} />;
}

function getLowQualityLightThemeBaseColor(color: Color, index: number, rootActiveDirectChild = false) {
  const capped = Math.min(2, Math.max(0, index));
  const whiteRemoval = rootActiveDirectChild ? 0.78 : capped <= 1 ? 0.58 : 0.42;
  const sharedWhite = Math.min(color.r, color.g, color.b) * whiteRemoval;

  if (sharedWhite > 0.001 && sharedWhite < 0.98) {
    const scale = 1 / (1 - sharedWhite);
    color.setRGB(
      clamp01((color.r - sharedWhite) * scale),
      clamp01((color.g - sharedWhite) * scale),
      clamp01((color.b - sharedWhite) * scale),
    );
  }

  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const targetLuminance = rootActiveDirectChild ? 0.5 : capped <= 1 ? 0.54 : 0.62;
  if (luminance > targetLuminance) {
    color.multiplyScalar(targetLuminance / luminance);
  }
  return color;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getLowQualityDepthBlend(index: number, theme: AtlasTheme) {
  if (index <= 0) return 0;
  const capped = Math.min(2, index);
  if (theme === "light") {
    return capped === 1 ? 0.16 : 0.38;
  }
  return capped === 1 ? 0.76 : 0.92;
}

function PlanetMaterial({
  node,
  depthFade,
  theme,
}: {
  node: AtlasNode;
  depthFade: ReturnType<typeof getDepthFade>;
  theme: AtlasTheme;
}) {
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const lightSurfaceWash = theme === "light" ? getLightThemeDepthWash(depthFade.index) : 0;
  const fallbackTexture = useMemo(
    () => createPlanetTexture(node.color, node.texture, node.id, lightSurfaceWash),
    [lightSurfaceWash, node.color, node.id, node.texture],
  );
  const surfaceAttachment = useMemo(
    () => getNodeSurfaceAttachment(node.attachments, attachmentPreviewUrls),
    [attachmentPreviewUrls, node.attachments],
  );
  const attachmentTexture = useAttachmentSurfaceTexture(surfaceAttachment, node.color);
  const texture = attachmentTexture ?? fallbackTexture;
  const hasAttachmentTexture = Boolean(attachmentTexture);
  const materialColor = useMemo(() => {
    const color = new Color(hasAttachmentTexture ? "#ffffff" : node.color);
    if (theme === "light") {
      return color.lerp(new Color("#ffffff"), hasAttachmentTexture ? lightSurfaceWash * 0.42 : lightSurfaceWash);
    }
    return color.multiplyScalar(hasAttachmentTexture ? Math.max(0.62, depthFade.brightness) : depthFade.brightness);
  }, [depthFade.brightness, hasAttachmentTexture, lightSurfaceWash, node.color, theme]);
  const emissive = useMemo(() => new Color(node.color), [node.color]);

  return (
    <meshStandardMaterial
      color={materialColor}
      map={texture}
      emissive={emissive}
      emissiveIntensity={(theme === "light" ? 0.03 : 0.12) * depthFade.brightness}
      roughness={0.66}
      metalness={0.04}
    />
  );
}

type AttachmentSurface =
  | {
      id: string;
      kind: "image" | "video";
      name: string;
      mimeType: string;
      url?: string;
    }
  | {
      id: string;
      kind: "file" | "audio";
      name: string;
      mimeType: string;
      url?: string;
    };

function useAttachmentSurfaceTexture(surface: AttachmentSurface | null, baseColor: string) {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  const textureRef = useRef<CanvasTexture | null>(null);

  useEffect(() => {
    textureRef.current = texture;
  }, [texture]);

  useEffect(() => {
    let cancelled = false;

    const setNextTexture = (nextTexture: CanvasTexture | null) => {
      if (cancelled) {
        nextTexture?.dispose();
        return;
      }
      setTexture((previous) => {
        if (previous !== nextTexture) previous?.dispose();
        return nextTexture;
      });
    };

    if (!surface) {
      setNextTexture(null);
      return () => {
        cancelled = true;
      };
    }

    const fallback = createAttachmentIconTexture(surface, baseColor);
    setNextTexture(fallback);

    if (surface.kind === "image" && surface.url) {
      void createImageAttachmentTexture(surface.url, baseColor)
        .then(setNextTexture)
        .catch(() => undefined);
    }

    if (surface.kind === "video" && surface.url) {
      void createVideoAttachmentTexture(surface.url, baseColor, surface.name)
        .then(setNextTexture)
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [baseColor, surface?.id, surface?.kind, surface?.mimeType, surface?.name, surface?.url]);

  useEffect(() => {
    return () => {
      textureRef.current?.dispose();
      textureRef.current = null;
    };
  }, []);

  return texture;
}

function getNodeSurfaceAttachment(
  attachments: AtlasNode["attachments"],
  previewUrls: Record<string, string>,
): AttachmentSurface | null {
  const attachment = [...attachments].reverse()[0];
  if (!attachment) return null;
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
    url: previewUrls[attachment.id],
  };
}

function createImageAttachmentTexture(url: string, baseColor: string) {
  return new Promise<CanvasTexture>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(createMediaCanvasTexture(image, baseColor));
    image.onerror = () => reject(new Error("Image attachment texture failed to load."));
    image.src = url;
  });
}

function createVideoAttachmentTexture(url: string, baseColor: string, name: string) {
  return new Promise<CanvasTexture>((resolve, reject) => {
    const video = document.createElement("video");
    let finished = false;
    const timeout = window.setTimeout(() => rejectOnce(), 2200);

    const rejectOnce = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      reject(new Error("Video attachment thumbnail failed to load."));
    };

    const resolveOnce = () => {
      if (finished || !video.videoWidth || !video.videoHeight) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve(createMediaCanvasTexture(video, baseColor, { video: true, label: getFileExtensionLabel(name) || "VIDEO" }));
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const seekTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1, video.duration * 0.08) : 0;
      try {
        video.currentTime = seekTime;
      } catch {
        resolveOnce();
      }
    };
    video.onloadeddata = resolveOnce;
    video.onseeked = resolveOnce;
    video.onerror = rejectOnce;
    video.src = url;
    video.load();
  });
}

function createMediaCanvasTexture(
  source: CanvasImageSource,
  baseColor: string,
  options: { video?: boolean; label?: string } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return finalizeAttachmentCanvasTexture(canvas);

  context.fillStyle = baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawCoveredImage(context, source, canvas.width, canvas.height);
  context.fillStyle = "rgba(0, 0, 0, 0.18)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawTextureEdgeShade(context, canvas.width, canvas.height);

  if (options.video) {
    drawPlayBadge(context, canvas.width / 2, canvas.height / 2, 23);
    drawAttachmentLabel(context, options.label ?? "VIDEO", canvas.width, canvas.height);
  }

  return finalizeAttachmentCanvasTexture(canvas);
}

function createAttachmentIconTexture(surface: AttachmentSurface, baseColor: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return finalizeAttachmentCanvasTexture(canvas);

  const extension = getFileExtensionLabel(surface.name);
  const profile = getAttachmentIconProfile(surface, extension);
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, blendHex(baseColor, profile.color, 0.74));
  gradient.addColorStop(1, blendHex("#07110e", profile.color, 0.28));
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(62, 22);
  drawDocumentShape(context, profile);
  context.restore();

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = "700 21px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(profile.label, 122, 50);

  context.fillStyle = "rgba(255, 255, 255, 0.66)";
  context.font = "600 12px system-ui, sans-serif";
  context.fillText(profile.caption, 122, 76);

  drawTextureEdgeShade(context, canvas.width, canvas.height);

  return finalizeAttachmentCanvasTexture(canvas);
}

function finalizeAttachmentCanvasTexture(canvas: HTMLCanvasElement) {
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function drawCoveredImage(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number) {
  const sourceWidth =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth || source.width
        : "width" in source
          ? Number(source.width)
          : width;
  const sourceHeight =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight || source.height
        : "height" in source
          ? Number(source.height)
          : height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawTextureEdgeShade(context: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(255,255,255,0.22)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.34)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawPlayBadge(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.fillStyle = "rgba(0, 0, 0, 0.48)";
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.beginPath();
  context.moveTo(x - radius * 0.28, y - radius * 0.42);
  context.lineTo(x - radius * 0.28, y + radius * 0.42);
  context.lineTo(x + radius * 0.46, y);
  context.closePath();
  context.fill();
}

function drawAttachmentLabel(context: CanvasRenderingContext2D, label: string, width: number, height: number) {
  context.fillStyle = "rgba(0, 0, 0, 0.46)";
  context.fillRect(0, height - 28, width, 28);
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font = "700 13px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label.slice(0, 8), width / 2, height - 14);
}

type AttachmentIconProfile = {
  label: string;
  caption: string;
  color: string;
  variant: "document" | "spreadsheet" | "presentation" | "archive" | "code" | "data" | "image" | "audio" | "video" | "app";
};

function getAttachmentIconProfile(surface: AttachmentSurface, extension: string): AttachmentIconProfile {
  if (surface.kind === "image") return { label: extension || "IMG", caption: "image", color: "#4ea4ff", variant: "image" };
  if (surface.kind === "video") return { label: extension || "VIDEO", caption: "video", color: "#e85f7d", variant: "video" };
  if (surface.kind === "audio") return { label: extension || "AUDIO", caption: "audio", color: "#b26cff", variant: "audio" };

  if (["XLS", "XLSX", "CSV", "TSV", "ODS"].includes(extension)) {
    return { label: extension || "SHEET", caption: "spreadsheet", color: "#2fbf7b", variant: "spreadsheet" };
  }
  if (["PPT", "PPTX", "KEY", "ODP"].includes(extension)) {
    return { label: extension || "SLIDE", caption: "presentation", color: "#f26b3a", variant: "presentation" };
  }
  if (["ZIP", "RAR", "7Z", "TAR", "GZ", "BZ2"].includes(extension)) {
    return { label: extension || "ZIP", caption: "archive", color: "#d7a72f", variant: "archive" };
  }
  if (["JSON", "YAML", "YML", "XML", "TOML"].includes(extension)) {
    return { label: extension || "DATA", caption: "data", color: "#32b6b0", variant: "data" };
  }
  if (["JS", "TS", "TSX", "JSX", "HTML", "CSS", "PY", "RB", "GO", "RS", "JAVA", "C", "CPP", "H", "HPP", "CS", "PHP", "SH", "SQL"].includes(extension)) {
    return { label: extension || "CODE", caption: "code", color: "#6f8cff", variant: "code" };
  }
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "AVIF"].includes(extension)) {
    return { label: extension || "IMG", caption: "image", color: "#4ea4ff", variant: "image" };
  }
  if (["MP4", "MOV", "AVI", "MKV", "WEBM", "M4V"].includes(extension)) {
    return { label: extension || "VIDEO", caption: "video", color: "#e85f7d", variant: "video" };
  }
  if (["MP3", "WAV", "OGG", "M4A", "FLAC", "AAC"].includes(extension)) {
    return { label: extension || "AUDIO", caption: "audio", color: "#b26cff", variant: "audio" };
  }
  if (["EXE", "DMG", "PKG", "APK", "MSI"].includes(extension)) {
    return { label: extension || "APP", caption: "application", color: "#8896a8", variant: "app" };
  }
  if (["PDF", "DOC", "DOCX", "TXT", "MD", "RTF", "ODT"].includes(extension) || surface.mimeType.startsWith("text/")) {
    return { label: extension || "TEXT", caption: "document", color: "#e1e6ef", variant: "document" };
  }
  return { label: extension || "FILE", caption: "file", color: "#9aa7b6", variant: "document" };
}

function drawDocumentShape(context: CanvasRenderingContext2D, profile: AttachmentIconProfile) {
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.beginPath();
  context.roundRect(0, 0, 46, 66, 5);
  context.fill();
  context.fillStyle = "rgba(0,0,0,0.14)";
  context.beginPath();
  context.moveTo(32, 0);
  context.lineTo(46, 14);
  context.lineTo(32, 14);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(15, 22, 30, 0.28)";
  context.lineWidth = 2;

  if (profile.variant === "spreadsheet") {
    for (let x = 11; x <= 35; x += 12) {
      context.beginPath();
      context.moveTo(x, 20);
      context.lineTo(x, 52);
      context.stroke();
    }
    for (let y = 28; y <= 44; y += 8) {
      context.beginPath();
      context.moveTo(8, y);
      context.lineTo(38, y);
      context.stroke();
    }
    return;
  }

  if (profile.variant === "presentation") {
    context.strokeRect(9, 22, 28, 20);
    context.beginPath();
    context.moveTo(23, 42);
    context.lineTo(23, 54);
    context.moveTo(14, 54);
    context.lineTo(32, 54);
    context.stroke();
    return;
  }

  if (profile.variant === "archive") {
    context.beginPath();
    context.moveTo(23, 17);
    context.lineTo(23, 55);
    context.stroke();
    for (let y = 20; y < 54; y += 8) {
      context.fillStyle = y % 16 === 4 ? "rgba(15,22,30,0.3)" : "rgba(15,22,30,0.16)";
      context.fillRect(19, y, 8, 5);
    }
    return;
  }

  if (profile.variant === "code" || profile.variant === "data") {
    context.font = "700 22px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(15, 22, 30, 0.46)";
    context.fillText(profile.variant === "code" ? "</>" : "{}", 23, 39);
    return;
  }

  if (profile.variant === "image") {
    context.beginPath();
    context.moveTo(8, 48);
    context.lineTo(18, 34);
    context.lineTo(27, 44);
    context.lineTo(34, 30);
    context.lineTo(39, 48);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.arc(17, 24, 3, 0, Math.PI * 2);
    context.stroke();
    return;
  }

  if (profile.variant === "video") {
    drawPlayBadge(context, 23, 38, 15);
    return;
  }

  if (profile.variant === "audio") {
    for (let index = 0; index < 4; index += 1) {
      const height = 14 + (index % 2) * 14;
      context.beginPath();
      context.moveTo(13 + index * 7, 47);
      context.lineTo(13 + index * 7, 47 - height);
      context.stroke();
    }
    return;
  }

  if (profile.variant === "app") {
    context.strokeRect(9, 21, 28, 30);
    context.beginPath();
    context.moveTo(9, 29);
    context.lineTo(37, 29);
    context.stroke();
    return;
  }

  for (let y = 22; y <= 46; y += 8) {
    context.beginPath();
    context.moveTo(10, y);
    context.lineTo(36, y);
    context.stroke();
  }
}

function getFileExtensionLabel(name: string) {
  const extension = name.split(".").pop()?.trim().toUpperCase() ?? "";
  return extension.length > 1 && extension.length <= 6 ? extension : "";
}

function blendHex(from: string, to: string, amount: number) {
  const color = new Color(from).lerp(new Color(to), amount);
  return `#${color.getHexString()}`;
}

type NodeFocusRingProps = {
  radius: number;
  baseColor: string;
  isSelected: boolean;
  status: AtlasNode["status"];
  depthFade: ReturnType<typeof getDepthFade>;
  waveDepth: number | null;
  waveStartedAt: number;
  notificationKind: NotificationPulseKind | null;
  renderQuality: RenderQuality;
  theme: AtlasTheme;
};

function NodeFocusRing(props: NodeFocusRingProps) {
  const lowQuality = props.renderQuality === "low";
  const shouldAnimate =
    !lowQuality ||
    props.isSelected ||
    Boolean(props.notificationKind) ||
    props.status === "running" ||
    props.status === "needs_review" ||
    props.status === "error";

  if (lowQuality && !shouldAnimate) return null;

  return <AnimatedNodeFocusRing {...props} lowQuality={lowQuality} shouldAnimate={shouldAnimate} />;
}

function AnimatedNodeFocusRing({
  radius,
  baseColor,
  isSelected,
  status,
  depthFade,
  waveDepth,
  waveStartedAt,
  notificationKind,
  lowQuality,
  shouldAnimate,
  theme,
}: NodeFocusRingProps & {
  lowQuality: boolean;
  shouldAnimate: boolean;
}) {
  const themeColors = getUniverseThemeColors(theme);
  const [waveGlow, setWaveGlow] = useState(0);
  const [statusPulse, setStatusPulse] = useState(0);

  useFrame(({ clock }) => {
    if (!shouldAnimate) {
      setWaveGlow((current) => (current > 0 ? 0 : current));
      setStatusPulse((current) => (current > 0 ? 0 : current));
      return;
    }

    if (!waveDepth) {
      setWaveGlow((current) => (current > 0 ? 0 : current));
    } else {
      const age = performance.now() - waveStartedAt - waveDepth * FOCUS_WAVE_STEP_MS;
      const nextGlow =
        age >= 0 && age <= FOCUS_WAVE_DURATION_MS
          ? Math.sin((age / FOCUS_WAVE_DURATION_MS) * Math.PI) * (0.82 + springOvershoot(age / FOCUS_WAVE_DURATION_MS) * 0.18)
          : 0;
      setWaveGlow((current) => (Math.abs(current - nextGlow) > 0.025 ? nextGlow : current));
    }

    const speed = notificationKind ? (notificationKind === "error" ? 7.8 : 3.4) : status === "running" ? 4.6 : status === "needs_review" ? 2.2 : status === "error" ? 7.5 : 0;
    const nextPulse = speed > 0 ? (Math.sin(clock.elapsedTime * speed) + 1) / 2 : 0;
    setStatusPulse((current) => (Math.abs(current - nextPulse) > 0.035 ? nextPulse : current));
  });

  const notificationColor = notificationKind ? getNotificationPulseColor(notificationKind, theme) : null;
  const activeColor = notificationColor ?? baseColor;
  const normalFade = depthFade.opacity;
  const notificationFade = notificationKind ? 1 : normalFade;
  const highlightOpacity = (isSelected ? (theme === "light" ? 0.62 : 0.46) : waveGlow * (theme === "light" ? 0.5 : 0.42)) * depthFade.opacity;
  const highlightRadius = radius * (isSelected ? 1.58 : 1.48 + waveGlow * 0.08);
  const basePulseOpacity = notificationKind
    ? notificationKind === "error"
      ? 0.82
      : 0.68
    : status === "running"
      ? 0.38
      : status === "needs_review"
        ? 0.24
        : status === "error"
          ? 0.34
          : 0;
  const pulseOpacity = basePulseOpacity * (0.34 + statusPulse * 0.66) * notificationFade;
  const pulseRadius = radius * (1.58 + statusPulse * (notificationKind ? 0.32 : status === "running" ? 0.36 : 0.18));
  const pulseTube = Math.max(0.26, radius * (notificationKind ? 0.036 : 0.024));

  return (
    <>
      <mesh>
        <torusGeometry args={[radius * 1.34, Math.max(0.18, radius * 0.025), lowQuality ? 8 : 16, lowQuality ? 36 : 96]} />
        <meshBasicMaterial color={baseColor} transparent opacity={(theme === "light" ? 0.22 : 0.12) * normalFade} depthWrite={false} />
      </mesh>
      {pulseOpacity > 0.01 ? (
        <mesh>
          <torusGeometry args={[pulseRadius, pulseTube, lowQuality ? 8 : 16, lowQuality ? 44 : 132]} />
          <meshBasicMaterial color={activeColor} transparent opacity={pulseOpacity} depthWrite={false} depthTest={!notificationKind} />
        </mesh>
      ) : null}
      {notificationKind && !lowQuality ? (
        <mesh>
          <torusGeometry args={[radius * (1.92 + statusPulse * 0.18), Math.max(0.18, radius * 0.018), 14, 132]} />
          <meshBasicMaterial color={activeColor} transparent opacity={(0.34 + statusPulse * 0.32) * notificationFade} depthWrite={false} depthTest={false} />
        </mesh>
      ) : null}
      {highlightOpacity > 0.01 ? (
        <mesh>
          <torusGeometry args={[highlightRadius, Math.max(0.22, radius * 0.028), lowQuality ? 8 : 16, lowQuality ? 40 : 116]} />
          <meshBasicMaterial color={themeColors.ringHighlight} transparent opacity={highlightOpacity} depthWrite={false} />
        </mesh>
      ) : null}
    </>
  );
}

function ElasticTether({
  vector,
  color,
  theme,
  radius,
  tension,
  birthingStartedAt,
  showTearThreshold = false,
}: {
  vector: [number, number, number];
  color: string;
  theme: AtlasTheme;
  radius: number;
  tension: number;
  birthingStartedAt?: number;
  showTearThreshold?: boolean;
}) {
  const themeColors = getUniverseThemeColors(theme);
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
            <meshBasicMaterial color={themeColors.boundaryInner} transparent opacity={theme === "light" ? 0.28 : 0.18} depthWrite={false} />
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
        <meshBasicMaterial color={themeColors.birthRing} transparent opacity={0.62 + tension * 0.28} />
      </mesh>
      {birthingStartedAt ? (
        <WhiteHoleChargeMarker startedAt={birthingStartedAt} position={[pointVector[0], pointVector[1], pointVector[2] + 5]} theme={theme} />
      ) : null}
    </group>
  );
}

function WhiteHoleChargeMarker({
  startedAt,
  position,
  theme,
}: {
  startedAt: number;
  position: [number, number, number];
  theme: AtlasTheme;
}) {
  const groupRef = useRef<Group>(null);
  const [age, setAge] = useState(0);
  const themeColors = getUniverseThemeColors(theme);

  useFrame(() => {
    const nextAge = performance.now() - startedAt;
    setAge(nextAge);
    if (!groupRef.current) return;
    const charge = Math.min(1, nextAge / HOLD_TO_BIRTH_MS);
    groupRef.current.scale.setScalar((0.36 + charge * 1.08) * (1 + Math.sin(nextAge * 0.018) * 0.035) * BIRTH_EFFECT_VISUAL_SCALE);
  });

  const charge = Math.min(1, age / HOLD_TO_BIRTH_MS);

  return (
    <group ref={groupRef} position={position}>
      <CameraFacingGroup>
        <mesh>
          <sphereGeometry args={[5 + charge * 9, 32, 18]} />
          <meshBasicMaterial color={themeColors.birthCore} transparent opacity={0.52 + charge * 0.22} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[13 + charge * 24, 1.4 + charge * 1.8, 18, 112]} />
          <meshBasicMaterial color={themeColors.birthRing} transparent opacity={0.72} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[(13 + charge * 24) * 1.5, 0.7 + charge, 18, 112]} />
          <meshBasicMaterial color={themeColors.birthAccent} transparent opacity={0.34 + charge * 0.18} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </CameraFacingGroup>
    </group>
  );
}

function DragBoundaryGuide({
  depth,
  color,
  theme,
  parentWorldPosition,
  siblingCount = 1,
}: {
  depth: number;
  color: string;
  theme: AtlasTheme;
  parentWorldPosition?: [number, number, number];
  siblingCount?: number;
}) {
  const themeColors = getUniverseThemeColors(theme);
  const shellRadius = getShellRadius(depth);
  if (depth > 1 && parentWorldPosition) {
    return (
      <ChildDragBoundaryGuide
        depth={depth}
        siblingCount={siblingCount}
        color={color}
        theme={theme}
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
        <meshBasicMaterial color={themeColors.boundaryInner} transparent opacity={theme === "light" ? 0.28 : 0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ChildDragBoundaryGuide({
  depth,
  siblingCount,
  color,
  theme,
  shellRadius,
  parentWorldPosition,
}: {
  depth: number;
  siblingCount: number;
  color: string;
  theme: AtlasTheme;
  shellRadius: number;
  parentWorldPosition: [number, number, number];
}) {
  const themeColors = getUniverseThemeColors(theme);
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
        <meshBasicMaterial color={themeColors.boundaryInner} transparent opacity={theme === "light" ? 0.28 : 0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

function WhiteHoleEffect({ effect, theme }: { effect: BirthEffect; theme: AtlasTheme }) {
  const groupRef = useRef<Group>(null);
  const [age, setAge] = useState(0);
  const themeColors = getUniverseThemeColors(theme);
  const position = scaleTuple(effect.direction, NOTEBOOK_FIRST_SHELL_RADIUS);

  useFrame(() => {
    const nextAge = performance.now() - effect.startedAt;
    setAge(nextAge);
    if (!groupRef.current) return;
    const charge = effect.mode === "charging" ? Math.min(1, nextAge / HOLD_TO_BIRTH_MS) : 1;
    const breathe = 1 + Math.sin(nextAge * 0.018) * 0.035;
    groupRef.current.scale.setScalar((0.35 + charge * 1.1) * breathe * BIRTH_EFFECT_VISUAL_SCALE);
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
          <meshBasicMaterial color={themeColors.birthCore} transparent opacity={opacity * 0.72} blending={AdditiveBlending} />
        </mesh>
        <mesh>
          <torusGeometry args={[ringRadius, 1.6 + charge * 1.8, 18, 112]} />
          <meshBasicMaterial color={themeColors.birthRing} transparent opacity={opacity} blending={AdditiveBlending} />
        </mesh>
        <mesh>
          <torusGeometry args={[ringRadius * 1.54, 0.8 + charge, 18, 112]} />
          <meshBasicMaterial color={themeColors.birthAccent} transparent opacity={opacity * 0.42} blending={AdditiveBlending} />
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

function EmptyAtlasPulse({ theme }: { theme: AtlasTheme }) {
  const meshRef = useRef<Mesh>(null);
  const themeColors = getUniverseThemeColors(theme);
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 1.7) * 0.04);
  });

  return (
    <group position={[0, 0, -NOTEBOOK_FIRST_SHELL_RADIUS]}>
      <CameraFacingGroup>
        <mesh ref={meshRef}>
          <torusGeometry args={[42, 0.7, 16, 120]} />
          <meshBasicMaterial color={themeColors.ringHighlight} transparent opacity={theme === "light" ? 0.34 : 0.18} />
        </mesh>
        <mesh>
          <sphereGeometry args={[3.4, 18, 10]} />
          <meshBasicMaterial color={themeColors.birthCore} transparent opacity={0.42} blending={AdditiveBlending} />
        </mesh>
      </CameraFacingGroup>
    </group>
  );
}

function BackgroundStarLayer({ theme }: { theme: AtlasTheme }) {
  const backgroundScene = useMemo(() => new Scene(), []);
  const backgroundCamera = useMemo(() => new OrthographicCamera(), []);
  const backgroundColor = useMemo(() => new Color(getUniverseThemeColors(theme).background), [theme]);
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

  return createPortal(<StarField theme={theme} />, backgroundScene);
}

function StarField({ theme }: { theme: AtlasTheme }) {
  const layers = useMemo(() => {
    let seed = 97;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const configs =
      theme === "light"
        ? [
            { count: 1700, opacity: 0.13, size: 0.8, parallax: 0.012, z: -5, color: "#5f8ec6" },
            { count: 1040, opacity: 0.15, size: 1.05, parallax: 0.024, z: -4, color: "#4e82c0" },
            { count: 620, opacity: 0.18, size: 1.32, parallax: 0.04, z: -3, color: "#2f73bd" },
            { count: 300, opacity: 0.2, size: 1.62, parallax: 0.06, z: -2, color: "#1f63ac" },
            { count: 120, opacity: 0.22, size: 1.98, parallax: 0.086, z: -1, color: "#0b5cad" },
          ]
        : [
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
  }, [theme]);

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

function createPlanetTexture(color: string, texture: AtlasNode["texture"], seedText: string, lightSurfaceWash = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const wash = clamp(lightSurfaceWash, 0, 1);
  const textureWash = Math.min(1, wash * 1.08);
  const lightTextureColor = (dark: string, light: string) => (textureWash > 0 ? blendHex(dark, light, textureWash) : dark);

  let seed = 1;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 33 + seedText.charCodeAt(index)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967295;
  };

  context.fillStyle = wash > 0 ? blendHex(color, "#ffffff", Math.min(1, wash * 0.9)) : color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.28;

  if (texture === "bands") {
    for (let y = 0; y < canvas.height; y += 7) {
      context.fillStyle = rand() > 0.48 ? lightTextureColor("#fff4bf", "#ffffff") : lightTextureColor("#0b1813", "#ffffff");
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
      gradient.addColorStop(0, rand() > 0.5 ? "rgba(255,255,255,0.7)" : `rgba(${Math.round(11 + textureWash * 244)},${Math.round(24 + textureWash * 231)},${Math.round(19 + textureWash * 236)},0.55)`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  } else if (texture === "cell") {
    for (let index = 0; index < 54; index += 1) {
      const x = rand() * canvas.width;
      const y = rand() * canvas.height;
      context.strokeStyle = rand() > 0.5 ? "rgba(255,244,191,0.62)" : `rgba(${Math.round(7 + textureWash * 248)},${Math.round(17 + textureWash * 238)},${Math.round(14 + textureWash * 241)},0.42)`;
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
      context.fillStyle = rand() > 0.45 ? lightTextureColor("#fff4bf", "#ffffff") : lightTextureColor("#07110e", "#ffffff");
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
  gradient.addColorStop(1, wash > 0 ? blendHex("#000000", "#ffffff", textureWash) : "#000000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (wash > 0) {
    context.globalAlpha = Math.min(0.96, wash * 0.72);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

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

function getLayoutMotionProgress(progress: number, renderQuality: RenderQuality) {
  const clamped = clamp01(progress);
  if (renderQuality === "low") return easeInOutQuint(clamped);
  return springOvershoot(clamped);
}

function springOvershoot(value: number) {
  const clamped = clamp01(value);
  if (clamped <= 0) return 0;
  if (clamped >= 1) return 1;
  const omega = 8.2;
  const damping = 0.72;
  const damped = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * omega * clamped) * (
    Math.cos(damped * clamped) + (damping / Math.sqrt(1 - damping * damping)) * Math.sin(damped * clamped)
  );
}

function getLayoutMotionDelay(visualDepthIndex: number) {
  return Math.min(LAYOUT_MOTION_MAX_STAGGER_SECONDS, Math.max(0, visualDepthIndex) * LAYOUT_MOTION_STAGGER_SECONDS);
}

function getReformationScale(progress: number) {
  if (progress <= 0) return 0.965;
  if (progress >= 1) return 1;
  const settle = springOvershoot(progress);
  const breathe = Math.sin(Math.PI * clamp01(progress));
  return 0.965 + Math.min(1.045, settle) * 0.035 + breathe * 0.018;
}

function getNodeTransitionScale(progress: number, kind: "move" | "enter" | "exit") {
  const clamped = clamp01(progress);
  if (kind === "move") return getReformationScale(clamped);
  const eased = springOvershoot(clamped);
  if (kind === "enter") return lerp(0.56, 1, Math.min(1, eased));
  return lerp(1, 0.56, easeInOutQuint(clamped));
}

function getBackstagePosition(position: Vec3Tuple): Vec3Tuple {
  return [position[0], position[1], position[2] + LAYOUT_BACKSTAGE_Z_OFFSET];
}

function getVisualParentWorld(path: AtlasNode[], fallback: Vec3Tuple): Vec3Tuple {
  const parent = path.length > 1 ? path[path.length - 2] : null;
  if (!parent || parent.id === path[0]?.id) return fallback;
  return visualNodeHandles.get(parent.id)?.getWorldPosition() ?? fallback;
}

function directionToYawPitch(direction: Vector3) {
  const normalized = direction.clone().normalize();
  return {
    yaw: Math.atan2(normalized.x, -normalized.z),
    pitch: Math.asin(clamp(normalized.y, -1, 1)),
  };
}

function applyCameraPose(camera: PerspectiveCamera, state: { yaw: number; pitch: number; offset: number; panX?: number; panY?: number }) {
  const direction = directionFromYawPitch(state.yaw, state.pitch);
  camera.position.copy(direction.clone().multiplyScalar(state.offset).add(new Vector3(state.panX ?? 0, state.panY ?? 0, 0)));
  camera.lookAt(camera.position.clone().add(direction));
  camera.updateProjectionMatrix();
}

function reportNodeVisibility(root: AtlasNode, camera: PerspectiveCamera, state: NodeVisibilityState, viewport: AtlasLayoutViewport) {
  const now = performance.now();
  if (now - state.lastCheckedAt < NODE_VISIBILITY_CHECK_MS) return;
  state.lastCheckedAt = now;

  const layoutMode = useAtlasStore.getState().layoutMode;
  const selectedNodeId = useAtlasStore.getState().selectedNodeId;
  const allOffscreen = areAllNodesOffscreen(root, camera, layoutMode, selectedNodeId, viewport);
  if (state.allOffscreen === allOffscreen) return;
  state.allOffscreen = allOffscreen;
  emitOnboardingEvent(allOffscreen ? "all-nodes-offscreen" : "nodes-onscreen");
}

function areAllNodesOffscreen(root: AtlasNode, camera: PerspectiveCamera, layoutMode: AtlasLayoutMode, selectedNodeId: string, viewport: AtlasLayoutViewport) {
  if (!root.children.length) return false;
  camera.updateMatrixWorld();
  const frame = deriveAtlasLayoutFrame(root, layoutMode, undefined, { focusNodeId: selectedNodeId, viewport });
  return !root.children.some((child) => frame.visibleIds.has(child.id) && isNodePathOnscreen([root, child], camera, frame.positions, frame.visibleIds));
}

function isNodePathOnscreen(path: AtlasNode[], camera: PerspectiveCamera, layoutPositions: Map<string, Vec3>, visibleIds: Set<string>): boolean {
  const node = path.at(-1);
  if (!node) return false;
  if (isWorldPositionOnscreen(getLayoutPosition(layoutPositions, node.id), camera)) return true;
  return node.children.some((child) => visibleIds.has(child.id) && isNodePathOnscreen([...path, child], camera, layoutPositions, visibleIds));
}

function isWorldPositionOnscreen(position: Vec3Tuple, camera: PerspectiveCamera) {
  const projected = new Vector3(...position).project(camera);
  return (
    projected.z >= -1 &&
    projected.z <= 1 &&
    Math.abs(projected.x) <= NODE_SCREEN_MARGIN_NDC &&
    Math.abs(projected.y) <= NODE_SCREEN_MARGIN_NDC
  );
}

function directionFromYawPitch(yaw: number, pitch: number) {
  const cosPitch = Math.cos(pitch);
  return new Vector3(Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch).normalize();
}

function closestAngle(from: number, to: number) {
  const delta = ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + delta;
}

function getFocusTargetVector(
  root: AtlasNode,
  layoutMode: AtlasLayoutMode,
  focusRequest: NonNullable<ReturnType<typeof useAtlasStore.getState>["focusRequest"]>,
  viewport: AtlasLayoutViewport,
) {
  if (layoutMode === "phyllotaxis" || !focusRequest.nodeId) {
    return new Vector3(focusRequest.x, focusRequest.y, focusRequest.z);
  }

  const frame = deriveAtlasLayoutFrame(root, layoutMode, undefined, { focusNodeId: focusRequest.nodeId, viewport });
  const position = frame.positions.get(focusRequest.nodeId);
  return position ? new Vector3(...position) : new Vector3(focusRequest.x, focusRequest.y, focusRequest.z);
}

function getGeneratedLayoutFocusView(
  root: AtlasNode,
  layoutMode: AtlasLayoutMode,
  focusNodeId: string,
  viewport: AtlasLayoutViewport,
  {
    centerBounds,
    viewportWidth,
    viewportHeight,
  }: {
    centerBounds: boolean;
    viewportWidth: number;
    viewportHeight: number;
  },
) {
  const frame = deriveAtlasLayoutFrame(root, layoutMode, undefined, { focusNodeId, viewport, viewportWidth, viewportHeight });
  const focusPosition = frame.positions.get(focusNodeId);
  const fallbackZ = frame.planeZ ?? focusPosition?.[2] ?? 0;
  const boundsCenter = new Vector3(
    (frame.bounds.minX + frame.bounds.maxX) / 2,
    (frame.bounds.minY + frame.bounds.maxY) / 2,
    fallbackZ,
  );
  const target = centerBounds ? boundsCenter : focusPosition ? new Vector3(...focusPosition) : boundsCenter;
  const width = frame.bounds.maxX - frame.bounds.minX + NOTEBOOK_NODE_RADIUS * 7;
  const height = frame.bounds.maxY - frame.bounds.minY + NOTEBOOK_NODE_RADIUS * 8;
  const aspect = Math.max(0.1, viewportWidth / Math.max(1, viewportHeight));
  return {
    target,
    diameter: Math.max(height, width / aspect, NOTEBOOK_NODE_RADIUS * 10),
  };
}

function getCameraDistanceForDiameter(diameter: number, viewportHeight: number, fov: number, maxDistance = 620) {
  const targetWorldHeight = Math.max(diameter * 4.4, 72);
  const verticalFov = (fov * Math.PI) / 180;
  const distance = targetWorldHeight / (2 * Math.tan(verticalFov / 2));
  return Math.min(maxDistance, Math.max(42, distance * Math.max(0.72, 920 / Math.max(viewportHeight, 1))));
}

function getGeneratedLayoutMobileCameraDistance(diameter: number, viewportHeight: number, fov: number, viewport: AtlasLayoutViewport) {
  const verticalFov = (fov * Math.PI) / 180;
  const padding = viewport === "mobile-landscape" ? GENERATED_LAYOUT_MOBILE_LANDSCAPE_FIT_PADDING : GENERATED_LAYOUT_MOBILE_FIT_PADDING;
  const targetWorldHeight = Math.max(diameter * padding, NOTEBOOK_NODE_RADIUS * 9);
  const distance = targetWorldHeight / (2 * Math.tan(verticalFov / 2));
  return clamp(distance, 180, GENERATED_LAYOUT_MOBILE_MAX_CAMERA_DISTANCE);
}

function getGeneratedLayoutMobilePanYOffset(distance: number, viewportHeight: number, fov: number, viewport: AtlasLayoutViewport) {
  if (viewport === "desktop") return 0;
  const worldPerPixel = getWorldUnitsPerPixel(distance, viewportHeight, fov);
  const upwardShiftPx =
    viewport === "mobile-portrait"
      ? viewportHeight * 0.23 + 28
      : Math.max(18, viewportHeight * 0.06);
  return -upwardShiftPx * worldPerPixel;
}

function getWorldUnitsPerPixel(distance: number, viewportHeight: number, fov: number) {
  const verticalFov = (fov * Math.PI) / 180;
  return (2 * Math.tan(verticalFov / 2) * Math.max(1, distance)) / Math.max(1, viewportHeight);
}

function getInitialCameraOffset(mobilePortraitCamera: boolean) {
  if (!mobilePortraitCamera) return INITIAL_CAMERA_OFFSET;
  const initialFirstLayerDistance = NOTEBOOK_FIRST_SHELL_RADIUS - INITIAL_CAMERA_OFFSET;
  return NOTEBOOK_FIRST_SHELL_RADIUS - initialFirstLayerDistance * MOBILE_PORTRAIT_CAMERA_DISTANCE_MULTIPLIER;
}

function getFocusTargetOffset(targetRadius: number, targetDistance: number, mobilePortraitCamera: boolean) {
  const baseOffset = clamp(targetRadius - targetDistance, MIN_CAMERA_OFFSET, MAX_CAMERA_OFFSET);
  if (!mobilePortraitCamera) return baseOffset;
  const baseVisibleDistance = targetRadius - baseOffset;
  return clamp(
    targetRadius - baseVisibleDistance * MOBILE_PORTRAIT_CAMERA_DISTANCE_MULTIPLIER,
    getMinCameraOffset(true),
    MAX_CAMERA_OFFSET,
  );
}

function getMinCameraOffset(mobilePortraitCamera: boolean) {
  if (!mobilePortraitCamera) return MIN_CAMERA_OFFSET;
  const firstLayerZoomOutDistance = NOTEBOOK_FIRST_SHELL_RADIUS - MIN_CAMERA_OFFSET;
  return NOTEBOOK_FIRST_SHELL_RADIUS - firstLayerZoomOutDistance * MOBILE_PORTRAIT_CAMERA_DISTANCE_MULTIPLIER;
}

function isMobilePortraitCamera(width: number, height: number, keyboardPortraitLock = false) {
  if (keyboardPortraitLock) return isMobileCamera(width, Math.max(width + 1, height));
  if (height <= width || width > 980) return false;
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchDevice = navigator.maxTouchPoints > 0;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  return coarsePointer || touchDevice || mobileUa;
}

function getGeneratedLayoutViewport(
  _layoutMode: AtlasLayoutMode,
  width: number,
  height: number,
  keyboardPortraitLock = false,
): AtlasLayoutViewport {
  if (isMobilePortraitCamera(width, height, keyboardPortraitLock)) return "mobile-portrait";
  if (isMobileLandscapeCamera(width, height, keyboardPortraitLock)) return "mobile-landscape";
  return "desktop";
}

function isMobileCamera(width: number, height: number) {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchDevice = navigator.maxTouchPoints > 0;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  return (coarsePointer || touchDevice || mobileUa) && Math.min(width, height) <= 820 && Math.max(width, height) <= 1180;
}

function isMobileLandscapeCamera(width: number, height: number, keyboardPortraitLock = false) {
  if (keyboardPortraitLock) return false;
  return width > height && isMobileCamera(width, height);
}

function isKeyboardOverlayPortraitActive() {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true";
}

function getViewportScale(distance: number) {
  return Math.min(32, Math.max(0.3, 1 + distance / 360));
}

function canStartRootBirth(offset: number, viewportHeight: number, fov: number) {
  return offset <= getRootBirthMaxOffset(viewportHeight, fov);
}

function getRootBirthMaxOffset(viewportHeight: number, fov: number) {
  const firstLayerFocusOffset = clamp(
    NOTEBOOK_FIRST_SHELL_RADIUS - getCameraDistanceForDiameter(NOTEBOOK_NODE_RADIUS * 2, viewportHeight, fov),
    MIN_CAMERA_OFFSET,
    MAX_CAMERA_OFFSET,
  );
  const responsiveThreshold = lerp(INITIAL_CAMERA_OFFSET, Math.max(firstLayerFocusOffset, INITIAL_CAMERA_OFFSET), ROOT_BIRTH_FOCUS_MIDPOINT);
  return Math.max(ROOT_BIRTH_MAX_ZOOM_IN_OFFSET, responsiveThreshold);
}

function getRotationGain(offset: number) {
  const distance = Math.max(0, offset - MIN_CAMERA_OFFSET);
  return 0.0023 / (1 + distance / 900);
}

function getCurrentScreenAngle() {
  const orientationAngle = window.screen?.orientation?.angle;
  if (typeof orientationAngle === "number") return orientationAngle;
  return (window as Window & { orientation?: number }).orientation ?? 0;
}

function normalizeScreenAngle(angle: number) {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

function getVrTiltOffset(sample: VrOrientationSample, baseline: VrOrientationSample) {
  const beta = angleDeltaDegrees(sample.beta, baseline.beta);
  const gamma = sample.gamma - baseline.gamma;
  switch (normalizeScreenAngle(sample.screenAngle)) {
    case 90:
      return { x: beta, y: -gamma };
    case 180:
      return { x: -gamma, y: -beta };
    case 270:
      return { x: -beta, y: gamma };
    default:
      return { x: gamma, y: beta };
  }
}

function isVrTiltInsideDeadZone(offset: { x: number; y: number }) {
  return Math.abs(offset.x) <= VR_TILT_DEAD_ZONE_DEGREES && Math.abs(offset.y) <= VR_TILT_DEAD_ZONE_DEGREES;
}

function angleDeltaDegrees(value: number, baseline: number) {
  return ((((value - baseline) % 360) + 540) % 360) - 180;
}

function normalizeVrTilt(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= VR_TILT_DEAD_ZONE_DEGREES) return 0;
  const normalized = clamp(
    (magnitude - VR_TILT_DEAD_ZONE_DEGREES) / (VR_TILT_MAX_DEGREES - VR_TILT_DEAD_ZONE_DEGREES),
    0,
    1,
  );
  const eased = normalized * normalized * (3 - 2 * normalized);
  return Math.sign(value) * eased;
}

function getDepthFade(index: number) {
  const normalized = Math.min(1, Math.max(0, index / VISIBLE_DESCENDANT_DEPTH));
  const brightness = Math.max(0.045, Math.pow(0.52, index));
  return {
    index,
    opacity: Math.max(0.05, 1 - Math.pow(normalized, 0.72) * 0.95),
    brightness,
    backgroundBlend: 1 - brightness,
  };
}

function getLayoutAwareDepthFade(
  layoutMode: AtlasLayoutMode,
  renderQuality: RenderQuality,
  layoutVisible: boolean,
  camera: PerspectiveCamera,
  worldPosition: Vec3Tuple,
  fallbackIndex: number,
) {
  if ((layoutMode === "tree" || layoutMode === "mind-map") && renderQuality === "high" && layoutVisible) {
    return {
      index: 0,
      opacity: 1,
      brightness: 1,
      backgroundBlend: 0,
    };
  }
  return getDepthFade(getCameraDepthFadeIndex(camera, worldPosition, fallbackIndex));
}

function getCameraDepthFadeIndex(camera: PerspectiveCamera, worldPosition: Vec3Tuple, fallbackIndex: number) {
  camera.updateMatrixWorld();
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const toNode = new Vector3(...worldPosition).sub(camera.position);
  const distance = toNode.dot(forward);
  if (!Number.isFinite(distance) || distance <= 0) return fallbackIndex;
  return Math.max(0, (distance - FOCUSED_NODE_CAMERA_DISTANCE) / NOTEBOOK_SHELL_GAP);
}

function getLightThemeDepthWash(index: number) {
  if (index <= 0) return 0;
  const normalized = clamp(index / VISIBLE_DESCENDANT_DEPTH, 0, 1);
  return Math.min(1, Math.pow(normalized, 1.18) * 1.36);
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

  const closestT = Math.max(0, -origin.dot(direction));
  const closestPoint = origin.clone().add(direction.clone().multiplyScalar(closestT));
  const fallback =
    closestPoint.lengthSq() > 0.0001
      ? closestPoint.normalize().multiplyScalar(radius)
      : direction.multiplyScalar(radius);
  return [fallback.x, fallback.y, fallback.z];
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

function clampWorldForDepth(
  worldPosition: Vec3Tuple,
  depth: number,
  parentWorldPosition?: Vec3Tuple,
  siblingCount = 1,
): Vec3Tuple {
  const shellRadius = getShellRadius(depth);
  if (depth > 1) {
    if (!parentWorldPosition) return scaleTuple(normalizeVector(worldPosition), shellRadius);
    const parentDirection = normalizeVector(parentWorldPosition);
    const desiredDirection = normalizeVector(worldPosition);
    const spreadLimit = getManualChildSpreadLimit(depth, siblingCount);
    const dot = clamp(dotTuple(parentDirection, desiredDirection), -1, 1);
    const angle = Math.acos(dot);
    if (angle <= spreadLimit) return scaleTuple(desiredDirection, shellRadius);

    const tangentProjection = subtractPosition(desiredDirection, scaleTuple(parentDirection, dot));
    const tangent =
      vectorLength(tangentProjection) > 0.0001
        ? normalizeVector(tangentProjection)
        : getFallbackTangent(parentDirection);
    return scaleTuple(
      normalizeVector(addTuple(scaleTuple(parentDirection, Math.cos(spreadLimit)), scaleTuple(tangent, Math.sin(spreadLimit)))),
      shellRadius,
    );
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
    shellRadius,
  );
}

function getFallbackTangent(direction: Vec3Tuple): Vec3Tuple {
  const reference: Vec3Tuple = Math.abs(direction[1]) > 0.86 ? [1, 0, 0] : [0, 1, 0];
  return normalizeVector(crossTuple(reference, direction));
}

function subtractPosition(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distanceBetweenPositions(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function lerpPosition(a: [number, number, number], b: [number, number, number], amount: number): [number, number, number] {
  return [lerp(a[0], b[0], amount), lerp(a[1], b[1], amount), lerp(a[2], b[2], amount)];
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
