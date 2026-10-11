import {useEffect,useMemo} from 'react';
import {useTexture} from '@react-three/drei';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {ART_PALETTE,materialPaths,type ArtSurface} from './art-config';
import {fallbackArtMaterials,type ArtMaterials} from './art-geometry';
import type {qualityProfile} from './render-quality';
export type ArtProfile=ReturnType<typeof qualityProfile>;
export function configureMaps(maps:THREE.Texture[],paths:string[],anisotropy:number){maps.forEach((map,i)=>{map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=paths[i].includes('_color_')?THREE.SRGBColorSpace:THREE.NoColorSpace;map.anisotropy=Math.min(8,anisotropy);map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;map.needsUpdate=true;});}
export function useArtMaterials(profile:ArtProfile,surfaces:readonly ArtSurface[]):ArtMaterials{
  const {gl}=useThree();const paths=surfaces.flatMap(id=>Object.values(materialPaths(id,profile.normal,1024,profile.resolution==='2k'?1024:512)));
  const maps=useTexture(paths);
  useEffect(()=>configureMaps(maps,paths,gl.capabilities.getMaxAnisotropy()),[maps,gl,paths.join('|')]);
  const materials=useMemo(()=>{const result=fallbackArtMaterials();let offset=0;
    for(const surface of surfaces){const count=profile.normal?3:2,map=maps[offset],arm=maps[offset+1],normal=profile.normal?maps[offset+2]:undefined;offset+=count;result[surface].dispose();
      result[surface]=new THREE.MeshStandardMaterial({map,aoMap:arm,aoMapIntensity:.35,roughnessMap:arm,metalnessMap:surface==='bronze'?arm:undefined,normalMap:normal,normalScale:new THREE.Vector2(.25,.25),color:surface==='foundation'?'#ded9c7':'#ffffff',metalness:surface==='bronze'?.85:0,roughness:1});
    }return result;
  },[maps,profile.normal,surfaces.join('|')]);
  useEffect(()=>()=>Object.values(materials).forEach(m=>m.dispose()),[materials]);return materials;
}
export function addSurfaceDetail(material:THREE.MeshStandardMaterial,texture:THREE.Texture,color:string,selective=false){
  const tint=new THREE.Color(color);material.onBeforeCompile=shader=>{shader.uniforms.artDetail={value:texture};shader.uniforms.artTint={value:tint};shader.vertexShader='varying vec2 vArtUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vArtUv=transformed.xy*1.6;\n#include <project_vertex>');shader.fragmentShader='varying vec2 vArtUv; uniform sampler2D artDetail; uniform vec3 artTint;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>\n float artValue=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));\n diffuseColor.rgb=mix(diffuseColor.rgb,artValue*artTint,${selective?'0.82*step(diffuseColor.r*1.12,max(diffuseColor.g,diffuseColor.b))':'0.82'});\n vec3 artGrain=texture2D(artDetail,vArtUv).rgb;\n diffuseColor.rgb*=mix(vec3(1.0),artGrain*1.6,0.22);`);};material.customProgramCacheKey=()=>`surface-detail:${color}:${selective}`;
}
export const CHARACTER_SURFACES=['bronze','cloth','leather'] as const;
export const LANDMARK_SURFACES=['foundation','bronze'] as const;
export const BOX_SURFACES=['wood'] as const;
export const STONE_SURFACES=['foundation'] as const;

export const NO_SURFACES=[] as const;
