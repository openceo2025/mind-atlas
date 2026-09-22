import type { Card, CardKind, Fact, Relation, Space } from '../types';
import { getLocale } from '../i18n';
import { defaultConcepts } from './concepts';

// デモ用スペース「持続可能な未来」。人物・企業は架空。
// 日本語と英語の2版を持ち、日本語以外のロケールでは英語版を使う。

type Text = { title: string; subtitle?: string; body: string; tags: string[] };
interface Seed {
  id: string;
  kind: CardKind;
  visual?: Card['visual'];
  place?: Card['place'];
  groupId?: string;
  members?: string[];
  ja: Text;
  en: Text;
  facts?: { ja: Fact[]; en: Fact[] };
}

const planFacts = (cost: [string, number], power: [string, number], co2: [string, number], years: [string, number]) => {
  const mk = (labels: string[]): Fact[] => [
    { label: labels[0], value: cost[0], num: cost[1], higherIsBetter: false },
    { label: labels[1], value: power[0], num: power[1], higherIsBetter: true },
    { label: labels[2], value: co2[0], num: co2[1], higherIsBetter: true },
    { label: labels[3], value: years[0], num: years[1], higherIsBetter: false },
  ];
  return {
    ja: mk(['コスト（初期投資）', '発電量（年間）', 'CO2削減効果', '建設期間']),
    en: mk(['Initial investment', 'Annual generation', 'CO2 reduction', 'Construction time']),
  };
};

