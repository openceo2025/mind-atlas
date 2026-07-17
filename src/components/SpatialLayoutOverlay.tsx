import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import type { AtlasLayoutMode, AtlasLayoutViewport } from "../layout/atlasLayout";
import { deriveAtlasLayoutFrame } from "../layout/atlasLayout";
import type { SpatialGuideLabel, SpatialGuideLine } from "../layout/spatialOverlay";
import { useAtlasStore } from "../store/atlasStore";
import type { AtlasTheme } from "../theme";
import { currentAppLocale } from "../i18n/locales";

export function SpatialLayoutOverlay({
  layoutMode,
  viewport,
  viewportWidth,
  viewportHeight,
  theme,
  lowQuality,
}: {
  layoutMode: AtlasLayoutMode;
  viewport: AtlasLayoutViewport;
  viewportWidth: number;
  viewportHeight: number;
  theme: AtlasTheme;
  lowQuality: boolean;
}) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const overlay = useMemo(
    () =>
      deriveAtlasLayoutFrame(atlasRoot, layoutMode, undefined, {
        focusNodeId: selectedNodeId,
        viewport,
        viewportWidth,
        viewportHeight,
        locale: currentAppLocale(),
      }).overlay,
    [atlasRoot, layoutMode, selectedNodeId, viewport, viewportHeight, viewportWidth],
  );

  if (!overlay.lines.length && !overlay.labels.length) return null;

  return (
    <group key={layoutMode}>
      {overlay.lines.map((line) => (
        <AnimatedSpatialGuideLine key={line.id} guide={line} theme={theme} lowQuality={lowQuality} />
      ))}
      {overlay.labels.map((label) => (
        <AnimatedSpatialGuideLabel key={label.id} guide={label} theme={theme} lowQuality={lowQuality} />
      ))}
    </group>
  );
}

function AnimatedSpatialGuideLine({ guide, theme, lowQuality }: { guide: SpatialGuideLine; theme: AtlasTheme; lowQuality: boolean }) {
  const groupRef = useRef<Group>(null);
  const elapsedRef = useRef(lowQuality ? 10 : 0);
  const vector = useMemo(
    () => [guide.end[0] - guide.start[0], guide.end[1] - guide.start[1], guide.end[2] - guide.start[2]] as [number, number, number],
    [guide.end, guide.start],
  );
  const color = theme === "light" ? (guide.tone === "primary" ? "#315b6e" : "#6f8d98") : guide.tone === "primary" ? "#9ec9bd" : "#52756d";

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const progress = lowQuality ? 1 : clamp((elapsedRef.current - (guide.delay ?? 0)) / 0.72, 0, 1);
    const eased = easeOutCubic(progress);
    groupRef.current?.scale.setScalar(Math.max(0.0001, eased));
  });

  return (
    <group ref={groupRef} position={guide.start} scale={lowQuality ? 1 : 0.0001}>
      <Line points={[[0, 0, 0], vector]} color={color} transparent opacity={guide.tone === "primary" ? 0.7 : 0.42} lineWidth={guide.tone === "primary" ? 1.35 : 0.8} depthWrite={false} />
    </group>
  );
}

function AnimatedSpatialGuideLabel({ guide, theme, lowQuality }: { guide: SpatialGuideLabel; theme: AtlasTheme; lowQuality: boolean }) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef(lowQuality ? 10 : 0);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const progress = lowQuality ? 1 : clamp((elapsedRef.current - (guide.delay ?? 0)) / 0.48, 0, 1);
    const eased = easeOutCubic(progress);
    if (!elementRef.current) return;
    elementRef.current.style.opacity = String(eased);
    elementRef.current.style.transform = `translateY(${Math.round((1 - eased) * 8)}px)`;
  });

  return (
    <Html center position={guide.position} transform={false} zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
      <span ref={elementRef} className={`spatial-guide-label spatial-guide-label-${guide.tone ?? "muted"} theme-${theme}`}>
        {guide.text}
      </span>
    </Html>
  );
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
