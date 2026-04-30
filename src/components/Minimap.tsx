import { useMemo } from "react";
import { useAtlasStore } from "../store/atlasStore";
import { getStatusColor } from "../utils/status";

const BOUNDS = {
  minX: -320,
  maxX: 320,
  minY: -230,
  maxY: 190,
};

export function Minimap() {
  const workAreas = useAtlasStore((state) => state.workAreas);
  const viewport = useAtlasStore((state) => state.viewport);
  const focusWorkArea = useAtlasStore((state) => state.focusWorkArea);

  const viewportStyle = useMemo(() => {
    const x = normalize(viewport.x, BOUNDS.minX, BOUNDS.maxX);
    const y = normalize(viewport.y, BOUNDS.minY, BOUNDS.maxY);
    const size = Math.max(18, 55 / viewport.zoom);
    return {
      left: `${x * 100}%`,
      top: `${(1 - y) * 100}%`,
      width: `${size}px`,
      height: `${size * 0.68}px`,
    };
  }, [viewport]);

  return (
    <aside className="minimap" aria-label="Universe minimap">
      <div className="minimap-title">Atlas</div>
      <div className="minimap-space">
        {workAreas.map((area) => {
          const [x, y] = area.position;
          const px = normalize(x, BOUNDS.minX, BOUNDS.maxX) * 100;
          const py = (1 - normalize(y, BOUNDS.minY, BOUNDS.maxY)) * 100;
          return (
            <button
              key={area.id}
              className="minimap-dot"
              type="button"
              style={{ left: `${px}%`, top: `${py}%`, background: getStatusColor(area.status) }}
              onClick={() => focusWorkArea(area.id)}
              aria-label={`Focus ${area.title}`}
            />
          );
        })}
        <span className="minimap-viewport" style={viewportStyle} />
      </div>
    </aside>
  );
}

function normalize(value: number, min: number, max: number) {
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
