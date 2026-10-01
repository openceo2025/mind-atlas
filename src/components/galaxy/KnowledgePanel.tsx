import { ArrowDownRight, ChevronRight, Crosshair, Minus, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMindAtlasLocale } from '../../i18n/I18nProvider';
import { knowledgeMessages, relationLabel } from '../../i18n/knowledgeMessages';
import { isKnowledgeDemo } from '../../galaxy/knowledgeDemo';
import { projectKnowledge } from '../../galaxy/knowledgeGraph';
import { useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';
import { useGalaxyStore } from '../../galaxy/galaxyStore';
import type { SpaceView } from '../../galaxy/galaxySummary';
import { KnowledgeCascade } from './KnowledgeCascade';
import { knowledgeMetrics } from '../../galaxy/knowledgePresentation';

export function KnowledgePanel({ views, onEnter, onManagement }: { views: SpaceView[]; onEnter: (spaceId: string, nodeId?: string) => void; onManagement: (spaceId: string) => void }) {
  const { locale } = useMindAtlasLocale();
  const m = knowledgeMessages[locale.startsWith('ja') ? 'ja' : 'en'];
  const galaxy = useGalaxyStore(s => s.galaxy);
  const runtime = useKnowledgeRuntime();
  const { graph, maintenance } = runtime;
  const [showProjection, setShowProjection] = useState(false);
  const projection = useMemo(() => projectKnowledge(graph, runtime.query, runtime.lens), [graph, runtime.query, runtime.lens]);
  const selected = graph.nodes.find(n => n.key === runtime.selected);
  const view = views.find(v => v.space.id === selected?.spaceId);
  const related = graph.relations.filter(r => r.from === selected?.key || r.to === selected?.key);
  const inspected = graph.relations.find(r=>r.id===runtime.relation);
  const metrics=useMemo(()=>knowledgeMetrics(graph),[graph]);
  const metric=selected&&metrics.get(selected.key);
  const focus = (key: string, distance = 1800, keepPath = false) => {
    const position = runtime.positions.get(key);
    useKnowledgeRuntime.setState({ selected: key, ...(!keepPath?{anchor:key}:{}), ...(position ? { focus: { position, distance, nonce: performance.now() } } : {}) });
  };
  const zoom = (ratio: number) => {
    const target = runtime.selected ? runtime.positions.get(runtime.selected) : runtime.positions.get(graph.nodes.find(n => n.depth === 0 && n.spaceId === galaxy?.activeSpaceId)?.key ?? '');
    useKnowledgeRuntime.setState({ focus: { position: target ?? [0, 0, -340], distance: Math.max(300, Math.min(60000, runtime.distance * ratio)), nonce: performance.now() } });
  };
  return <>
    <section className="knowledge-heading">
      <span className="knowledge-eyebrow">{m.brand} / {m.title}</span>
      {isKnowledgeDemo() && <small className="knowledge-demo-badge">{m.sample}</small>}
      <h1>{m.hint}</h1>
      <form className="knowledge-search" onSubmit={e => { e.preventDefault(); const first = graph.nodes.find(n => projection.seeds.has(n.key)); if (first) focus(first.key, 2800); }}>
        <Search size={17} /><input aria-label={m.search} placeholder={m.search} value={runtime.query} onChange={e => useKnowledgeRuntime.setState({ query: e.target.value })} />
        {runtime.query && <button type="button" aria-label={m.close} onClick={() => useKnowledgeRuntime.setState({ query: '' })}><X size={16} /></button>}
      </form>
      <nav className="knowledge-lenses" aria-label={m.title}>
        {(['all', 'dependencies', 'evidence', 'risk'] as const).map(lens => <button key={lens} type="button" aria-pressed={runtime.lens === lens} onClick={() => useKnowledgeRuntime.setState({ lens })}>{m[lens]}</button>)}
      </nav>
      <label className="knowledge-ring-control"><input type="checkbox" checked={runtime.rings} onChange={e=>useKnowledgeRuntime.setState({rings:e.target.checked})}/>{m.rings}<span>{m.ringLegend}</span></label>
    </section>
    <aside className="knowledge-spaces">
      {views.map(v => {
        const key = graph.nodes.find(n => n.spaceId === v.space.id && n.depth === 0)?.key;
        return <button key={v.space.id} type="button" className={selected?.spaceId === v.space.id ? 'is-selected' : ''} onClick={() => key && focus(key, 3800)}>
          <i style={{ background: v.space.color }} /><span>{v.space.title}<small>{v.signals.nodeCount} {m.nodes}</small></span><ChevronRight size={14} />
        </button>;
      })}
    </aside>
    <section className="knowledge-detail" aria-label={m.related}>
      {(selected || projection.active) && <KnowledgeCascade graph={graph} roots={projection.active?[...projection.seeds]:[runtime.anchor??selected!.key]} edges={projection.active?projection.edges:undefined} onFocus={key=>focus(key,950,true)} locale={locale}/>}
      {inspected&&<article className="knowledge-relation-detail"><header><small>{m.relationDetail}</small><button type="button" aria-label={m.close} onClick={()=>useKnowledgeRuntime.setState({relation:null})}><X size={14}/></button></header>
        <strong>{graph.nodes.find(n=>n.key===inspected.from)?.node.title} → {relationLabel(inspected.type,locale)} → {graph.nodes.find(n=>n.key===inspected.to)?.node.title}</strong>
        <small>{m[inspected.source]}{inspected.source==='ai'?` · ${inspected.model} · ${Math.round(inspected.confidence*100)}%`:''}</small><blockquote>{sourceExcerpt(inspected.evidence)}</blockquote>
      </article>}
      {selected ? <>
        <header><small>{view?.space.title} / {selected.node.nodeType}</small><button type="button" aria-label={m.close} onClick={() => useKnowledgeRuntime.setState({ selected: null })}><X size={17} /></button></header>
        <h2>{selected.node.title}</h2><span className="knowledge-status">{selected.node.status}</span>
        {metric&&<div className="knowledge-node-metrics"><span>{m.done}<b>{metric.done}/{metric.count}</b></span><span>{m.waiting}<b>{metric.blocked}</b></span><span>{m.nodes}<b>{metric.count}</b></span></div>}
        <p className="knowledge-body">{selected.node.summary || selected.node.body || '—'}</p>
        <div className="knowledge-detail-actions"><button type="button" onClick={() => focus(selected.key, 650)}><Crosshair size={15} />{m.explore}</button><button type="button" onClick={() => onEnter(selected.spaceId, selected.node.id)}><ArrowDownRight size={15} />{m.open}</button></div>
        {view && <button type="button" className="knowledge-management" onClick={() => onManagement(view.space.id)}>
          <span>{m.management}<ChevronRight size={14} /></span>
          <div><small>{m.done}</small><b>{view.signals.statusCounts.done} / {view.signals.nodeCount}</b></div>
          <div><small>{m.waiting}</small><b>{view.signals.statusCounts.blocked + view.signals.statusCounts.waiting}</b></div>
          <div><small>{m.quality}</small><b>{view.quality === null ? m.unjudged : `${view.quality + 1} / 5`}</b></div>
          <div><small>{m.spend}</small><b>{view.money.total.expense.toLocaleString(locale)} {galaxy?.displayCurrency} + ${view.money.aiCost.toFixed(2)} {m.aiUnit}</b></div>
        </button>}
        <h3>{m.related} <small>{related.length}</small></h3>
        <div className="knowledge-relations">{related.slice(0, 30).map(r => {
          const other = graph.nodes.find(n => n.key === (r.from === selected.key ? r.to : r.from)); if (!other) return null;
          return <div key={r.id}><button type="button" onClick={() => focus(other.key)}>
            <span className={`knowledge-relation-kind ${r.source === 'candidate' ? 'is-candidate' : ''}`}>{r.from === selected.key ? '→' : '←'} {relationLabel(r.type,locale)}</span><strong>{other.node.title}</strong>
            <small>{m[r.source]}{r.source === 'ai' ? ` · ${r.model} · ${m.confidence} ${Math.round(r.confidence * 100)}%` : ''}</small>
            <span className="knowledge-evidence">{r.source === 'ai' ? r.judgedAt : r.evidence}</span>
          </button>{r.source === 'ai' && <details><summary>{m.source}</summary><blockquote>{sourceExcerpt(r.evidence)}</blockquote></details>}</div>;
        })}{!related.length && <p>{m.noRelations}</p>}</div>
      </> : <><span className="knowledge-eyebrow">{m.title}</span><h2>{graph.nodes.length} <small>{m.nodes}</small></h2><p>{m.select}</p><p className="knowledge-muted">{m.candidateInfo}</p></>}
      <div className="knowledge-maintenance"><label>{m.auto}<input type="checkbox" checked={galaxy?.knowledgeAuto ?? false} disabled={!maintenance.available} onChange={e => useGalaxyStore.getState().setKnowledgeAuto(e.target.checked)} /></label>
        <small>{maintenance.status === 'running' ? m.running : maintenance.status === 'error' ? m.aiError : maintenance.available ? m.budget : m.unavailable}</small>
      </div>
    </section>
    <footer className="knowledge-bottom">
      <div><span className="knowledge-live-dot" />{m.status}<small>{graph.nodes.length} {m.nodes} · {graph.relations.length} {m.relations}{graph.omitted ? ` · ${m.limit}` : ''}</small></div>
      <span className="knowledge-gesture-hint">{m.zoom}</span>
      <span className="knowledge-scale">{runtime.distance>7000?m.overviewLevel:runtime.distance>1800?m.regionLevel:m.nodeLevel}</span>
      <div className="knowledge-zoom"><button type="button" aria-label={m.farther} onClick={() => zoom(1.5)}><Minus size={17} /></button><button type="button" onClick={() => {
        useKnowledgeRuntime.setState({ focus: { ...runtime.overview, nonce: performance.now() } });
      }} aria-label={m.overview}><Crosshair size={17} /></button><button type="button" aria-label={m.closer} onClick={() => zoom(.65)}><Plus size={17} /></button></div>
    </footer>
    {projection.active && <section className="knowledge-projection">
      <button type="button" onClick={() => setShowProjection(!showProjection)}>{m.projection} · {projection.nodes.size} <ChevronRight size={14} /></button>
      {showProjection && <div><small>{m.projectionHint}</small>{!projection.nodes.size && <p>{m.empty}</p>}{[...projection.seeds].slice(0, 12).map(key => <button type="button" key={key} onClick={() => focus(key)}>{graph.nodes.find(n => n.key === key)?.node.title}</button>)}{projection.tree.slice(0, 30).map(r => <button type="button" key={r.id} onClick={() => focus(r.to)}>{graph.nodes.find(n => n.key === r.from)?.node.title} → {r.type} → {graph.nodes.find(n => n.key === r.to)?.node.title}</button>)}</div>}
    </section>}
  </>;
}
function sourceExcerpt(evidence: string) {
  try {
    const parsed = JSON.parse(evidence) as { A?: { title?: string; body?: string }; B?: { title?: string; body?: string } };
    return [parsed.A, parsed.B].filter(Boolean).map(item => `${item?.title ?? ''}\n${item?.body ?? ''}`).join('\n\n');
  } catch { return evidence; }
}
