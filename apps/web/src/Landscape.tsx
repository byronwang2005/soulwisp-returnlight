import {useLayoutEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {type MapNode,segmentDistance} from '@wangxu/shared';
// Low stone banks, broken masonry and moss occupy only the non-traversable margin.
export function Landscape({nodes,edges,detailed}:{nodes:MapNode[];edges:[string,string][];detailed:boolean}){
 const rocks=useRef<THREE.InstancedMesh>(null),walls=useRef<THREE.InstancedMesh>(null),moss=useRef<THREE.InstancedMesh>(null);
 const instances=useMemo(()=>{
  const stone:THREE.Matrix4[]=[],ruins:THREE.Matrix4[]=[],green:THREE.Matrix4[]=[],dummy=new THREE.Object3D();
  const occupied=(x:number,y:number,r:number)=>nodes.some(n=>Math.hypot(x-n.x,y-n.y)<n.radius+r+.7)||edges.some(([a,b])=>segmentDistance({x,y},nodes.find(n=>n.id===a)!,nodes.find(n=>n.id===b)!)<1.75+r+.7);
  for(const [ni,node] of nodes.entries())for(let i=0;i<(detailed?40:20);i++){
   const angle=i*Math.PI*2/(detailed?40:20),radius=node.radius+2.2+(i%3)*.7,x=node.x+Math.cos(angle)*radius,z=node.y+Math.sin(angle)*radius;
   if(occupied(x,z,1.15))continue;
   const height=.35+(i%4)*.16;dummy.position.set(x,-.25+height*.5,z);dummy.rotation.set(.1*(i%3),angle,.08);dummy.scale.set(1.4+(i%3)*.4,height,1.1);dummy.updateMatrix();stone.push(dummy.matrix.clone());
   if(i%3===0){dummy.position.y=height*.4;dummy.scale.set(1.3,.08,.8);dummy.updateMatrix();green.push(dummy.matrix.clone());}
   // Keep high silhouettes on the distant rear boundary; nearby banks remain below the character.
   if(i%7===0&&Math.sin(angle)<-.45){const far=node.radius+5.8;const bx=node.x+Math.cos(angle)*far,bz=node.y+Math.sin(angle)*far;if(!occupied(bx,bz,2)){dummy.position.set(bx,.65,bz);dummy.rotation.set(0,angle+.3,0);dummy.scale.set(2.6,1.7+(ni%2)*.4,.8);dummy.updateMatrix();ruins.push(dummy.matrix.clone());}}
  }return {stone,ruins,green};
 },[nodes,edges,detailed]);
 useLayoutEffect(()=>{for(const [ref,list]of [[rocks,instances.stone],[walls,instances.ruins],[moss,instances.green]] as const){list.forEach((matrix,i)=>ref.current!.setMatrixAt(i,matrix));ref.current!.instanceMatrix.needsUpdate=true;ref.current!.computeBoundingSphere();}},[instances]);
 return <group name="outside-city-landscape"><instancedMesh ref={rocks} args={[undefined,undefined,instances.stone.length]} receiveShadow><dodecahedronGeometry args={[1,0]}/><meshStandardMaterial color="#666456" roughness={1}/></instancedMesh><instancedMesh ref={walls} args={[undefined,undefined,instances.ruins.length]} castShadow={detailed} receiveShadow><boxGeometry/><meshStandardMaterial color="#777566" roughness={.94}/></instancedMesh><instancedMesh ref={moss} args={[undefined,undefined,instances.green.length]}><dodecahedronGeometry args={[1,0]}/><meshStandardMaterial color="#455342" roughness={1}/></instancedMesh></group>;
}
