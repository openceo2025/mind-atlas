import { useMemo } from "react";
import { getNodeWorldPosition, useAtlasStore } from "../store/atlasStore";

export function Minimap() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const viewport = useAtlasStore((state) => state.viewport);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const positions = useMemo(
    () => atlasRoot.children.map((node) => ({ node, position: getNodeWorldPosition([atlasRoot, node]) })),
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

  return (
    <aside className="minimap" aria-label="Universe minimap">
      <div className="minimap-space">
        {positions.map(({ node, position }) => {
          const projected = projectHemisphere(position);
          return (
            <button
              key={node.id}
              className="minimap-dot"
              type="button"
              style={{ left: `${projected.x}%`, top: `${projected.y}%`, background: node.color }}
              onClick={() => focusNode(node.id)}
              aria-label={`Focus ${node.title}`}
            />
          );
        })}
        <span className="minimap-viewport" style={viewportStyle} />
      </div>
    </aside>
  );
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
