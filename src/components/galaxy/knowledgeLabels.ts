/**
 * Names on the galaxy map.
 *
 * Which names are shown depends on how large things are on screen, exactly
 * like place names on a map: spaces from afar, their branches in between,
 * notes up close and the finest detail only when you are right on top of it.
 * Labels are placed greedily by priority, never overlap each other or the
 * chrome, and fade instead of blinking. DOM nodes are pooled and updated in
 * place, so a frame costs no React work.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { HubSignals } from '../../galaxy/knowledgePresentation';
import type { FieldData } from './KnowledgeField';

export interface ChromeRect { x: number; y: number; w: number; h: number }

export interface LabelFrame {
  data: FieldData;
  camera: PerspectiveCamera;
  width: number;
  height: number;
  /** CSS pixels per world unit at distance 1. */
  pixelScale: number;
  unit: number;
  clusterRadius: Map<string, number>;
  signals: Map<string, HubSignals>;
  quality: Map<string, number | null>;
  rings: boolean;
  selected: string | null;
  hovered: string | null;
  activeSpaceId: string | null;
  hereLabel: string;
  untitled: string;
  /** Spaces that are cloud files, named with a small file badge. */
  cloudSpaces: Set<string>;
  cloudLabel: string;
  /** Keys a question lit up, in reveal order. */
  marked: Set<string> | null;
  relationMarks: { a: number; b: number; curve: number; text: string; color: string }[];
  chrome: ChromeRect[];
  fade: number;
  now: number;
}

const FONTS = [
  "600 17px Inter, 'Noto Sans JP', 'Hiragino Sans', 'Segoe UI', system-ui, sans-serif",
  "600 13px Inter, 'Noto Sans JP', 'Hiragino Sans', 'Segoe UI', system-ui, sans-serif",
  "500 11.5px Inter, 'Noto Sans JP', 'Hiragino Sans', 'Segoe UI', system-ui, sans-serif",
  "400 10.5px Inter, 'Noto Sans JP', 'Hiragino Sans', 'Segoe UI', system-ui, sans-serif",
];
const LINE_HEIGHT = [24, 19, 16, 15];
const MAX_LABELS = 140;

