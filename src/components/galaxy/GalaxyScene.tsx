import { Html, OrbitControls, QuadraticBezierLine } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import { AdditiveBlending, Color, type Group, type Points, Vector3 } from "three";
import type { SpaceView } from "../../galaxy/galaxySummary";
import type { GalaxyResource, SpaceDecision } from "../../galaxy/galaxyTypes";

export const DECISION_COLORS: Record<SpaceDecision, string> = {
  undecided: "#9aa3b2",
  continue: "#5ee6a8",
  hold: "#ffc857",
  recycle: "#7aa2ff",
  stop: "#6b7080",
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface SceneFlow {
  resourceId: string;
  spaceId: string;
  value: number;
}

interface GalaxySceneProps {
  views: SpaceView[];
  resources: GalaxyResource[];
  flows: SceneFlow[];
  selectedId: string | null;
  theme: "dark" | "light";
  lowQuality: boolean;
  onSelect: (spaceId: string | null) => void;
  onEnter: (spaceId: string) => void;
  renderLabel: (view: SpaceView) => ReactNode;
  coreLabel: ReactNode;
}

export function spacePosition(index: number): [number, number, number] {
  const radius = 13 + 9 * Math.sqrt(index);
  const angle = index * GOLDEN_ANGLE + 0.6;
  return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
}

function resourcePosition(index: number, total: number): [number, number, number] {
  const angle = (index / Math.max(1, total)) * Math.PI * 2 + 0.3;
  return [Math.cos(angle) * 5, 0.4, Math.sin(angle) * 5];
}

export function GalaxyScene(props: GalaxySceneProps) {
  const { theme, lowQuality } = props;
  const activeIndex = Math.max(0, props.views.findIndex((view) => view.active));
  const background = theme === "light" ? "#eef2f8" : "#04060d";
  return (
    <Canvas
      camera={{ position: [0, 34, 40], fov: 45, near: 0.1, far: 2000 }}
      dpr={lowQuality ? 1 : [1, 2]}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={[background]} />
      <ambientLight intensity={0.8} />
      {!lowQuality ? <Starfield theme={theme} /> : null}
      <Core theme={theme} label={props.coreLabel} />
      <ResourceMoons resources={props.resources} theme={theme} />
      <Flows views={props.views} resources={props.resources} flows={props.flows} />
      {props.views.map((view, index) => (
        <SpaceGalaxy
          key={view.space.id}
          view={view}
          index={index}
          theme={theme}
          lowQuality={lowQuality}
          selected={props.selectedId === view.space.id}
          onSelect={props.onSelect}
          onEnter={props.onEnter}
          label={props.renderLabel(view)}
        />
      ))}
      <CameraRig focus={spacePosition(activeIndex)} spaceCount={props.views.length} />
    </Canvas>
  );
}

/** Opens close to the space you came from, then pulls back to the whole galaxy. */
function CameraRig({ focus, spaceCount }: { focus: [number, number, number]; spaceCount: number }) {
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null);
  const { camera } = useThree();
  const start = useRef<number | null>(null);
  const from = useMemo(() => new Vector3(focus[0] * 1.05, 5, focus[2] * 1.05 + 6), [focus]);
  const reach = 34 + Math.sqrt(Math.max(1, spaceCount)) * 10;
  const to = useMemo(() => new Vector3(0, reach * 0.85, reach), [reach]);
  const target = useMemo(() => new Vector3(...focus), [focus]);
  useFrame((state) => {
    if (start.current === null) {
      start.current = state.clock.elapsedTime;
      camera.position.copy(from);
    }
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / 1.8);
    if (t >= 1) return;
    // Ease out with a little overshoot, so the pull-back feels piloted rather than linear.
    const c1 = 1.25;
    const eased = 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    camera.position.lerpVectors(from, to, eased);
    if (controls.current) {
      controls.current.target.lerpVectors(target, new Vector3(0, 0, 0), Math.min(1, t * 1.2));
      controls.current.update();
    }
  });
  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enableDamping
      maxPolarAngle={Math.PI * 0.46}
      minDistance={8}
      maxDistance={260}
    />
  );
}

