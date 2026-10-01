/**
 * Per-frame camera state shared by the galaxy scene and its HTML chrome
 * (minimap, level ladder, labels). It changes every frame, so it is a plain
 * mutable object with listeners rather than React state.
 */
import type { Vec2 } from '../../galaxy/knowledgeMap';

export interface KnowledgeFrame {
  /** Point on the galaxy plane at the centre of the screen. */
  target: Vec2;
  /** Camera height above the galaxy plane. */
  distance: number;
  width: number;
  height: number;
  fov: number;
  /** CSS pixels per world unit at the galaxy plane. */
  pixelsPerUnit: number;
  /** Galaxy-plane corners of the viewport, for the minimap. */
  corners: Vec2[];
  /** 0 = native universe depth, 1 = flattened galaxy. */
  flatten: number;
}

export const knowledgeFrame: KnowledgeFrame = {
  target: [0, 0],
  distance: 5000,
  width: 1,
  height: 1,
  fov: 45,
  pixelsPerUnit: 1,
  corners: [],
  flatten: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let lastEmit = 0;

export function onKnowledgeFrame(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitKnowledgeFrame(force = false) {
  const now = performance.now();
  if (!force && now - lastEmit < 80) return;
  lastEmit = now;
  listeners.forEach(listener => listener());
}

export type KnowledgeCameraCommand =
  | { kind: 'fly'; target: Vec2; distance: number; duration?: number; avoidPanel?: boolean }
  | { kind: 'zoom'; factor: number }
  | { kind: 'home' };

const queue: KnowledgeCameraCommand[] = [];
export function sendKnowledgeCamera(command: KnowledgeCameraCommand) { queue.push(command); }
export function takeKnowledgeCameraCommands() { return queue.splice(0, queue.length); }

/**
 * The part of the canvas the galaxy chrome leaves free, in CSS pixels. The
 * overlay CSS is laid out to these numbers (see knowledge.css).
 */
export function knowledgeInsets(width: number, height: number, panelOpen: boolean) {
  if (width < 700) {
    return { left: 14, right: 14, top: 196, bottom: panelOpen ? Math.round(height * .44) : 96 };
  }
  const narrow = width < 1100;
  // A phone on its side: the compact chrome leaves the bottom of the screen free.
  const short = height < 520;
  return {
    left: narrow ? 190 : 236,
    right: panelOpen ? (narrow ? 330 : 386) : 36,
    top: short ? 112 : 128,
    bottom: short ? 22 : 96,
  };
}

/**
 * Ladder of zoom levels, by how many pixels one note-to-parent step spans on
 * screen. The bands match when each depth of names appears on the map.
 */
export const KNOWLEDGE_LEVELS = ['galaxy', 'space', 'branch', 'note', 'detail'] as const;
export type KnowledgeLevel = typeof KNOWLEDGE_LEVELS[number];
const LEVEL_UPPER: Record<KnowledgeLevel, number> = { galaxy: 3.5, space: 17, branch: 38, note: 85, detail: Infinity };
const LEVEL_TARGET: Record<KnowledgeLevel, number> = { galaxy: 2, space: 9, branch: 26, note: 58, detail: 130 };

export function knowledgeLevelOf(pixelsPerStep: number): KnowledgeLevel {
  return KNOWLEDGE_LEVELS.find(level => pixelsPerStep < LEVEL_UPPER[level]) ?? 'detail';
}

/** Camera distance at which one note-to-parent step spans the level's pixel size. */
export function knowledgeDistanceForLevel(level: KnowledgeLevel, unit: number, height: number, fov: number) {
  const tan = Math.tan((fov * Math.PI) / 360);
  return (unit * height) / (2 * tan * LEVEL_TARGET[level]);
}
