import { useEffect, useMemo } from 'react';
import { useAtlasStore } from '../store/atlasStore';
import { useGalaxyStore } from './galaxyStore';
import { buildSpaceViews } from './galaxySummary';
import { judgeHash } from './galaxyJudge';
import { todayIso } from './galaxyRollup';
import { buildKnowledgeGraph } from './knowledgeGraph';
import { useKnowledgeRuntime } from './knowledgeRuntime';
import { useKnowledgeMaintenance } from './knowledgeMaintenance';
import { placeholderRoot, useCloudGalaxy } from './cloudGalaxy';
import type { GalaxySpace } from './galaxyTypes';

export function useSpaceViews() {
  const galaxy = useGalaxyStore(s => s.galaxy);
  const inactive = useGalaxyStore(s => s.inactiveRoots);
  const root = useAtlasStore(s => s.atlasRoot);
  return useMemo(() => galaxy ? buildSpaceViews(galaxy, id => id === galaxy.activeSpaceId ? root : inactive[id] ?? null,
    todayIso(), (space, tree) => judgeHash(galaxy, space, tree)) : [], [galaxy, inactive, root]);
}

/**
 * Cloud files shown as galaxies of their own. The file the current notebook was
 * loaded from is skipped: it is already on the map as the active space.
 */
export function useCloudViews() {
  const galaxy = useGalaxyStore(s => s.galaxy);
  const files = useCloudGalaxy(s => s.files);
  const currentKey = useCloudGalaxy(s => s.currentKey);
  return useMemo(() => {
    if (!galaxy) return [];
    const shown = files.filter(file => file.key !== currentKey && (file.status === 'ready' || file.status === 'too-large' || file.status === 'omitted'));
    if (!shown.length) return [];
    const spaces: GalaxySpace[] = shown.map(file => ({
      id: file.spaceId, title: file.title, color: file.color, decision: 'undecided', dependsOn: [],
      createdAt: file.entry.updatedAt, updatedAt: file.entry.updatedAt,
    }));
    const roots = new Map(shown.map(file => [file.spaceId, file.root ?? placeholderRoot(file)]));
    const keys = new Map(shown.map(file => [file.spaceId, file.key]));
    const synthetic = { ...galaxy, spaces, activeSpaceId: '' };
    const nodeBudget = Math.max(30, Math.floor(900 / shown.length));
    return buildSpaceViews(synthetic, id => roots.get(id) ?? null, todayIso(), (space, tree) => judgeHash(synthetic, space, tree))
      .map(view => ({ ...view, cloudKey: keys.get(view.space.id), nodeBudget }));
  }, [galaxy, files, currentKey]);
}

/** Runs even when the galaxy is closed. Editing is debounced, AI is optional,
 * bounded and serialized. No editor tree is ever rewritten by the index. */
export function useKnowledgeIndex() {
  const localViews = useSpaceViews();
  const cloudViews = useCloudViews();
  const views = useMemo(() => [...localViews, ...cloudViews], [localViews, cloudViews]);
  const relations = useGalaxyStore(s => s.galaxy?.knowledgeRelations);
  const graph = useKnowledgeRuntime(s => s.graph);
  useEffect(() => {
    const timer = window.setTimeout(() => useKnowledgeRuntime.setState({ graph: buildKnowledgeGraph(views, relations) }), 750);
    return () => window.clearTimeout(timer);
  }, [views, relations]);
  const maintenance = useKnowledgeMaintenance(graph);
  useEffect(() => { useKnowledgeRuntime.setState({ maintenance }); }, [maintenance.status, maintenance.available]);
}
