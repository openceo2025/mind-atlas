import { create } from 'zustand';
import type { KnowledgeGraph } from './knowledgeGraph';
import type { KnowledgeMap } from './knowledgeMap';
type Position = [number, number, number];
export type KnowledgeFocusLevel = 'space' | 'branch' | 'note' | 'keep';
interface KnowledgeRuntime {
  enterKey: string | null;
  open: boolean; exiting: boolean; graph: KnowledgeGraph;
  selected: string | null; query: string; lens: 'all' | 'dependencies' | 'evidence' | 'risk';
  hovered: string | null; hoveredRelation: string | null; relation: string | null; anchor: string | null; rings: boolean;
  /** Ask the camera to fly to a note; the scene picks the distance for the level. */
  focus: { key: string; level: KnowledgeFocusLevel; nonce: number } | null;
  /** Current zoom level, published when it changes. */
  level: 'galaxy' | 'space' | 'branch' | 'note' | 'detail';
  exit: (() => void) | null;
  positions: Map<string, Position>;
  map: KnowledgeMap | null;
  /** Where the scene writes its map labels (owned by the galaxy overlay). */
  labelLayer: HTMLElement | null;
  maintenance: { status: 'idle' | 'running' | 'error'; available: boolean };
}
export const useKnowledgeRuntime = create<KnowledgeRuntime>(() => ({
  open: false, exiting: false, graph: { nodes: [], relations: [], omitted: 0 },
  enterKey: null,
  selected: null, hovered: null, hoveredRelation: null, relation: null, anchor: null, rings: true, query: '', lens: 'all', focus: null, level: 'galaxy', exit: null,
  positions: new Map(),
  map: null,
  labelLayer: null,
  maintenance: { status: 'idle', available: false },
}));
export function closeKnowledge(exit: () => void) { useKnowledgeRuntime.setState({ exiting: true, exit }); }
export function focusKnowledge(key: string, level: KnowledgeFocusLevel = 'keep', keepPath = false) {
  useKnowledgeRuntime.setState({ selected: key, ...(keepPath ? {} : { anchor: key }), focus: { key, level, nonce: performance.now() } });
}
export const KNOWLEDGE_CAMERA_HANDOFF = 'mind-atlas-knowledge-camera-handoff';
