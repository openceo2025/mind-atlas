import { ChevronDown, ChevronRight, CornerDownRight, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { knowledgeCascade, type CascadeItem } from '../../galaxy/knowledgePresentation';
import { useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';
import { knowledgeMessages, relationLabel } from '../../i18n/knowledgeMessages';
import type { KnowledgeGraph } from '../../galaxy/knowledgeGraph';

export function KnowledgeCascade({graph,roots,edges,onFocus,locale}:{graph:KnowledgeGraph;roots:string[];edges?:Set<string>;onFocus:(key:string)=>void;locale:string}) {
  const forest=useMemo(()=>knowledgeCascade(graph,roots,edges),[graph,roots.join('|'),edges]);
  const m=knowledgeMessages[locale.startsWith('ja')?'ja':'en'];
  const selected=useKnowledgeRuntime(s=>s.selected);
  return <section className="knowledge-cascade"><h3>{m.cascade}</h3><p>{m.cascadeHint}</p><ol role="tree" aria-label={m.cascade}>
    {forest.map(item=><CascadeRow key={item.key} item={item} depth={0} graph={graph} selected={selected} onFocus={onFocus} locale={locale}/>)}
  </ol></section>;
}
function CascadeRow({item,depth,graph,selected,onFocus,locale}:{item:CascadeItem;depth:number;graph:KnowledgeGraph;selected:string|null;onFocus:(key:string)=>void;locale:string}) {
  const [expanded,setExpanded]=useState(depth<2);
  const node=graph.nodes.find(n=>n.key===item.key);if(!node)return null;
  const m=knowledgeMessages[locale.startsWith('ja')?'ja':'en'];
  const hover=(active:boolean)=>useKnowledgeRuntime.setState({hovered:active?item.key:null,hoveredRelation:active?item.via?.id??null:null});
  return <li role="treeitem" aria-expanded={item.children.length?expanded:undefined} aria-selected={selected===item.key}>
    <div className={`knowledge-cascade-row ${selected===item.key?'is-selected':''}`} onPointerEnter={()=>hover(true)} onPointerLeave={()=>hover(false)} onFocus={()=>hover(true)} onBlur={()=>hover(false)}>
      {item.children.length?<button type="button" className="knowledge-cascade-toggle" aria-label={`${expanded?m.collapse:m.expand} ${node.node.title}`} onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronDown size={12}/>:<ChevronRight size={12}/>}</button>:<CornerDownRight size={12}/>}
      <button type="button" className="knowledge-cascade-node" onClick={()=>onFocus(item.key)}>
        {item.via&&<small className={item.via.source==='candidate'?'is-candidate':''}>{item.direction==='in'?'←':'→'} {relationLabel(item.via.type,locale)}</small>}
        <span><i style={{background:node.node.color}}/>{node.node.title}</span>
      </button>
      {item.via&&<button type="button" className="knowledge-cascade-info" aria-label={`${m.source}: ${node.node.title}`} onClick={()=>useKnowledgeRuntime.setState({relation:item.via!.id})}><Info size={12}/></button>}
    </div>
    {expanded&&item.children.length>0&&<ol role="group">{item.children.map(child=><CascadeRow key={child.key} item={child} depth={depth+1} graph={graph} selected={selected} onFocus={onFocus} locale={locale}/>)}</ol>}
  </li>;
}
