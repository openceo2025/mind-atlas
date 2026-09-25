/**
 * Long-press on a node to dive into its Mind Atlas (Cards) space.
 *
 * UniverseCanvas only reports where a press started (`beginPlanetHold`) and asks
 * on release whether the press was spent on a dive (`consumePlanetHoldRelease`).
 * Everything else — the 1 s hold, the cancel window, the dive itself — lives in
 * PlanetGate, which subscribes here. Keeping this module free of React and of
 * the store lets the canvas call it from inside its pointer handlers cheaply.
 */

export interface PlanetHoldStart {
  nodeId: string;
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
}

type Listener = (start: PlanetHoldStart) => void;
type DirectListener = (nodeId: string) => void;

let enabled = false;
let listener: Listener | null = null;
let directListener: DirectListener | null = null;
/** Pointers whose press turned into a dive; their release must not act as a click. */
const spentPointers = new Set<number>();
/** The pointer currently held on a node, before or during the dive. */
let activePointer: number | null = null;

export function setPlanetEntryEnabled(value: boolean) {
  enabled = value;
  if (!value) activePointer = null;
}

export function isPlanetEntryEnabled() {
  return enabled;
}

export function onPlanetHold(next: Listener | null, direct: DirectListener | null = null) {
  listener = next;
  directListener = direct;
}

/** Dive without a hold (the Focus panel button, keyboard users). */
export function requestPlanetEntry(nodeId: string) {
  if (!enabled || !directListener) return;
  directListener(nodeId);
}

export function beginPlanetHold(start: PlanetHoldStart) {
  if (!enabled || !listener) return;
  spentPointers.delete(start.pointerId);
  activePointer = start.pointerId;
  listener(start);
}

/** PlanetGate: this pointer's press has started a dive. */
export function markPlanetHoldSpent(pointerId: number) {
  spentPointers.add(pointerId);
}

/** PlanetGate: the press ended or was abandoned. */
export function endPlanetHold(pointerId: number) {
  if (activePointer === pointerId) activePointer = null;
}

/** True while a press on a node may still become a dive (touch context menus wait). */
export function isPlanetHoldActive() {
  return activePointer !== null;
}

/**
 * Called from the node's pointer-up. Returns true when the press was spent on a
 * dive, so the canvas skips its click (focus) and drops any jitter drag.
 */
export function consumePlanetHoldRelease(pointerId: number) {
  const spent = spentPointers.delete(pointerId);
  if (activePointer === pointerId) activePointer = null;
  return spent;
}
