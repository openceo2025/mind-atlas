/**
 * The whole galaxy in a corner, with the part on screen outlined. Click or
 * drag to move there — the same map, never a different picture of it.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useGalaxyStore } from '../../galaxy/galaxyStore';
import { useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';
import { knowledgeFrame, onKnowledgeFrame, sendKnowledgeCamera } from './knowledgeCamera';

export function KnowledgeMinimap({ label, width, height }: { label: string; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const map = useKnowledgeRuntime(s => s.map);
  const graph = useKnowledgeRuntime(s => s.graph);
  const galaxy = useGalaxyStore(s => s.galaxy);
  const base = useRef<HTMLCanvasElement | null>(null);
  const transform = useRef({ scale: 1, offsetX: 0, offsetY: 0 });

  const draw = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (base.current) context.drawImage(base.current, 0, 0, width, height);
    const { scale, offsetX, offsetY } = transform.current;
    if (knowledgeFrame.corners.length === 4) {
      context.strokeStyle = 'rgba(226, 240, 255, .92)';
      context.fillStyle = 'rgba(226, 240, 255, .07)';
      context.lineWidth = 1.2;
      context.beginPath();
      knowledgeFrame.corners.forEach(([x, y], index) => {
        const px = Math.max(-30, Math.min(width + 30, x * scale + offsetX));
        const py = Math.max(-30, Math.min(height + 30, offsetY - y * scale));
        if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
      });
      context.closePath();
      context.fill();
      context.stroke();
    }
  };

  // The static map: territories and hubs, redrawn only when the graph changes.
  useEffect(() => {
    if (!map) return;
    const offscreen = document.createElement('canvas');
    const ratio = window.devicePixelRatio || 1;
    offscreen.width = Math.round(width * ratio);
    offscreen.height = Math.round(height * ratio);
    const context = offscreen.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    const { bounds } = map;
    const spanX = Math.max(1, bounds.maxX - bounds.minX), spanY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min((width - 14) / spanX, (height - 14) / spanY);
    const offsetX = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
    const offsetY = height / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;
    transform.current = { scale, offsetX, offsetY };
    const colors = new Map((galaxy?.spaces ?? []).map(space => [space.id, space.color]));
    for (const cluster of map.clusters.values()) {
      const x = cluster.center[0] * scale + offsetX, y = offsetY - cluster.center[1] * scale;
      const radius = Math.max(4, cluster.radius * scale * 1.1);
      const color = colors.get(cluster.spaceId) ?? '#7fa6d8';
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `${color}70`);
      gradient.addColorStop(1, `${color}00`);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      if (cluster.spaceId === galaxy?.activeSpaceId) {
        context.strokeStyle = 'rgba(255, 255, 255, .7)';
        context.setLineDash([2, 2]);
        context.beginPath();
        context.arc(x, y, radius * .82, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
      }
    }
    for (const n of graph.nodes) {
      if (n.depth > 2) continue;
      const p = map.positions.get(n.key);
      if (!p) continue;
      context.fillStyle = n.node.color || '#86cfff';
      context.globalAlpha = n.depth === 2 ? .45 : .95;
      context.beginPath();
      context.arc(p[0] * scale + offsetX, offsetY - p[1] * scale, n.depth === 0 ? 2.4 : n.depth === 1 ? 1.4 : .7, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    base.current = offscreen;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, graph, galaxy?.spaces, galaxy?.activeSpaceId, width, height]);

  useEffect(() => onKnowledgeFrame(draw));

  const moveTo = (event: ReactPointerEvent<HTMLCanvasElement>, quick: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { scale, offsetX, offsetY } = transform.current;
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (offsetY - (event.clientY - rect.top)) / scale;
    sendKnowledgeCamera({ kind: 'fly', target: [x, y], distance: knowledgeFrame.distance, duration: quick ? 160 : 600 });
  };

  return <canvas
    ref={canvasRef}
    className="knowledge-minimap"
    width={width}
    height={height}
    style={{ width, height }}
    role="img"
    aria-label={label}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); moveTo(event, false); }}
    onPointerMove={event => { if (event.buttons & 1) moveTo(event, true); }}
  />;
}
