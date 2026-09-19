import type { Card } from '../types';
import { t, type MessageKey } from '../i18n';

// 既定の意味軸（概念カード）。表示名と両端のラベルはロケールごとに訳し、
// 埋め込みに使う両極の説明文は英語で持つ（多言語埋め込みは言語をまたいで効く）。
export const CONCEPT_KEYS = [
  'abstraction',
  'sentiment',
  'horizon',
  'importance',
  'feasibility',
  'risk',
  'novelty',
  'certainty',
  'market',
  'maturity',
  'difficulty',
  'cost',
  'env',
  'policy',
  'profit',
  'social',
] as const;
export type ConceptKey = (typeof CONCEPT_KEYS)[number];

const POLES: Record<ConceptKey, [string, string]> = {
  abstraction: ['abstract principles, broad vision, general concepts', 'concrete actions, specific numbers, tangible examples'],
  sentiment: ['negative, worrying, problems, threats, failure', 'positive, hopeful, benefits, opportunities, success'],
  horizon: ['immediate, short-term, this week, quick win', 'long-term, decades ahead, future vision, structural change'],
  importance: ['minor, trivial, nice to have, peripheral detail', 'critical, essential, core priority, decisive'],
  feasibility: ['very hard to realize, blocked, needs breakthroughs', 'easy to do, ready now, simple to implement'],
  risk: ['safe, stable, low risk, proven', 'risky, uncertain, dangerous, could fail badly'],
  novelty: ['conventional, established, familiar, standard practice', 'novel, unprecedented, disruptive, first of its kind'],
  certainty: ['speculation, guess, unverified assumption, rumor', 'verified fact, measured data, confirmed evidence'],
  market: ['niche with tiny demand, limited customers', 'huge market, rapidly growing demand, many customers'],
  maturity: ['early research, unproven lab technology, prototype', 'mature, widely deployed, commercially proven technology'],
  difficulty: ['easy to implement, few obstacles', 'very difficult to implement, many technical, regulatory and financial obstacles'],
  cost: ['expensive, high initial investment and running cost', 'cheap, low cost, cost advantage'],
  env: ['little environmental benefit, pollution, waste', 'large environmental benefit, CO2 reduction, decarbonization'],
  policy: ['self-sustaining without subsidies or regulation', 'dependent on government policy, subsidies and regulation'],
  profit: ['no short-term revenue, long payback', 'profitable within a few years, quick revenue'],
  social: ['little effect on people and communities', 'large impact on society, jobs, communities and daily life'],
};

export function conceptLabel(key: ConceptKey) {
  return {
    title: t(`concept.${key}` as MessageKey),
    low: t(`concept.${key}.low` as MessageKey),
    high: t(`concept.${key}.high` as MessageKey),
  };
}

export function makeConceptCard(key: ConceptKey, at: number): Card {
  const l = conceptLabel(key);
  return {
    id: `c-${key}`,
    kind: 'concept',
    title: l.title,
    body: '',
    tags: [],
    axisEnds: [l.low, l.high],
    axisPoles: POLES[key],
    x: 0,
    y: 0,
    depth: 0.5,
    place: 'library',
    log: [{ at, code: 'created' }],
    createdBy: 'user',
    createdAt: at,
    updatedAt: at,
  };
}

export function defaultConcepts(at: number) {
  return CONCEPT_KEYS.map((k) => makeConceptCard(k, at));
}

export const AXIS_PRESETS: { id: string; name: MessageKey; axes: [ConceptKey, ConceptKey, ConceptKey] }[] = [
  { id: 'p-think', name: 'preset.thinking', axes: ['abstraction', 'sentiment', 'horizon'] },
  { id: 'p-priority', name: 'preset.priority', axes: ['importance', 'feasibility', 'risk'] },
  { id: 'p-biz', name: 'preset.business', axes: ['market', 'maturity', 'difficulty'] },
  { id: 'p-impact', name: 'preset.impact', axes: ['cost', 'env', 'policy'] },
  { id: 'p-invest', name: 'preset.invest', axes: ['profit', 'social', 'policy'] },
  { id: 'p-idea', name: 'preset.ideas', axes: ['novelty', 'certainty', 'feasibility'] },
];
