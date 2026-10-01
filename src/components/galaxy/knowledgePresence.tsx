import { useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Material, Mesh, Color, Object3D } from 'three';
import { useKnowledgeRuntime } from '../../galaxy/knowledgeRuntime';

// Per-frame presentation only; avoids rerendering React on every animation tick.
export const knowledgePresence = { blend: 0 };
/** GPT PoC's real-material dissolve: the original geometry stays mounted. */
export function KnowledgeNativeGroup({children}:{children:ReactNode}) {
  const group=useRef<Group>(null);
  const materials=useRef(new Map<Material,{opacity:number;transparent:boolean;depthWrite:boolean}>());
  const raycasts=useRef(new Map<Object3D,Object3D['raycast']>());
  const lastAlpha=useRef(-1);
  const {gl}=useThree();
  useFrame(()=>{
    const open=useKnowledgeRuntime.getState().open;
    const alpha=1-Math.min(1,knowledgePresence.blend*1.6);
    const shell=gl.domElement.closest<HTMLElement>('.universe-shell');
    if(shell) shell.style.setProperty('--knowledge-native-opacity',String(alpha));
    if(!group.current) return;
    group.current.visible=alpha>.002;
    if(!open) {
      for(const [m,s] of materials.current) Object.assign(m,s);
      for(const [object,raycast] of raycasts.current) object.raycast=raycast;
      raycasts.current.clear();
      materials.current.clear();lastAlpha.current=-1; return;
    }
    if(alpha===lastAlpha.current) return;
    lastAlpha.current=alpha;
    group.current.traverse(object=>{
      if(!raycasts.current.has(object)) {raycasts.current.set(object,object.raycast);object.raycast=()=>undefined;}
      const mesh=object as Mesh;if(!mesh.material) return;
      for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
        let original=materials.current.get(m);
        if(!original) {original={opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite};materials.current.set(m,original);}
        m.opacity=original.opacity*alpha;m.transparent=true;m.depthWrite=false;
      }
    });
  });
  return <group ref={group}>{children}</group>;
}
export function KnowledgeDarkness({theme}:{theme:'dark'|'light'}) {
  const {gl}=useThree();
  const native=useRef(new Color()), dark=useRef(new Color('#030609'));
  useFrame(()=>{
    native.current.set(theme==='dark'?'#050706':'#f7fbff').lerp(dark.current,knowledgePresence.blend);
    gl.setClearColor(native.current,1);
  });
  return null;
}
