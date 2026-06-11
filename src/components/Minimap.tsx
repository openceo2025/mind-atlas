import { useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, Touch as ReactTouch, TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from "react";
import { MINIMAP_NAVIGATE_EVENT, MINIMAP_ZOOM_EVENT } from "../events";
import { deriveAtlasLayout } from "../layout/atlasLayout";
import { useAtlasStore } from "../store/atlasStore";

export function Minimap() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const viewport = useAtlasStore((state) => state.viewport);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const pinchRef = useRef<{ distance: number } | null>(null);
  const positions = useMemo(
    () => {
      const layoutPositions = deriveAtlasLayout(atlasRoot);
      return atlasRoot.children.map((node) => ({ node, position: layoutPositions.get(node.id) ?? [0, 0, 0] as [number, number, number] }));
    },
    [atlasRoot],
  );

  const viewportStyle = useMemo(() => {
    const projected = projectHemisphere(directionFromYawPitch(viewport.x, viewport.y));
    const size = Math.max(14, 34 / Math.max(viewport.zoom, 0.1));
    return {
      left: `${projected.x}%`,
      top: `${projected.y}%`,
      width: `${size}px`,
      height: `${size}px`,
    };
  }, [viewport]);

  const navigateFromClientPoint = (clientX: number, clientY: number) => {
    const element = document.querySelector<HTMLElement>(".minimap-space");
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    const direction = directionFromMinimapPoint(x, y);
    window.dispatchEvent(new CustomEvent(MINIMAP_NAVIGATE_EVENT, { detail: directionToYawPitch(direction) }));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    navigateFromClientPoint(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!(event.buttons & 1)) return;
    event.preventDefault();
    navigateFromClientPoint(event.clientX, event.clientY);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent(MINIMAP_ZOOM_EVENT, { detail: { deltaY: event.deltaY } }));
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 1) {
      navigateFromClientPoint(event.touches[0].clientX, event.touches[0].clientY);
      return;
    }
    if (event.touches.length === 2) {
      pinchRef.current = { distance: touchDistance(event.touches[0], event.touches[1]) };
    }
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.touches.length === 1) {
      navigateFromClientPoint(event.touches[0].clientX, event.touches[0].clientY);
      return;
    }
    if (event.touches.length !== 2 || !pinchRef.current) return;
    const nextDistance = touchDistance(event.touches[0], event.touches[1]);
    const deltaDistance = nextDistance - pinchRef.current.distance;
    pinchRef.current.distance = nextDistance;
    window.dispatchEvent(new CustomEvent(MINIMAP_ZOOM_EVENT, { detail: { deltaY: -deltaDistance * 3 } }));
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) pinchRef.current = null;
  };

  return (
    <aside className="minimap" aria-label="Universe minimap">
      <div
        className="minimap-space"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {positions.map(({ node, position }) => {
          const projected = projectHemisphere(position);
          return (
            <button
              key={node.id}
              className="minimap-dot"
              type="button"
              style={{ left: `${projected.x}%`, top: `${projected.y}%`, background: node.color }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                focusNode(node.id);
              }}
              aria-label={`Focus ${node.title}`}
            />
          );
        })}
        <span className="minimap-viewport" style={viewportStyle} />
      </div>
    </aside>
  );
}

function directionFromMinimapPoint(x: number, y: number): [number, number, number] {
  const dx = x - 50;
  const dy = 50 - y;
  const planarRadius = Math.min(44, Math.hypot(dx, dy));
  const theta = (planarRadius / 44) * (Math.PI / 2);
  const angle = Math.atan2(dy, dx);
  const sinTheta = Math.sin(theta);
  return [
    Math.cos(angle) * sinTheta,
    Math.sin(angle) * sinTheta,
    -Math.cos(theta),
  ];
}

function directionToYawPitch(direction: [number, number, number]) {
  const [x, y, z] = normalize3(direction);
  return {
    yaw: Math.atan2(x, -z),
    pitch: Math.asin(clamp(y, -1, 1)),
  };
}

function touchDistance(a: ReactTouch, b: ReactTouch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function projectHemisphere(position: [number, number, number]) {
  const [x, y, z] = normalize3(position);
  const theta = Math.min(Math.PI / 2, Math.acos(clamp(-z, -1, 1)));
  const radius = (theta / (Math.PI / 2)) * 44;
  const angle = Math.atan2(y, x);

  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 - Math.sin(angle) * radius,
  };
}

function directionFromYawPitch(yaw: number, pitch: number): [number, number, number] {
  const cosPitch = Math.cos(pitch);
  return [Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
}

function normalize3(position: [number, number, number]) {
  const length = Math.hypot(position[0], position[1], position[2]) || 1;
  return [position[0] / length, position[1] / length, position[2] / length] as [number, number, number];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