const SEEDS: Seed[] = [
  {
    id: 'topic',
    kind: 'topic',
    visual: 'earth',
    ja: {
      title: '持続可能な未来',
      subtitle: 'カーボンニュートラルな社会の実現に向けて',
      tags: ['エネルギー', 'サステナブル'],
      body: '2050年のカーボンニュートラルに向け、エネルギーの作り方・貯め方・使い方を同時に見直す必要がある。\n再生可能エネルギーはコスト面で既存電源と競合できる水準に近づいている。\n一方で、送電網の容量や蓄電の不足が普及のボトルネックになっている。\n政策支援と民間投資の組み合わせが、導入スピードを左右する。',
    },
    en: {
      title: 'A Sustainable Future',
      subtitle: 'Toward a carbon-neutral society',
      tags: ['energy', 'sustainability'],
      body: 'Reaching carbon neutrality by 2050 means rethinking how energy is produced, stored and used — all at once.\nRenewables are approaching cost parity with conventional power.\nGrid capacity and storage shortages are the bottleneck for adoption.\nThe mix of public policy and private investment decides how fast it happens.',
    },
  },
  {
    id: 'report',
    kind: 'document',
    visual: 'chart',
    ja: {
      title: '市場レポート 2024',
      subtitle: 'PDF・32ページ',
      tags: ['市場', '予測'],
      body: '世界の再生可能エネルギー市場は2030年に現在の約2.5倍へ拡大すると予測される。\n成長を牽引するのは太陽光と風力で、新規導入量の8割以上を占める。\n蓄電池市場は年率20%以上で成長し、系統安定化の需要が拡大している。\nアジア太平洋地域が最大の市場となり、投資額の半分近くを占める見込み。\n金利上昇と部材価格の変動は、短期的なリスク要因として残る。',
    },
    en: {
      title: 'Market Report 2024',
      subtitle: 'PDF · 32 pages',
      tags: ['market', 'forecast'],
      body: 'The global renewable energy market is forecast to grow to about 2.5x its current size by 2030.\nSolar and wind drive the growth, accounting for over 80% of new capacity.\nThe battery storage market grows over 20% a year as grid-balancing demand rises.\nAsia-Pacific becomes the largest market, with nearly half of all investment.\nRising interest rates and component price swings remain short-term risks.',
    },
  },
  {
    id: 'article',
    kind: 'article',
    ja: {
      title: '再生可能エネルギーのコストが過去最安に',
      subtitle: '2024.10.12・経済ニュース',
      tags: ['再エネ', 'コスト', '市場'],
      body: '太陽光発電の均等化発電原価が過去最安を更新した。\n風力発電も大型化によってコスト低下が続いている。\n発電コストは2030年に現在の50%以下へ下がる見込みだと複数の機関が示している。\nただし、系統接続費用と蓄電コストを含めると、差は縮まるとの指摘もある。',
    },
    en: {
      title: 'Renewable energy costs hit a record low',
      subtitle: 'Oct 12, 2024 · Business news',
      tags: ['renewables', 'cost', 'market'],
      body: 'The levelized cost of solar power hit a new record low.\nWind power keeps getting cheaper as turbines grow larger.\nSeveral agencies expect generation costs to fall below half of today’s by 2030.\nSome note the gap narrows once grid connection and storage costs are included.',
    },
  },
  {
    id: 'wind',
    kind: 'image',
    visual: 'wind',
    ja: {
      title: '洋上風力発電',
      subtitle: 'JPG・1920×1080',
      tags: ['再エネ', '風力'],
      body: '沿岸部の洋上風力発電所。1基あたり15MW級の大型タービンが並ぶ。\n洋上は陸上より風況が安定しており、設備利用率が高い。\n一方で、建設船や港湾設備の確保がプロジェクトの制約となる。',
    },
    en: {
      title: 'Offshore wind farm',
      subtitle: 'JPG · 1920×1080',
      tags: ['renewables', 'wind'],
      body: 'An offshore wind farm with 15 MW-class turbines.\nWinds offshore are steadier than on land, so capacity factors are high.\nAccess to installation vessels and port facilities constrains projects.',
    },
  },
  {
    id: 'greentech',
    kind: 'company',
    ja: {
      title: 'GreenTech Inc.',
      subtitle: '次世代エネルギー企業（架空）',
      tags: ['企業', 'クリーンエネルギー'],
      body: '全固体電池と電力需給制御ソフトを手がけるスタートアップ。\n2025年に量産ラインの稼働を計画している。\n電力会社との共同実証で、ピーク需要を15%削減した実績がある。',
    },
    en: {
      title: 'GreenTech Inc.',
      subtitle: 'Next-gen energy company (fictional)',
      tags: ['company', 'clean energy'],
      body: 'A startup building solid-state batteries and demand-response software.\nPlans to start a mass-production line in 2025.\nCut peak demand by 15% in a pilot with a utility.',
    },
  },
  {
    id: 'packet',
    kind: 'group',
    members: ['m-policy', 'm-invest', 'm-reg', 'm-overseas'],
    ja: { title: '調査パケット', subtitle: '4件のアイテム', tags: ['政策', '投資', '規制'], body: '政策ブリーフ\n投資動向メモ\n規制ロードマップ\n海外事例集' },
    en: { title: 'Research packet', subtitle: '4 items', tags: ['policy', 'investment', 'regulation'], body: 'Policy brief\nInvestment memo\nRegulation roadmap\nCase studies abroad' },
  },
  {
    id: 'm-policy',
    kind: 'document',
    place: 'hidden',
    groupId: 'packet',
    ja: { title: '政策ブリーフ', subtitle: 'Doc・6ページ', tags: ['政策'], body: '再エネ導入目標と補助制度の最新動向。\n固定価格買取から市場連動型への移行が進む。\n地域の合意形成を支援する制度が新設された。' },
    en: { title: 'Policy brief', subtitle: 'Doc · 6 pages', tags: ['policy'], body: 'Latest renewable targets and subsidy schemes.\nFeed-in tariffs are giving way to market-linked premiums.\nA new scheme supports building local consensus.' },
  },
  {
    id: 'm-invest',
    kind: 'document',
    place: 'hidden',
    groupId: 'packet',
    ja: { title: '投資動向メモ', subtitle: 'Note', tags: ['投資'], body: 'グリーンボンドの発行額は前年比30%増。\n蓄電関連スタートアップへの出資が急増している。' },
    en: { title: 'Investment memo', subtitle: 'Note', tags: ['investment'], body: 'Green bond issuance is up 30% year over year.\nFunding for storage startups is surging.' },
  },
  {
    id: 'm-reg',
    kind: 'document',
    place: 'hidden',
    groupId: 'packet',
    ja: { title: '規制ロードマップ', subtitle: 'PDF・12ページ', tags: ['規制'], body: '洋上風力の海域利用ルールが2026年に改定予定。\n系統接続の先着優先ルールが見直される。' },
    en: { title: 'Regulation roadmap', subtitle: 'PDF · 12 pages', tags: ['regulation'], body: 'Offshore wind seabed rules are due for revision in 2026.\nFirst-come-first-served grid connection rules are being reviewed.' },
  },
  {
    id: 'm-overseas',
    kind: 'document',
    place: 'hidden',
    groupId: 'packet',
    ja: { title: '海外事例集', subtitle: 'Web・8件', tags: ['事例'], body: '北海の洋上風力クラスターでは港湾の共同利用でコストを削減した。\n豪州では家庭用蓄電池の普及が系統の安定化に貢献している。' },
    en: { title: 'Case studies abroad', subtitle: 'Web · 8 items', tags: ['case study'], body: 'North Sea wind clusters cut costs by sharing ports.\nIn Australia, home batteries help stabilize the grid.' },
  },
  {
    id: 'energy',
    kind: 'dataset',
    ja: { title: 'エネルギー消費データ', subtitle: 'CSV・12MB・2024.10.01', tags: ['統計', 'エネルギー'], body: '地域別・時間帯別の電力消費量（2015–2024）。\n夕方のピーク需要は10年で12%増加している。\n産業部門の消費は減少し、家庭・業務部門が増加している。' },
    en: { title: 'Energy consumption data', subtitle: 'CSV · 12 MB · Oct 1, 2024', tags: ['statistics', 'energy'], body: 'Electricity use by region and hour (2015–2024).\nEvening peak demand grew 12% over ten years.\nIndustrial use fell while residential and commercial use rose.' },
  },
  {
    id: 'battery',
    kind: 'document',
    visual: 'battery',
    ja: { title: '次世代蓄電池技術', subtitle: 'リチウムを超える次世代電池', tags: ['蓄電池', '次世代', '技術'], body: '全固体電池やナトリウムイオン電池が次世代の候補として注目されている。\n全固体電池はエネルギー密度と安全性が高いが、量産コストが課題。\nナトリウムイオン電池は資源制約が小さく、定置用途に向いている。\n蓄電池技術の進化が、再エネの普及の鍵を握る。' },
    en: { title: 'Next-generation batteries', subtitle: 'Beyond lithium-ion', tags: ['batteries', 'next-gen', 'technology'], body: 'Solid-state and sodium-ion batteries are leading next-gen candidates.\nSolid-state cells are dense and safe but costly to mass-produce.\nSodium-ion avoids resource constraints and suits stationary storage.\nBattery progress is key to renewable adoption.' },
  },
  {
    id: 'expert',
    kind: 'person',
    ja: { title: '山田 健太', subtitle: 'A大学 研究教授（架空）', tags: ['エネルギー工学', '専門家'], body: '蓄電池材料の研究者。\n「定置用蓄電はナトリウム系が先に普及する」という見解を示している。' },
    en: { title: 'Dr. Kenta Yamada', subtitle: 'Professor, A University (fictional)', tags: ['energy engineering', 'expert'], body: 'A battery materials researcher.\nArgues that sodium-based cells will win stationary storage first.' },
  },
  {
    id: 'summary',
    kind: 'summary',
    ja: { title: 'AI要約：再エネ市場の見通し', subtitle: 'AI生成', tags: ['要約', '市場'], body: '再エネ市場は2030年に2.5倍に拡大する。\n発電コストは2030年に現在の50%以下になる見込み。\n蓄電池技術の進化が普及の鍵となる。\n各国の政策支援が市場成長を後押ししている。' },
    en: { title: 'AI summary: renewables outlook', subtitle: 'AI generated', tags: ['summary', 'market'], body: 'The renewables market grows 2.5x by 2030.\nGeneration costs fall below half of today’s by 2030.\nBattery progress is the key to adoption.\nPolicy support in many countries drives growth.' },
  },
  {
    id: 'planA',
    kind: 'idea',
    visual: 'wind',
    facts: planFacts(['3,500 億円', 3500], ['12.0 TWh', 12], ['520 万t/年', 520], ['7 年', 7]),
    ja: { title: 'A案：大規模な洋上風力', subtitle: '施策案', tags: ['施策', '風力'], body: '沿岸の促進区域に1GW級の洋上風力を建設する。\n発電量は大きいが、建設期間が長く港湾整備が前提となる。' },
    en: { title: 'Plan A: Large offshore wind', subtitle: 'Proposal', tags: ['proposal', 'wind'], body: 'Build a 1 GW offshore wind farm in a designated coastal zone.\nHigh output, but long construction and port upgrades are prerequisites.' },
  },
  {
    id: 'planB',
    kind: 'idea',
    visual: 'solar',
    facts: planFacts(['2,800 億円', 2800], ['9.5 TWh', 9.5], ['410 万t/年', 410], ['3 年', 3]),
    ja: { title: 'B案：次世代蓄電池＋太陽光', subtitle: '施策案', tags: ['施策', '蓄電池', '太陽光'], body: '分散型の太陽光と定置用蓄電池を組み合わせて地域に配置する。\n段階的に導入でき、早期に効果が出る。' },
    en: { title: 'Plan B: Solar + next-gen storage', subtitle: 'Proposal', tags: ['proposal', 'storage', 'solar'], body: 'Deploy distributed solar with stationary batteries across communities.\nCan be rolled out in stages with early results.' },
  },
  {
    id: 'quote',
    kind: 'quote',
    ja: { title: '脱炭素社会の見通し（引用）', subtitle: '記事からの引用', tags: ['政策', '引用'], body: '「再エネのコストは2030年に現在の50%以下に低下する可能性が高い」' },
    en: { title: 'Decarbonization outlook (quote)', subtitle: 'Quoted from an article', tags: ['policy', 'quote'], body: '“Renewable costs are likely to fall below half of today’s level by 2030.”' },
  },
  {
    id: 'grid',
    kind: 'issue',
    ja: { title: '送電網の容量不足', subtitle: '課題', tags: ['課題', '系統'], body: '再エネの適地と需要地が離れており、送電線の増強が追いつかない。\n接続待ちの案件が全国で増えている。' },
    en: { title: 'Grid capacity shortage', subtitle: 'Issue', tags: ['issue', 'grid'], body: 'The best renewable sites are far from demand and transmission upgrades lag.\nProjects waiting for grid connection keep piling up.' },
  },
  {
    id: 'hypo',
    kind: 'hypothesis',
    ja: { title: '地域分散型電源が主流になる', subtitle: '仮説', tags: ['仮説', '分散型'], body: '送電網の制約と蓄電池の低価格化により、\n大規模集中型より地域分散型の電源が増える。' },
    en: { title: 'Distributed generation will dominate', subtitle: 'Hypothesis', tags: ['hypothesis', 'distributed'], body: 'Grid constraints and cheaper batteries will favor local, distributed generation\nover large centralized plants.' },
  },
  {
    id: 'recycle',
    kind: 'article',
    ja: { title: '太陽光パネルの大量廃棄問題', subtitle: '2024.09.30・業界レポート', tags: ['リスク', '太陽光'], body: '2030年代後半に使用済みパネルが大量に発生する。\nリサイクル体制が整わなければ、環境負荷がコスト低下の効果を相殺しうる。' },
    en: { title: 'The coming wave of solar panel waste', subtitle: 'Sep 30, 2024 · Industry report', tags: ['risk', 'solar'], body: 'Huge volumes of end-of-life panels arrive in the late 2030s.\nWithout recycling, environmental costs could offset the price gains.' },
  },
  {
    id: 's-web',
    kind: 'link',
    place: 'shelf',
    ja: { title: '関連Web情報', subtitle: 'Web・12件', tags: ['Web'], body: '再エネ関連のニュースと解説記事のクリップ集。' },
    en: { title: 'Related web clippings', subtitle: 'Web · 12 items', tags: ['web'], body: 'Clipped news and explainers about renewable energy.' },
  },
  {
    id: 's-list',
    kind: 'dataset',
    place: 'shelf',
    ja: { title: '重要企業リスト', subtitle: 'Sheet・48社', tags: ['企業'], body: '再エネ・蓄電・送配電の主要企業48社の一覧。' },
    en: { title: 'Key company list', subtitle: 'Sheet · 48 companies', tags: ['companies'], body: 'A list of 48 key players in renewables, storage and transmission.' },
  },
  {
    id: 's-cn',
    kind: 'document',
    place: 'shelf',
    ja: { title: 'カーボンニュートラル白書', subtitle: 'Doc', tags: ['政策'], body: '2050年目標に向けた部門別の削減シナリオ。' },
    en: { title: 'Carbon neutrality white paper', subtitle: 'Doc', tags: ['policy'], body: 'Sector-by-sector reduction scenarios toward the 2050 target.' },
  },
];

