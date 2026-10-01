import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from 'three';
import type { KnowledgeGraph, KnowledgeRelation } from '../../galaxy/knowledgeGraph';
import { knowledgePresence } from './knowledgePresence';

const vertex=`
attribute vec3 aColor;attribute vec4 aMeta;attribute float aFocus;
varying vec3 vColor;varying vec4 vMeta;varying float vFocus;
void main(){vColor=aColor;vMeta=aMeta;vFocus=aFocus;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment=`
uniform float uTime;uniform float uDistance;uniform float uBlend;uniform float uReduced;
varying vec3 vColor;varying vec4 vMeta;varying float vFocus;
void main(){
 float t=vMeta.x;float crossSpace=step(90.,vMeta.y);float tier=mod(vMeta.y,100.);float candidate=vMeta.z;float macro=vMeta.w;
 float overview=smoothstep(3000.,7000.,uDistance);
 float lod=macro>.5?overview:mix(1.,tier>1.5?.05:.42,overview);
 // Aggregate remote links at a distance; reveal their actual path on focus.
 if(crossSpace>.5 && macro<.5)lod*=vFocus>1.1?.8:.035;
 float pulse=fract(t*2.-uTime*.32*(1.-uReduced));
 float head=smoothstep(0.,.035,pulse)*(1.-smoothstep(.035,.13,pulse));
 if(candidate>.5 && fract(t*38.)>.6)discard;
 float base=mix(.24,.09,candidate);float focus=vFocus;
 float alpha=(base+head*mix(.65,.28,candidate))*lod*focus*uBlend;
 gl_FragColor=vec4(vColor+vec3(.55)*head,alpha);
}`;
export function KnowledgeFilaments({graph,positions,distance,selected,hovered,relation,highlighted}:{graph:KnowledgeGraph;positions:Map<string,[number,number,number]>;distance:number;selected:string|null;hovered:string|null;relation:string|null;highlighted:Set<string>|null}) {
  const data=useMemo(()=>{
    const nodes=new Map(graph.nodes.map(n=>[n.key,n]));
    const roots=new Map(graph.nodes.filter(n=>n.depth===0).map(n=>[n.spaceId,n.key]));
    const edges:{r:KnowledgeRelation;macro:boolean}[]=graph.relations.map(r=>({r,macro:false}));
    const groups=new Map<string,KnowledgeRelation>();
    for(const r of graph.relations){const a=nodes.get(r.from),b=nodes.get(r.to);if(!a||!b||a.spaceId===b.spaceId)continue;
      const from=roots.get(a.spaceId),to=roots.get(b.spaceId);if(!from||!to)continue;
      const id=JSON.stringify([a.spaceId,b.spaceId,r.type,r.source==='candidate']);if(!groups.has(id))groups.set(id,{...r,from,to});}
    for(const r of groups.values())edges.push({r,macro:true});
    const p:number[]=[],colors:number[]=[],meta:number[]=[],edgeIds:string[]=[],endpoints:string[][]=[];
    for(const {r,macro} of edges){
      const pa=positions.get(r.from),pb=positions.get(r.to);if(!pa||!pb)continue;
      const a=new Vector3(...pa),b=new Vector3(...pb),delta=b.clone().sub(a);const side=new Vector3(-delta.y,delta.x,delta.z*.1).normalize().multiplyScalar(Math.min(130,delta.length()*.14));
      const color=new Color(r.type==='contradicts'?'#ed809e':/support|derived/.test(r.type)?'#9bdbbf':/depend|cause/.test(r.type)?'#d6bb81':nodes.get(r.from)?.node.color||'#86cfff');
      const depth=Math.max(nodes.get(r.from)?.depth??0,nodes.get(r.to)?.depth??0)+(nodes.get(r.from)?.spaceId!==nodes.get(r.to)?.spaceId?100:0);
      for(let i=0;i<24;i++)for(const t of [i/24,(i+1)/24]){
        p.push(...a.clone().lerp(b,t).addScaledVector(side,Math.sin(Math.PI*t)).toArray());colors.push(color.r,color.g,color.b);meta.push(t,depth,Number(r.source==='candidate'),Number(macro));edgeIds.push(r.id);endpoints.push([r.from,r.to]);
      }
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(p),3));geometry.setAttribute('aColor',new BufferAttribute(new Float32Array(colors),3));geometry.setAttribute('aMeta',new BufferAttribute(new Float32Array(meta),4));geometry.setAttribute('aFocus',new BufferAttribute(new Float32Array(edgeIds.length).fill(1),1));
    return {geometry,edgeIds,endpoints};
  },[graph,positions]);
  const material=useMemo(()=>new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:AdditiveBlending,uniforms:{uTime:{value:0},uDistance:{value:5000},uBlend:{value:0},uReduced:{value:0}}}),[]);
  useEffect(()=>()=>data.geometry.dispose(),[data]);useEffect(()=>()=>material.dispose(),[material]);
  useEffect(()=>{const a=data.geometry.getAttribute('aFocus');data.edgeIds.forEach((id,i)=>{
    const hit=id===relation||highlighted?.has(id)||data.endpoints[i].includes(selected??'')||data.endpoints[i].includes(hovered??'');a.setX(i,hit?2.4:highlighted?.size ? .1 : 1);
  });a.needsUpdate=true;},[data,selected,hovered,relation,highlighted]);
  const reduced=useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useFrame(({clock})=>{material.uniforms.uTime.value=clock.elapsedTime;material.uniforms.uDistance.value=distance;material.uniforms.uBlend.value=knowledgePresence.blend;material.uniforms.uReduced.value=Number(reduced.current);});
  return <lineSegments geometry={data.geometry} material={material} frustumCulled={false} raycast={()=>null}/>;
}
