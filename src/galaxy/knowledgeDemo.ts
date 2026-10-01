/** Local development preview. Reuses the existing storage-free About demo;
 * it never reads/replaces a real notebook or enables paid AI. */
import { createAboutDemoNotebook } from '../aboutDemo';
import type { AppLocale } from '../i18n/locales';
import type { AtlasNode } from '../types';
import type { GalaxyState } from './galaxyTypes';
export function isKnowledgeDemo() {
  return import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('knowledgeDemo') === '1'
    && new URLSearchParams(window.location.search).get('aboutDemo') === 'research';
}
export function knowledgeDemoState(activeRoot: AtlasNode, locale: AppLocale) {
  const now = new Date().toISOString();
  const kinds = ['research', 'app', 'travel'] as const;
  const colors = ['#87b9ef', '#e1b978', '#b494df'];
  const roots = kinds.map((kind, index) => ({ ...(index === 0 ? activeRoot : createAboutDemoNotebook(kind, locale)), galaxySpaceId: `demo-${kind}`, color: colors[index] }));
  const galaxy: GalaxyState = {
    schemaVersion: 1, philosophy: '', philosophyHistory: [], resources: [],
    spaces: roots.map((root, index) => ({ id: root.galaxySpaceId, title: root.title, color: colors[index], decision: 'undecided', dependsOn: index === 1 ? ['demo-research'] : [], createdAt: now, updatedAt: now })),
    activeSpaceId: 'demo-research', ledger: [], judgments: {}, judge: { auto: false, backend: 'jev-local', llamaUrl: '' }, displayCurrency: 'JPY', jpyPerUsd: 150, updatedAt: now,
  };
  return { galaxy, inactiveRoots: Object.fromEntries(roots.slice(1).map(root => [root.galaxySpaceId, root])) };
}
