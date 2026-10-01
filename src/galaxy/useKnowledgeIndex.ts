import { useEffect, useMemo } from 'react';
import { useAtlasStore } from '../store/atlasStore';
import { useGalaxyStore } from './galaxyStore';
import { buildSpaceViews } from './galaxySummary';
import { judgeHash } from './galaxyJudge';
import { todayIso } from './galaxyRollup';
import { buildKnowledgeGraph } from './knowledgeGraph';
import { useKnowledgeRuntime } from './knowledgeRuntime';
import { useKnowledgeMaintenance } from './knowledgeMaintenance';

export function useSpaceViews() {
  const galaxy = useGalaxyStore(s => s.galaxy);
  const inactive = useGalaxyStore(s => s.inactiveRoots);
  const root = useAtlasStore(s => s.atlasRoot);
  return useMemo(() => galaxy ? buildSpaceViews(galaxy, id => id === galaxy.activeSpaceId ? root : inactive[id] ?? null,
    todayIso(), (space, tree) => judgeHash(galaxy, space, tree)) : [], [galaxy, inactive, root]);
}

/** Runs even when the galaxy is closed. Editing is debounced, AI is optional,
 * bounded and serialized. No editor tree is ever rewritten by the index. */
export function useKnowledgeIndex() {
  const views = useSpaceViews();
  const relations = useGalaxyStore(s => s.galaxy?.knowledgeRelations);
  const graph = useKnowledgeRuntime(s => s.graph);
  useEffect(() => {
    const timer = window.setTimeout(() => useKnowledgeRuntime.setState({ graph: buildKnowledgeGraph(views, relations) }), 750);
    return () => window.clearTimeout(timer);
  }, [views, relations]);
  const maintenance = useKnowledgeMaintenance(graph);
  useEffect(() => { useKnowledgeRuntime.setState({ maintenance }); }, [maintenance.status, maintenance.available]);
}
