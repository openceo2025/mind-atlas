import { create } from 'zustand';
import type { KnowledgeGraph } from './knowledgeGraph';
type Position = [number, number, number];
interface KnowledgeRuntime {
  enterKey: string | null;
  open: boolean; exiting: boolean; graph: KnowledgeGraph;
  selected: string | null; query: string; lens: 'all' | 'dependencies' | 'evidence' | 'risk';
  hovered: string | null; hoveredRelation: string | null; relation: string | null; anchor: string | null; rings: boolean;
  focus: { position: Position; distance: number; nonce: number } | null;
  distance: number; exit: (() => void) | null;
  positions: Map<string, Position>;
  overview: { position: Position; distance: number };
  maintenance: { status: 'idle' | 'running' | 'error'; available: boolean };
}
export const useKnowledgeRuntime = create<KnowledgeRuntime>(() => ({
  open: false, exiting: false, graph: { nodes: [], relations: [], omitted: 0 },
  enterKey: null,
  selected: null, hovered: null, hoveredRelation: null, relation: null, anchor: null, rings: true, query: '', lens: 'all', focus: null, distance: 5000, exit: null,
  positions: new Map(),
  overview: { position: [0, 0, 0], distance: 5000 },
  maintenance: { status: 'idle', available: false },
}));
export function closeKnowledge(exit: () => void) { useKnowledgeRuntime.setState({ exiting: true, exit }); }
export const KNOWLEDGE_CAMERA_HANDOFF = 'mind-atlas-knowledge-camera-handoff';
