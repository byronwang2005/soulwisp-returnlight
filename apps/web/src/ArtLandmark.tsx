import {useEffect,useMemo} from 'react';
import * as THREE from 'three';
import type {WorldObject} from '@wangxu/shared';
import {useArtMaterials,LANDMARK_SURFACES,type ArtProfile} from './ArtMaterials';
import {assembleArt,disposeArtGeometry,landmarkParts} from './art-geometry';
export function ArtLandmark({object,profile}:{object:WorldObject;profile:ArtProfile}){
  const materials=useArtMaterials(profile,LANDMARK_SURFACES);
  const group=useMemo(()=>{const local=object.id==='cleanse'?{...materials,bronze:materials.bronze.clone()}:materials;if(object.id==='cleanse')local.bronze.color.set('#9ab7a5');return assembleArt(landmarkParts(object.kind,object.id),local,`landmark:${object.id}`);},[object.id,object.kind,materials]);
  useEffect(()=>()=>{disposeArtGeometry(group);if(object.id==='cleanse')group.traverse(n=>{if(n instanceof THREE.Mesh&&n.material!==materials.foundation)(n.material as THREE.Material).dispose();});},[group]);
  const lit=object.progress>=1,color=object.kind==='altar'?'#b68eaa':object.id==='cleanse'?'#9ab7a5':lit?'#efe4ce':'#dfbc87';
  const height=object.kind==='beacon'?1.85:object.kind==='exit'?2.1:object.kind==='altar'?1.13:object.id==='purify'?1.15:.72;
  return <group><primitive object={group}/><mesh position={[0,height,object.kind==='exit'?.04:0]}><icosahedronGeometry args={[object.kind==='exit'?.28:object.kind==='beacon'?.17:.12,0]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={lit?2.2:.5} roughness={.45}/></mesh>{object.kind==='beacon'&&<pointLight position={[0,height,0]} color={color} intensity={lit?6:1} distance={8}/>}</group>;
}
