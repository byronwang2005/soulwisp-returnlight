import {useEffect,useMemo} from 'react';
import {useTexture} from '@react-three/drei';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {SCENE,SCENE_MATERIALS,type MapNode} from '@wangxu/shared';
import {groundPolygons,pavingGeometry} from './ground-geometry';
import type {qualityProfile} from './render-quality';

const NORMAL_SCALE=new THREE.Vector2(.45,.45);
type Profile=ReturnType<typeof qualityProfile>;
function Paving({geometry,name,profile}:{geometry:THREE.BufferGeometry;name:string;profile:Profile}){
  const {gl}=useThree();
  const maps=useTexture(['Diffuse','nor_gl','arm'].map(map=>`/assets/ground/${name}_${map}_${profile.resolution}.jpg`));
  useEffect(()=>{maps.forEach((map,i)=>{map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=i===0?THREE.SRGBColorSpace:THREE.NoColorSpace;map.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.needsUpdate=true;});},[maps,gl]);
  return <mesh geometry={geometry} receiveShadow name={`ground:${name}`}>
    <meshStandardMaterial map={maps[0]} normalMap={profile.normal?maps[1]:undefined} normalScale={NORMAL_SCALE} aoMap={maps[2]} aoMapIntensity={.6} roughnessMap={maps[2]} metalness={0} roughness={1} color="#bab7ab" side={THREE.FrontSide} onBeforeCompile={shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n diffuseColor.rgb=mix(vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),diffuseColor.rgb,.45);');}}/>
  </mesh>;
}
export function Ground({nodes,edges,profile}:{nodes:MapNode[];edges:[string,string][];profile:Profile}){
  const key=JSON.stringify([nodes,edges]);
  const geometry=useMemo(()=>{const polygons=groundPolygons(nodes,edges,SCENE.corridorRadius/SCENE.unitsPerMeter);return {floor:pavingGeometry(polygons.floor,SCENE_MATERIALS.floor.meters),roads:pavingGeometry(polygons.roads,SCENE_MATERIALS.road.meters)};},[key]);
  useEffect(()=>()=>{geometry.floor.dispose();geometry.roads.dispose();},[geometry]);
  return <group position={[0,0,0]}><Paving geometry={geometry.floor} name={SCENE_MATERIALS.floor.id} profile={profile}/><Paving geometry={geometry.roads} name={SCENE_MATERIALS.road.id} profile={profile}/></group>;
}
