import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import type {MapNode,WorldObject} from '@wangxu/shared';
import {useArtMaterials,type ArtProfile} from './ArtMaterials';
import {assembleArt,disposeArtGeometry} from './art-geometry';
import {buildRegions,citySilhouetteParts} from './region-geometry';
const SURFACES=['foundation','wood','bronze','cloth'] as const;
export function LostCity({nodes,edges,profile}:{nodes:MapNode[];edges:[string,string][];profile:ArtProfile}){
 const materials=useArtMaterials(profile,SURFACES),key=JSON.stringify([nodes,edges]);
 const regions=useMemo(()=>buildRegions(nodes,edges,materials),[key,materials]),skyMaterials=useMemo(()=>Object.fromEntries(Object.entries(materials).map(([key,value])=>[key,value.clone()])) as typeof materials,[materials]),silhouette=useMemo(()=>assembleArt(citySilhouetteParts(nodes),skyMaterials,'lost-city:skyline'),[key,skyMaterials]);
 useEffect(()=>()=>Object.values(skyMaterials).forEach(m=>m.dispose()),[skyMaterials]);
 useEffect(()=>()=>{disposeArtGeometry(regions);disposeArtGeometry(silhouette);},[regions,silhouette]);
 return <group><primitive object={regions}/><primitive object={silhouette}/></group>;
}
export function SoulFibers({objects,reduced}:{objects:WorldObject[];reduced:boolean}){
 const group=useRef<THREE.Group>(null),key=JSON.stringify(objects.filter(o=>o.kind==='beacon').map(o=>[o.id,o.x,o.y]));
 const geometry=useMemo(()=>{const points:number[]=[];for(const o of objects.filter(o=>o.kind==='beacon'))for(let i=0;i<5;i++){const a=i*2.4;for(let j=0;j<5;j++){for(const t of [j/5,(j+1)/5])points.push(o.x+Math.cos(a)*(.3+t*.5),.9+i*.12+t*.7,o.y+Math.sin(a+t*.5)*.5);}}return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));},[key]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);useFrame(({clock})=>{if(group.current)group.current.scale.y=reduced?1:1+Math.sin(clock.elapsedTime*.35)*.035;});
 return <group ref={group}><lineSegments geometry={geometry} name="beacon:silver-fibers"><lineBasicMaterial color="#d5d9cd" transparent opacity={.42} depthWrite={false}/></lineSegments></group>;
}