const RELATIONS: [string, string, Relation['type'], string?][] = [
  ['topic', 'report', 'related'],
  ['topic', 'article', 'related'],
  ['topic', 'wind', 'related'],
  ['topic', 'greentech', 'related'],
  ['topic', 'packet', 'related'],
  ['topic', 'energy', 'related'],
  ['topic', 'battery', 'related'],
  ['report', 'summary', 'derived'],
  ['article', 'summary', 'derived'],
  ['quote', 'article', 'source'],
  ['wind', 'planA', 'derived'],
  ['battery', 'planB', 'derived'],
  ['planA', 'planB', 'related'],
  ['expert', 'battery', 'supports'],
  ['greentech', 'battery', 'related'],
  ['grid', 'planA', 'contradicts'],
  ['hypo', 'planB', 'supports'],
  ['recycle', 'article', 'contradicts'],
  ['energy', 'report', 'supports'],
  ['packet', 'm-policy', 'contains'],
  ['packet', 'm-invest', 'contains'],
  ['packet', 'm-reg', 'contains'],
  ['packet', 'm-overseas', 'contains'],
];

export function buildDemoSpace(id: string): Space {
  const at = Date.now();
  const lang = getLocale() === 'ja' ? 'ja' : 'en';
  const cards: Record<string, Card> = {};
  for (const c of defaultConcepts(at)) cards[c.id] = c;
  for (const s of SEEDS) {
    const tx = s[lang];
    cards[s.id] = {
      id: s.id,
      kind: s.kind,
      title: tx.title,
      subtitle: tx.subtitle,
      body: tx.body,
      tags: tx.tags,
      visual: s.visual,
      facts: s.facts?.[lang],
      members: s.members,
      expanded: s.members ? false : undefined,
      groupId: s.groupId,
      x: 0,
      y: 0,
      depth: 0.5,
      place: s.place ?? 'canvas',
      log: [{ at, code: 'imported' }],
      createdBy: s.kind === 'summary' ? 'ai' : 'user',
      createdAt: at,
      updatedAt: at,
    };
  }
  const axes = { x: 'c-market', y: 'c-maturity', z: 'c-difficulty' };
  for (const k of ['x', 'y', 'z'] as const) cards[axes[k]] = { ...cards[axes[k]], place: 'canvas' };
  return {
    schema: 'mindatlas.space/1',
    id,
    title: lang === 'ja' ? '持続可能な未来' : 'A Sustainable Future',
    description: '',
    cards,
    relations: RELATIONS.map(([from, to, type, label], i) => ({ id: `r${i + 1}`, from, to, type, label })),
    axes,
    trail: [{ id: 't0', axes, at }],
    createdAt: at,
    updatedAt: at,
  };
}
