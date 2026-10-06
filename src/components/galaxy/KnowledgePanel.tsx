import { ArrowDownRight, ChevronRight, Cloud, Crosshair, Minus, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMindAtlasLocale } from '../../i18n/I18nProvider';
import { getStatusLabel } from '../../utils/status';
import { knowledgeMessages, relationLabel } from '../../i18n/knowledgeMessages';
import { isKnowledgeDemo } from '../../galaxy/knowledgeDemo';
import { projectKnowledge } from '../../galaxy/knowledgeGraph';
import { focusKnowledge, useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';
import { useGalaxyStore } from '../../galaxy/galaxyStore';
import { isCloudSpaceId, useCloudGalaxy } from '../../galaxy/cloudGalaxy';
import type { SpaceView } from '../../galaxy/galaxySummary';
import { KnowledgeCascade } from './KnowledgeCascade';
import { knowledgeHubSignals, knowledgeMetrics } from '../../galaxy/knowledgePresentation';
import { KnowledgeMinimap } from './KnowledgeMinimap';
import { KNOWLEDGE_LEVELS, knowledgeDistanceForLevel, knowledgeFrame, sendKnowledgeCamera } from './knowledgeCamera';

export function KnowledgePanel({ views, onEnter, onManagement }: { views: SpaceView[]; onEnter: (spaceId: string, nodeId?: string) => void; onManagement: (spaceId: string) => void }) {
  const { locale } = useMindAtlasLocale();
  const m = knowledgeMessages[locale.startsWith('ja') ? 'ja' : 'en'];
  const galaxy = useGalaxyStore(s => s.galaxy);
  const graph = useKnowledgeRuntime(s => s.graph);
  const maintenance = useKnowledgeRuntime(s => s.maintenance);
  const query = useKnowledgeRuntime(s => s.query);
  const lens = useKnowledgeRuntime(s => s.lens);
  const selectedKey = useKnowledgeRuntime(s => s.selected);
  const anchor = useKnowledgeRuntime(s => s.anchor);
  const relationId = useKnowledgeRuntime(s => s.relation);
  const rings = useKnowledgeRuntime(s => s.rings);
  const level = useKnowledgeRuntime(s => s.level);
  const map = useKnowledgeRuntime(s => s.map);
  const [showProjection, setShowProjection] = useState(false);
  const compact = typeof window !== 'undefined' && (window.innerWidth < 700 || window.innerHeight < 520);
  const projection = useMemo(() => projectKnowledge(graph, query, lens), [graph, query, lens]);
  const byKey = useMemo(() => new Map(graph.nodes.map(n => [n.key, n])), [graph]);
  const selected = selectedKey ? byKey.get(selectedKey) : undefined;
  const view = views.find(v => v.space.id === selected?.spaceId);
  const related = useMemo(() => graph.relations.filter(r => r.from === selected?.key || r.to === selected?.key), [graph, selected?.key]);
  const inspected = graph.relations.find(r => r.id === relationId);
  const metrics = useMemo(() => knowledgeMetrics(graph), [graph]);
  const signals = useMemo(() => knowledgeHubSignals(graph), [graph]);
  const metric = selected && metrics.get(selected.key);
  const signal = selected && signals.get(selected.key);
  const rootKeys = useMemo(() => new Map(graph.nodes.filter(n => n.depth === 0).map(n => [n.spaceId, n.key])), [graph]);
  const goToLevel = (target: typeof KNOWLEDGE_LEVELS[number]) => {
    if (target === 'galaxy') { sendKnowledgeCamera({ kind: 'home' }); return; }
    if (!map) return;
    sendKnowledgeCamera({ kind: 'fly', target: knowledgeFrame.target, distance: knowledgeDistanceForLevel(target, map.unit, knowledgeFrame.height, knowledgeFrame.fov) });
  };
  const percent = (value: number | null | undefined) => (typeof value === 'number' ? `${Math.round(value * 100)}%` : '—');
  const cloudFiles = useCloudGalaxy(s => s.files);
  const cloudCurrent = useCloudGalaxy(s => s.currentKey);
  const cloudPending = cloudFiles.filter(file => file.key !== cloudCurrent && (file.status === 'pending' || file.status === 'loading')).length;
  const cloudTotal = cloudFiles.filter(file => file.key !== cloudCurrent).length;
  const selectedFile = selected && isCloudSpaceId(selected.spaceId) ? cloudFiles.find(file => file.spaceId === selected.spaceId) : undefined;
  const nodeCount = (spaceId: string) => graph.nodes.reduce((count, n) => count + Number(n.spaceId === spaceId), 0);

  return <>
    <section className="knowledge-heading" data-kg-chrome>
      {isKnowledgeDemo() && <small className="knowledge-demo-badge">{m.sample}</small>}
      <form className="knowledge-search" onSubmit={e => { e.preventDefault(); const first = graph.nodes.find(n => projection.seeds.has(n.key)); if (first) focusKnowledge(first.key, 'branch'); }}>
        <Search size={16} /><input aria-label={m.search} placeholder={m.search} value={query} onChange={e => useKnowledgeRuntime.setState({ query: e.target.value })} />
        {query && <button type="button" aria-label={m.close} onClick={() => useKnowledgeRuntime.setState({ query: '' })}><X size={15} /></button>}
      </form>
    </section>
    <nav className="knowledge-lenses" aria-label={m.title} data-kg-chrome>
      {(['all', 'dependencies', 'evidence', 'risk'] as const).map(item => <button key={item} type="button" aria-pressed={lens === item} onClick={() => useKnowledgeRuntime.setState({ lens: item })}>{m[item]}</button>)}
    </nav>
    <aside className="knowledge-spaces" aria-label={m.title} data-kg-chrome>
      {views.map(v => {
        const key = rootKeys.get(v.space.id);
        const hub = key ? signals.get(key) : undefined;
        return <button key={v.space.id} type="button" className={selected?.spaceId === v.space.id ? 'is-selected' : ''} onClick={() => key && focusKnowledge(key, 'space')}>
          <i style={{ background: v.space.color }} />
          <span>{v.space.title}<small>{v.signals.nodeCount} {m.nodes}{hub?.progress !== null && hub?.progress !== undefined ? ` · ${m.progress} ${percent(hub.progress)}` : ''}</small>
            {hub && hub.progress !== null && <b className="knowledge-space-progress"><i style={{ width: percent(hub.progress) }} /></b>}
          </span>
          <ChevronRight size={14} />
        </button>;
      })}
      {cloudFiles.length > 0 && <>
        <h4 className="knowledge-spaces-heading"><Cloud size={12} />{m.cloudFiles}{cloudPending > 0 && <small>{m.cloudLoading.replace('{done}', String(cloudTotal - cloudPending)).replace('{total}', String(cloudTotal))}</small>}</h4>
        {cloudFiles.map(file => {
          const current = file.key === cloudCurrent;
          // The current file is the active space; selecting it goes there.
          const key = current ? rootKeys.get(galaxy?.activeSpaceId ?? '') : rootKeys.get(file.spaceId);
          const state = current ? m.cloudCurrent : file.status === 'ready' ? `${nodeCount(file.spaceId)} ${m.nodes}` : file.status === 'too-large' ? m.cloudTooLarge : file.status === 'omitted' ? m.cloudOmitted : file.status === 'error' ? m.cloudError : m.cloudFetching;
          return <button key={file.key} type="button" className={`is-cloud${selected?.spaceId === file.spaceId ? ' is-selected' : ''}${key ? '' : ' is-waiting'}`} disabled={!key} onClick={() => key && focusKnowledge(key, 'space')}>
            <i style={{ background: file.color }} />
            <span>{file.title}<small>{state}</small></span>
            <ChevronRight size={14} />
          </button>;
        })}
      </>}
    </aside>
    {(selected || projection.active || inspected) && <section className="knowledge-detail" aria-label={m.related} data-kg-chrome>
      {inspected && <article className="knowledge-relation-detail"><header><small>{m.relationDetail}</small><button type="button" aria-label={m.close} onClick={() => useKnowledgeRuntime.setState({ relation: null })}><X size={14} /></button></header>
        <strong>{byKey.get(inspected.from)?.node.title} → {relationLabel(inspected.type, locale)} → {byKey.get(inspected.to)?.node.title}</strong>
        <small>{m[inspected.source]}{inspected.source === 'ai' ? ` · ${inspected.model} · ${Math.round(inspected.confidence * 100)}%` : ''}</small><blockquote>{sourceExcerpt(inspected.evidence)}</blockquote>
      </article>}
      {selected ? <>
        <header><small>{selectedFile ? <><Cloud size={11} /> {selectedFile.title}</> : view?.space.title}{selected.depth > 0 ? ` / ${getStatusLabel(selected.node.status)}` : ''}</small><button type="button" aria-label={m.close} onClick={() => useKnowledgeRuntime.setState({ selected: null, relation: null })}><X size={17} /></button></header>
        <h2>{selected.node.title || m.untitled}</h2>
        {signal && signal.descendants > 0 ? <div className="knowledge-signal-bars">
          <span><small>{m.progress}</small><b className="p"><i style={{ width: percent(signal.progress) }} /></b><em>{percent(signal.progress)}</em></span>
          <span><small>{m.riskLabel}</small><b className="r"><i style={{ width: percent(signal.risk ?? 0) }} /></b><em>{percent(signal.risk ?? 0)}</em></span>
          <span><small>{m.awaiting}</small><em>{signal.awaiting}</em></span>
          <span><small>{m.descendants}</small><em>{signal.descendants}</em></span>
        </div> : metric ? <span className={`knowledge-status s-${selected.node.status}`}>{getStatusLabel(selected.node.status)}</span> : null}
        {(selected.node.summary || selected.node.body) && <p className="knowledge-body">{selected.node.summary || selected.node.body}</p>}
        <div className="knowledge-detail-actions">
          <button type="button" onClick={() => focusKnowledge(selected.key, selected.depth === 0 ? 'space' : selected.depth === 1 ? 'branch' : 'note')}><Crosshair size={15} />{m.explore}</button>
          <button type="button" onClick={() => onEnter(selected.spaceId, selected.node.id)}><ArrowDownRight size={15} />{selectedFile ? m.cloudOpen : m.open}</button>
        </div>
        {selectedFile && <p className="knowledge-cloud-hint">{m.cloudFileHint}</p>}
        {(projection.active || anchor) && <KnowledgeCascade graph={graph} roots={projection.active ? [...projection.seeds] : [anchor ?? selected.key]} edges={projection.active ? projection.edges : undefined} onFocus={key => focusKnowledge(key, 'keep', true)} locale={locale} />}
        {view && selected.depth === 0 && <button type="button" className="knowledge-management" onClick={() => onManagement(view.space.id)}>
          <span>{m.management}<ChevronRight size={14} /></span>
          <div><small>{m.done}</small><b>{view.signals.statusCounts.done} / {view.signals.nodeCount}</b></div>
          <div><small>{m.waiting}</small><b>{view.signals.statusCounts.blocked + view.signals.statusCounts.waiting}</b></div>
          <div><small>{m.quality}</small><b>{view.quality === null ? m.unjudged : `${view.quality + 1} / 5`}</b></div>
          <div><small>{m.spend}</small><b>{view.money.total.expense.toLocaleString(locale)} {galaxy?.displayCurrency} + ${view.money.aiCost.toFixed(2)} {m.aiUnit}</b></div>
        </button>}
        <h3>{m.related} <small>{related.length}</small></h3>
        <div className="knowledge-relations">{related.slice(0, 30).map(r => {
          const other = byKey.get(r.from === selected.key ? r.to : r.from); if (!other) return null;
          return <div key={r.id}><button type="button" onClick={() => focusKnowledge(other.key, 'keep')}
            onPointerEnter={() => useKnowledgeRuntime.setState({ hoveredRelation: r.id })} onPointerLeave={() => useKnowledgeRuntime.setState({ hoveredRelation: null })}>
            <span className={`knowledge-relation-kind ${r.source === 'candidate' ? 'is-candidate' : ''}`}>{r.from === selected.key ? '→' : '←'} {relationLabel(r.type, locale)}</span><strong>{other.node.title || m.untitled}</strong>
            <small>{m[r.source]}{r.source === 'ai' ? ` · ${r.model} · ${m.confidence} ${Math.round(r.confidence * 100)}%` : ''}</small>
            {r.source !== 'tree' && <span className="knowledge-evidence">{r.source === 'ai' ? r.judgedAt : r.evidence}</span>}
          </button>{r.source === 'ai' && <details><summary>{m.source}</summary><blockquote>{sourceExcerpt(r.evidence)}</blockquote></details>}</div>;
        })}{!related.length && <p>{m.noRelations}</p>}</div>
      </> : projection.active ? <KnowledgeCascade graph={graph} roots={[...projection.seeds]} edges={projection.edges} onFocus={key => focusKnowledge(key, 'keep', true)} locale={locale} /> : null}
      <div className="knowledge-maintenance"><label>{m.auto}<input type="checkbox" checked={galaxy?.knowledgeAuto ?? false} disabled={!maintenance.available} onChange={e => useGalaxyStore.getState().setKnowledgeAuto(e.target.checked)} /></label>
        <small>{maintenance.status === 'running' ? m.running : maintenance.status === 'error' ? m.aiError : maintenance.available ? m.budget : m.unavailable}</small>
      </div>
    </section>}
    <section className="knowledge-ladder" aria-label={m.levelLabel} data-kg-chrome>
      <ol>{KNOWLEDGE_LEVELS.map(item => <li key={item}><button type="button" aria-current={level === item ? 'step' : undefined} onClick={() => goToLevel(item)}>{m.levels[item]}</button></li>)}</ol>
      <label className="knowledge-ring-control"><input type="checkbox" checked={rings} onChange={e => useKnowledgeRuntime.setState({ rings: e.target.checked })} />{m.rings}</label>
      {rings && <p className="knowledge-ring-legend"><span className="p" />{m.ringLegend}</p>}
    </section>
    <footer className="knowledge-bottom" data-kg-chrome>
      <span className="knowledge-live-dot" />{m.status}<small>{graph.nodes.length} {m.nodes} · {graph.relations.length} {m.relations}{graph.omitted ? ` · ${m.limit}` : ''}</small>
      <span className="knowledge-gesture-hint">{m.zoom}</span>
    </footer>
    <div className="knowledge-navigator" data-kg-chrome>
      <KnowledgeMinimap label={m.minimap} width={compact ? 120 : 196} height={compact ? 80 : 128} />
      <div className="knowledge-zoom">
        <button type="button" aria-label={m.closer} title={m.closer} onClick={() => sendKnowledgeCamera({ kind: 'zoom', factor: .6 })}><Plus size={16} /></button>
        <button type="button" aria-label={m.farther} title={m.farther} onClick={() => sendKnowledgeCamera({ kind: 'zoom', factor: 1.65 })}><Minus size={16} /></button>
        <button type="button" aria-label={m.overview} title={m.overview} onClick={() => sendKnowledgeCamera({ kind: 'home' })}><Crosshair size={16} /></button>
      </div>
    </div>
    {projection.active && <section className="knowledge-projection" data-kg-chrome>
      <button type="button" onClick={() => setShowProjection(!showProjection)}>{m.projection} · {projection.nodes.size} <ChevronRight size={14} /></button>
      {showProjection && <div><small>{m.projectionHint}</small>{!projection.nodes.size && <p>{m.empty}</p>}{[...projection.seeds].slice(0, 12).map(key => <button type="button" key={key} onClick={() => focusKnowledge(key, 'keep')}>{byKey.get(key)?.node.title}</button>)}{projection.tree.slice(0, 30).map(r => <button type="button" key={r.id} onClick={() => focusKnowledge(r.to, 'keep')}>{byKey.get(r.from)?.node.title} → {relationLabel(r.type, locale)} → {byKey.get(r.to)?.node.title}</button>)}</div>}
    </section>}
  </>;
}
function sourceExcerpt(evidence: string) {
  try {
    const parsed = JSON.parse(evidence) as { A?: { title?: string; body?: string }; B?: { title?: string; body?: string } };
    return [parsed.A, parsed.B].filter(Boolean).map(item => `${item?.title ?? ''}\n${item?.body ?? ''}`).join('\n\n');
  } catch { return evidence; }
}