function smooth(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function truncate(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

interface Pooled { element: HTMLButtonElement; signature: string; visible: boolean; hideAt: number }

export class KnowledgeLabels {
  private container: HTMLElement;
  private pool = new Map<string, Pooled>();
  private relationPool: HTMLDivElement[] = [];
  private measure = document.createElement('canvas').getContext('2d');
  private widths = new Map<string, number>();
  private point = new Vector3();
  private onPick: (key: string, double: boolean) => void;
  private onHover: (key: string | null) => void;
  private forwardWheel: (event: WheelEvent) => void;
  private forwardPointer: (event: PointerEvent) => void;

  /**
   * Labels sit above the canvas, so the map's own gestures never see them:
   * wheel and pointer-down are handed to the map, which lets a drag that starts
   * on a name pan the map while a plain tap still selects the note.
   */
  constructor(container: HTMLElement, onPick: (key: string, double: boolean) => void, onHover: (key: string | null) => void, forwardWheel: (event: WheelEvent) => void, forwardPointer: (event: PointerEvent) => void) {
    this.container = container;
    this.onPick = onPick;
    this.onHover = onHover;
    this.forwardWheel = forwardWheel;
    this.forwardPointer = forwardPointer;
  }

  private width(text: string, tier: number) {
    const key = `${tier}:${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      if (this.measure) {
        this.measure.font = FONTS[tier];
        width = this.measure.measureText(text).width;
      } else width = text.length * [17, 13, 11.5, 10.5][tier];
      this.widths.set(key, width);
    }
    return width;
  }

  private element(key: string) {
    let pooled = this.pool.get(key);
    if (!pooled) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'kg-label';
      element.tabIndex = -1;
      element.addEventListener('click', event => { event.stopPropagation(); this.onPick(key, false); });
      element.addEventListener('dblclick', event => { event.stopPropagation(); this.onPick(key, true); });
      element.addEventListener('pointerenter', () => this.onHover(key));
      element.addEventListener('pointerleave', () => this.onHover(null));
      element.addEventListener('wheel', event => { event.preventDefault(); this.forwardWheel(event); }, { passive: false });
      element.addEventListener('pointerdown', event => this.forwardPointer(event));
      this.container.appendChild(element);
      pooled = { element, signature: '', visible: false, hideAt: 0 };
      this.pool.set(key, pooled);
    }
    return pooled;
  }

  update(frame: LabelFrame) {
    const { data, camera, width, height, now } = frame;
    camera.updateMatrixWorld();
    const point = this.point;
    const candidates: { index: number; x: number; y: number; r: number; vis: number; priority: number }[] = [];
    for (let index = 0; index < data.nodes.length; index++) {
      const node = data.nodes[index];
      const tier = Math.min(3, node.depth);
      point.set(data.positions[index * 3], data.positions[index * 3 + 1], data.positions[index * 3 + 2]);
      const distance = Math.max(1, point.distanceTo(camera.position));
      const ppu = (frame.unit * frame.pixelScale) / distance;
      let vis: number;
      if (tier === 0) {
        // A space is named while it is a place on the map, not while you are inside it.
        const apparent = ((frame.clusterRadius.get(node.spaceId) ?? 400) * frame.pixelScale) / distance;
        vis = 1 - smooth(330, 560, apparent);
      } else if (tier === 1) vis = smooth(2.6, 5, ppu);
      else if (tier === 2) vis = smooth(15, 24, ppu);
      else vis = smooth(34, 50, ppu);
      const marked = frame.marked?.has(node.key) ?? false;
      const forced = node.key === frame.selected || node.key === frame.hovered || marked;
      if (forced) vis = 1;
      else if (frame.marked) vis *= .35;
      vis *= frame.fade;
      if (vis < .04) continue;
      point.project(camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = ((point.x + 1) / 2) * width, y = ((1 - point.y) / 2) * height;
      if (x < -60 || x > width + 60 || y < -30 || y > height + 30) continue;
      // Clear the hub's rings (they sit at about a third of its halo) or the star's glow.
      const apparent = (data.sizes[index] * frame.pixelScale) / distance;
      const r = node.depth === 0 ? Math.min(210, Math.max(64, apparent)) * .31
        : node.depth === 1 ? Math.min(118, Math.max(30, apparent)) * .32
        : Math.min(54, Math.max(data.minPx[index], apparent)) * .3 + 2;
      let priority = [1000, 600, 300, 90][tier];
      const status = node.node.status;
      if (status === 'blocked' || status === 'error') priority += 80;
      if (status === 'needs_review' || status === 'running') priority += 45;
      if (tier === 1) priority += Math.min(120, (frame.signals.get(node.key)?.descendants ?? 0) * 6);
      if (marked) priority += 2000;
      if (node.key === frame.hovered) priority += 2600;
      if (node.key === frame.selected) priority += 3200;
      candidates.push({ index, x, y, r, vis, priority });
    }
    candidates.sort((a, b) => b.priority - a.priority);

    const placed: Box[] = [];
    const used = new Set<string>();
    let shown = 0;
    for (const candidate of candidates) {
      if (shown >= MAX_LABELS) break;
      const node = data.nodes[candidate.index];
      const tier = Math.min(3, node.depth);
      const { x, y, r } = candidate;
      const title = truncate(node.node.title || frame.untitled, tier <= 1 ? 22 : 26);
      const here = tier === 0 && node.spaceId === frame.activeSpaceId;
      const file = tier === 0 && frame.cloudSpaces.has(node.spaceId);
      const signal = tier <= 1 && frame.rings ? frame.signals.get(node.key) : undefined;
      const bars = Boolean(signal && (signal.progress !== null || signal.risk !== null));
      const textWidth = this.width(title, tier) + (tier >= 1 ? 14 : 4);
      const h = LINE_HEIGHT[tier] + (bars ? 8 : 0) + (here || file ? 17 : 0);
      const w = Math.max(textWidth, bars ? 72 : 0, here ? 92 : 0, file ? 104 : 0) + 8;
      const gap = 6;
      const options: Box[] = tier === 0
        ? [{ x: x - w / 2, y: y + r + 4, w, h }, { x: x + r + gap, y: y - h / 2, w, h }, { x: x - w / 2, y: y - r - h - 4, w, h }, { x: x - r - gap - w, y: y - h / 2, w, h }]
        : [{ x: x + r + gap, y: y - h / 2, w, h }, { x: x - r - gap - w, y: y - h / 2, w, h }, { x: x - w / 2, y: y + r + 2, w, h }, { x: x - w / 2, y: y - r - h - 2, w, h }];
      const forced = node.key === frame.selected || node.key === frame.hovered;
      const choice = options.find(box => !placed.some(other => overlaps(box, other)) && (forced || !frame.chrome.some(rect => overlaps(box, rect))));
      if (!choice) continue;
      placed.push({ x: choice.x - 3, y: choice.y - 2, w: choice.w + 6, h: choice.h + 4 });
      used.add(node.key);
      shown++;
      const pooled = this.element(node.key);
      const quality = tier === 0 ? frame.quality.get(node.spaceId) ?? null : null;
      const signature = `${title}|${tier}|${here}|${file}|${node.node.status}|${bars ? `${signal!.progress}|${signal!.risk}|${quality}` : ''}`;
      if (pooled.signature !== signature) {
        pooled.signature = signature;
        pooled.element.className = `kg-label t${tier} s-${node.node.status}`;
        pooled.element.style.setProperty('--kg-color', node.node.color || '#86cfff');
        pooled.element.innerHTML = [
          here ? `<span class="kg-here">${escapeHtml(frame.hereLabel)}</span>` : '',
          file ? `<span class="kg-here kg-file">${escapeHtml(frame.cloudLabel)}</span>` : '',
          `<span class="kg-row">${tier >= 1 ? '<i class="kg-glyph"></i>' : ''}<span class="kg-title">${escapeHtml(title)}</span></span>`,
          bars ? barsHtml(signal!.progress, quality, signal!.risk) : '',
        ].join('');
        pooled.element.setAttribute('aria-label', title);
      }
      pooled.element.classList.toggle('is-selected', node.key === frame.selected);
      pooled.element.classList.toggle('is-hovered', node.key === frame.hovered);
      pooled.element.classList.toggle('is-marked', Boolean(frame.marked?.has(node.key)));
      pooled.element.classList.toggle('is-left', choice === options[tier === 0 ? 3 : 1]);
      pooled.element.style.transform = `translate3d(${choice.x.toFixed(1)}px, ${choice.y.toFixed(1)}px, 0)`;
      pooled.element.style.opacity = Math.min(1, candidate.vis).toFixed(3);
      pooled.element.style.display = '';
      pooled.element.style.pointerEvents = candidate.vis > .35 ? 'auto' : 'none';
      pooled.visible = true;
      pooled.hideAt = 0;
    }
    for (const [key, pooled] of this.pool) {
      if (used.has(key)) continue;
      if (pooled.visible) {
        pooled.visible = false;
        pooled.element.style.opacity = '0';
        pooled.element.style.pointerEvents = 'none';
        pooled.hideAt = now + 260;
      } else if (pooled.hideAt && now > pooled.hideAt) {
        pooled.element.style.display = 'none';
        pooled.hideAt = 0;
      }
    }
    this.updateRelationMarks(frame, placed);
  }

  /** Short relation words on the lit links: 依存, 裏づけ, 原因 … */
  private updateRelationMarks(frame: LabelFrame, placed: Box[]) {
    const { data, camera, width, height } = frame;
    const point = this.point;
    let used = 0;
    for (const mark of frame.relationMarks) {
      if (used >= 24) break;
      const ax = data.positions[mark.a * 3], ay = data.positions[mark.a * 3 + 1], az = data.positions[mark.a * 3 + 2];
      const bx = data.positions[mark.b * 3], by = data.positions[mark.b * 3 + 1], bz = data.positions[mark.b * 3 + 2];
      const mx = .25 * ax + .5 * ((ax + bx) / 2 - (by - ay) * mark.curve) + .25 * bx;
      const my = .25 * ay + .5 * ((ay + by) / 2 + (bx - ax) * mark.curve) + .25 * by;
      point.set(mx, my, (az + bz) / 2).project(camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = ((point.x + 1) / 2) * width, y = ((1 - point.y) / 2) * height;
      const w = mark.text.length * 11 + 14;
      const box = { x: x - w / 2, y: y - 9, w, h: 18 };
      if (placed.some(other => overlaps(box, other)) || frame.chrome.some(rect => overlaps(box, rect))) continue;
      placed.push(box);
      let element = this.relationPool[used];
      if (!element) {
        element = document.createElement('div');
        element.className = 'kg-relation-label';
        this.container.appendChild(element);
        this.relationPool.push(element);
      }
      if (element.textContent !== mark.text) element.textContent = mark.text;
      element.style.setProperty('--kg-color', mark.color);
      element.style.transform = `translate3d(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px, 0)`;
      element.style.opacity = frame.fade.toFixed(3);
      element.style.display = '';
      used++;
    }
    for (let i = used; i < this.relationPool.length; i++) this.relationPool[i].style.display = 'none';
  }

  /** True while a hidden label is still fading out and needs one more update. */
  pending() {
    for (const pooled of this.pool.values()) if (pooled.hideAt) return true;
    return false;
  }

  dispose() {
    for (const pooled of this.pool.values()) pooled.element.remove();
    for (const element of this.relationPool) element.remove();
    this.pool.clear();
    this.relationPool = [];
  }
}

function barsHtml(progress: number | null, quality: number | null, risk: number | null) {
  const bar = (value: number | null, className: string) =>
    typeof value === 'number' ? `<b class="${className}"><i style="width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%"></i></b>` : `<b class="${className} is-empty"></b>`;
  return `<span class="kg-bars">${bar(progress, 'p')}${bar(quality, 'q')}${bar(risk, 'r')}</span>`;
}
