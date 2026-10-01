import { useMemo, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, BufferAttribute, Color, ShaderMaterial, Vector3 } from 'three';
import type { KnowledgeGraph } from '../../galaxy/knowledgeGraph';
import { knowledgeMetrics } from '../../galaxy/knowledgePresentation';
import { knowledgePresence } from './knowledgePresence';

const vertex=`
attribute vec3 aColor; attribute vec3 aMetrics; attribute float aSize;
attribute float aFocus; attribute float aHub;
uniform float uScale; uniform float uBlend; uniform float uDistance;
varying vec3 vColor; varying vec3 vMetrics; varying float vFocus; varying float vHub;
void main(){
 vec4 mv=modelViewMatrix*vec4(position,1.); float d=max(1.,-mv.z);
 float minimum=mix(10.,42.,aHub); float maximum=mix(62.,150.,aHub);
 gl_PointSize=clamp(aSize*uScale/d,minimum,maximum);
 gl_Position=projectionMatrix*mv; vColor=aColor;vMetrics=aMetrics;vFocus=aFocus;vHub=aHub;
}`;
const fragment=`
uniform float uTime; uniform float uBlend; uniform float uRings; uniform float uReduced;
varying vec3 vColor; varying vec3 vMetrics; varying float vFocus; varying float vHub;
const float TAU=6.28318530718;
float band(float r,float a,float b){return smoothstep(a-.012,a,r)*(1.-smoothstep(b,b+.012,r));}
void main(){
 vec2 p=(gl_PointCoord-.5)*2.;float r=length(p);if(r>1.)discard;
 float angle=atan(p.x,-p.y);float turn=fract(angle/TAU+1.);
 // GPT PoC: a white stellar core, colored corona and a soft radial falloff.
 float core=exp(-r*r*190.);float glow=exp(-r*r*17.);
 float breathe=1.+.035*sin(uTime*.8)*(1.-uReduced);
 float rays=pow(abs(cos(angle*4.)),24.)*exp(-r*8.)*.12*vHub;
 vec3 col=mix(vColor,vec3(1.),min(1.,core*.9));float alpha=(core+glow*.68+rays)*breathe;
 if(uRings>.5 && vFocus>.19){
  // Opus PoC: arcs are the actual descendant completion / blocked / review ratios.
  float progress=band(r,.52,.55);float done=step(turn,vMetrics.x);
  col=mix(col,mix(vColor*.3,vec3(.35,.95,.66),done),progress);
  alpha+=progress*mix(.12,.78,done);
  float risk=band(r,.61,.635)*step(1.-vMetrics.y,turn);
  col=mix(col,vec3(1.,.36,.43),risk);alpha+=risk*.85;
  float review=band(r,.70,.72)*step(turn,vMetrics.z);
  col=mix(col,vec3(1.,.78,.32),review);alpha+=review*.75;
 }
 if(vFocus>1.1){float selected=band(r,.86,.88);col=mix(col,vec3(.78,.91,1.),selected);alpha+=selected*.6;}
 gl_FragColor=vec4(col,alpha*uBlend*min(1.,vFocus));
}`;

export function KnowledgeBodies({graph,positions,selected,hovered,highlighted,rings,onPick,onHover}:{graph:KnowledgeGraph;positions:Map<string,[number,number,number]>;selected:string|null;hovered:string|null;highlighted:Set<string>|null;rings:boolean;onPick:(key:string,double:boolean)=>void;onHover:(key:string|null)=>void}) {
  const {size,camera,gl}=useThree();
  const metrics=useMemo(()=>knowledgeMetrics(graph),[graph]);
  const drawn=useMemo(()=>graph.nodes.filter(n=>positions.has(n.key)),[graph.nodes,positions]);
  const geometry=useMemo(()=>{
    const geometry=new BufferGeometry(), points:number[]=[], colors:number[]=[], values:number[]=[], sizes:number[]=[], hubs:number[]=[];
    for(const n of drawn){
      points.push(...positions.get(n.key)!);const color=new Color(n.node.color||'#86cfff');colors.push(color.r,color.g,color.b);
      const m=metrics.get(n.key)!;values.push(m.done/m.count,m.blocked/m.count,m.review/m.count);
      const hub=n.depth<=1;hubs.push(Number(hub));sizes.push(n.depth===0?340:n.depth===1?520:n.depth===2?170:85);
    }
    geometry.setAttribute('position',new BufferAttribute(new Float32Array(points),3));
    geometry.setAttribute('aColor',new BufferAttribute(new Float32Array(colors),3));
    geometry.setAttribute('aMetrics',new BufferAttribute(new Float32Array(values),3));
    geometry.setAttribute('aSize',new BufferAttribute(new Float32Array(sizes),1));
    geometry.setAttribute('aHub',new BufferAttribute(new Float32Array(hubs),1));
    geometry.setAttribute('aFocus',new BufferAttribute(new Float32Array(drawn.length).fill(1),1));
    return geometry;
  },[drawn,positions,metrics]);
  const material=useMemo(()=>new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:AdditiveBlending,uniforms:{uScale:{value:1},uTime:{value:0},uBlend:{value:0},uDistance:{value:5000},uRings:{value:1},uReduced:{value:0}}}),[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material]);
  useEffect(()=>{
    const attr=geometry.getAttribute('aFocus');
    drawn.forEach((n,i)=>attr.setX(i,n.key===selected||n.key===hovered?1.4:highlighted&&!highlighted.has(n.key)?.12:1));attr.needsUpdate=true;
  },[geometry,drawn,selected,hovered,highlighted]);
  const reduced=useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useFrame(({clock})=>{
    material.uniforms.uScale.value=size.height*gl.getPixelRatio()/(2*Math.tan(Math.PI/8));
    material.uniforms.uTime.value=clock.elapsedTime;material.uniforms.uBlend.value=knowledgePresence.blend;
    material.uniforms.uRings.value=Number(rings);material.uniforms.uReduced.value=Number(reduced.current);
  });
  return <group>
    <points geometry={geometry} material={material} frustumCulled={false} raycast={()=>null}/>
    {drawn.map(n=>{
      const p=positions.get(n.key)!, distance=camera.position.distanceTo(new Vector3(...p));
      // Invisible, generous hit geometry. It never invents a visible body.
      const hit=Math.max(n.depth<=1?30:14,distance*2*Math.tan(Math.PI/8)*12/size.height);
      return <mesh key={n.key} position={p} onClick={e=>{e.stopPropagation();onPick(n.key,false);}} onDoubleClick={e=>{e.stopPropagation();onPick(n.key,true);}} onPointerOver={e=>{e.stopPropagation();onHover(n.key);}} onPointerOut={()=>onHover(null)}>
        <sphereGeometry args={[hit,6,4]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/>
      </mesh>;
    })}
  </group>;
}