function Core({ theme, label }: { theme: "dark" | "light"; label: ReactNode }) {
  const glow = useRef<Group>(null);
  useFrame((state) => {
    if (!glow.current) return;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.4) * 0.05;
    glow.current.scale.setScalar(pulse);
  });
  return (
    <group>
      <group ref={glow}>
        <mesh>
          <sphereGeometry args={[1.5, 32, 32]} />
          <meshBasicMaterial color={theme === "light" ? "#ffb347" : "#ffe7a8"} />
        </mesh>
        <mesh>
          <sphereGeometry args={[2.6, 32, 32]} />
          <meshBasicMaterial color="#ffcf6b" transparent opacity={0.16} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <Html position={[0, 3.4, 0]} center zIndexRange={[20, 0]}>
        {label}
      </Html>
    </group>
  );
}

function ResourceMoons({ resources, theme }: { resources: GalaxyResource[]; theme: "dark" | "light" }) {
  return (
    <group>
      {resources.map((resource, index) => {
        const position = resourcePosition(index, resources.length);
        const color = resource.kind === "account" ? "#ffc857" : resource.kind === "time" ? "#8fe3ff" : resource.kind === "ai-quota" ? "#c9a7ff" : "#f59fd0";
        return (
          <group key={resource.id} position={position}>
            <mesh>
              <sphereGeometry args={[0.45, 20, 20]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Html position={[0, -0.9, 0]} center zIndexRange={[10, 0]}>
              <span className={`galaxy-moon-label ${theme}`}>{resource.name}</span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function Flows({ views, resources, flows }: { views: SpaceView[]; resources: GalaxyResource[]; flows: SceneFlow[] }) {
  const max = Math.max(1, ...flows.map((flow) => flow.value));
  return (
    <group>
      {flows.map((flow) => {
        const resourceIndex = resources.findIndex((resource) => resource.id === flow.resourceId);
        const spaceIndex = views.findIndex((view) => view.space.id === flow.spaceId);
        if (resourceIndex < 0 || spaceIndex < 0 || flow.value <= 0) return null;
        const start = resourcePosition(resourceIndex, resources.length);
        const end = spacePosition(spaceIndex);
        const mid: [number, number, number] = [(start[0] + end[0]) / 2, 3 + Math.log10(1 + flow.value) * 0.6, (start[2] + end[2]) / 2];
        return (
          <FlowLine key={`${flow.resourceId}:${flow.spaceId}`} start={start} end={end} mid={mid} width={0.8 + (flow.value / max) * 3.2} />
        );
      })}
    </group>
  );
}

function FlowLine({ start, end, mid, width }: { start: [number, number, number]; end: [number, number, number]; mid: [number, number, number]; width: number }) {
  const line = useRef<{ material?: { dashOffset: number } } | null>(null);
  useFrame((_, delta) => {
    if (line.current?.material) line.current.material.dashOffset -= delta * 1.6;
  });
  return (
    <QuadraticBezierLine
      ref={line as never}
      start={start}
      end={end}
      mid={mid}
      color="#ffc857"
      lineWidth={width}
      dashed
      dashSize={0.6}
      gapSize={0.5}
      transparent
      opacity={0.75}
    />
  );
}

function seeded(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };
}

interface SpaceGalaxyProps {
  view: SpaceView;
  index: number;
  theme: "dark" | "light";
  lowQuality: boolean;
  selected: boolean;
  onSelect: (spaceId: string | null) => void;
  onEnter: (spaceId: string) => void;
  label: ReactNode;
}

function SpaceGalaxy({ view, index, theme, lowQuality, selected, onSelect, onEnter, label }: SpaceGalaxyProps) {
  const spin = useRef<Group>(null);
  const halo = useRef<Group>(null);
  const position = spacePosition(index);
  const nodeCount = Math.max(1, view.signals.nodeCount);
  const scale = 1 + Math.log10(1 + nodeCount) * 0.7;
  const faded = view.signals.staleDays > 30 || view.space.decision === "stop";
  const decisionColor = DECISION_COLORS[view.shownDecision.value];

  const geometry = useMemo(() => {
    const random = seeded(view.space.id);
    const count = Math.round(Math.min(900, 80 + nodeCount * 10) / (lowQuality ? 3 : 1));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const base = new Color(view.space.color);
    const white = new Color(theme === "light" ? "#3a4254" : "#ffffff");
    const arms = 2 + (nodeCount % 2);
    for (let point = 0; point < count; point += 1) {
      const t = random();
      const radius = Math.pow(t, 0.7) * 2.6 * scale;
      const arm = (point % arms) * ((Math.PI * 2) / arms);
      const angle = arm + radius * 1.1 + (random() - 0.5) * 0.55;
      positions[point * 3] = Math.cos(angle) * radius;
      positions[point * 3 + 1] = (random() - 0.5) * 0.25 * (1 - t);
      positions[point * 3 + 2] = Math.sin(angle) * radius;
      const mixed = base.clone().lerp(white, Math.max(0, 0.55 - t));
      colors[point * 3] = mixed.r;
      colors[point * 3 + 1] = mixed.g;
      colors[point * 3 + 2] = mixed.b;
    }
    return { positions, colors };
  }, [lowQuality, nodeCount, scale, theme, view.space.color, view.space.id]);

  useFrame((state, delta) => {
    if (spin.current) spin.current.rotation.y += delta * (faded ? 0.03 : 0.12);
    if (halo.current) {
      const pulse = view.active ? 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.06 : 1;
      halo.current.scale.setScalar(pulse * (selected ? 1.08 : 1));
    }
  });

  return (
    <group position={position}>
      <group ref={spin}>
        <points
          onClick={(event) => {
            event.stopPropagation();
            onSelect(view.space.id);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onEnter(view.space.id);
          }}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[geometry.colors, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={theme === "light" ? 0.16 : 0.13}
            vertexColors
            transparent
            opacity={faded ? 0.35 : 0.95}
            depthWrite={false}
            blending={theme === "light" ? undefined : AdditiveBlending}
            sizeAttenuation
          />
        </points>
        <mesh>
          <sphereGeometry args={[0.35 * scale, 18, 18]} />
          <meshBasicMaterial color={view.space.color} transparent opacity={faded ? 0.4 : 0.95} />
        </mesh>
      </group>
      <group ref={halo} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh
          onClick={(event) => {
            event.stopPropagation();
            onSelect(view.space.id);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onEnter(view.space.id);
          }}
        >
          <ringGeometry args={[2.9 * scale, (view.shownDecision.proposed ? 3.0 : 3.15) * scale, 64]} />
          <meshBasicMaterial color={decisionColor} transparent opacity={view.shownDecision.proposed ? 0.45 : 0.9} />
        </mesh>
        {selected ? (
          <mesh>
            <ringGeometry args={[3.5 * scale, 3.58 * scale, 64]} />
            <meshBasicMaterial color={theme === "light" ? "#1c2230" : "#ffffff"} transparent opacity={0.8} />
          </mesh>
        ) : null}
      </group>
      <Html position={[0, -0.2, 3.9 * scale]} center zIndexRange={[30, 0]}>
        {label}
      </Html>
    </group>
  );
}

function Starfield({ theme }: { theme: "dark" | "light" }) {
  const ref = useRef<Points>(null);
  const positions = useMemo(() => {
    const random = seeded("galaxy-starfield");
    const count = 1400;
    const array = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 260 + random() * 400;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      array[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      array[index * 3 + 1] = radius * Math.cos(phi);
      array[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    return array;
  }, []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.004;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={1.3} color={theme === "light" ? "#9aa6bd" : "#cfd8ff"} transparent opacity={0.6} sizeAttenuation depthWrite={false} />
    </points>
  );
}
