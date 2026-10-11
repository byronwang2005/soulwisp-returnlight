import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import type {Vec2} from '@wangxu/shared';
import {routeWorldPoint,type NavigationTarget} from './navigation';

export function NavigationTrail({route,target,reduced}:{route:Vec2[];target?:NavigationTarget;reduced:boolean}) {
  const material=useRef<THREE.ShaderMaterial>(null);
  const marker=useRef<THREE.MeshBasicMaterial>(null);
  const geometry=useMemo(()=>{
    const positions:number[]=[],distances:number[]=[],sides:number[]=[];let travelled=0;
    for(let i=1;i<route.length;i++){
      const a=routeWorldPoint(route[i-1]),b=routeWorldPoint(route[i]);
      const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<.001)continue;
      const nx=-dz/length*.16,nz=dx/length*.16;
      const corners=[[a[0]+nx,a[1],a[2]+nz],[a[0]-nx,a[1],a[2]-nz],[b[0]+nx,b[1],b[2]+nz],[b[0]-nx,b[1],b[2]-nz]];
      for(const index of [0,1,2,2,1,3]){positions.push(...corners[index]);distances.push(travelled+(index>=2?length:0));sides.push(index%2? -1:1);}
      travelled+=length;
    }
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));result.setAttribute('routeDistance',new THREE.Float32BufferAttribute(distances,1));result.setAttribute('routeSide',new THREE.Float32BufferAttribute(sides,1));return result;
  },[route]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  const uniforms=useMemo(()=>({time:{value:0}}),[]);
  useFrame(({clock})=>{if(material.current)material.current.uniforms.time.value=reduced?0:clock.elapsedTime;if(marker.current)marker.current.opacity=reduced?.85:.75+.15*Math.sin(clock.elapsedTime*2);});
  return <group>
    {target&&<mesh name="navigation:destination" position={routeWorldPoint(target)} rotation={[-Math.PI/2,0,0]} renderOrder={2}><ringGeometry args={[target.radius/20,target.radius/20+.09,48]}/><meshBasicMaterial ref={marker} color="#ffe5a0" transparent opacity={.85} depthWrite={false} toneMapped={false}/></mesh>}
    {route.length>1&&<mesh name="navigation:ground-trail" geometry={geometry} renderOrder={2}>
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide}
      vertexShader={'attribute float routeDistance; attribute float routeSide; varying float along; varying float across; void main(){along=routeDistance;across=routeSide;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}' }
      fragmentShader={'uniform float time; varying float along; varying float across; void main(){float dash=mod(along-time*.7,1.15);if(dash>.72)discard;float edge=1.0-smoothstep(.25,1.0,abs(across));float shimmer=.82+.18*sin(along*4.0-time*2.0);gl_FragColor=vec4(mix(vec3(.96,.68,.23),vec3(1.0,.96,.73),edge),(.22+.78*edge)*shimmer);}'}/>
  </mesh>}
  </group>;
}
