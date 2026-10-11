import {createContext,useContext,useEffect,useMemo,type ReactNode} from 'react';
import * as THREE from 'three';
import type {GameView} from '@wangxu/shared';
import {explorationMemory,fogBounds,fogEnabled} from './fog-memory';
interface FogUniforms {cityFogMap:{value:THREE.DataTexture};cityFogBounds:{value:THREE.Vector4};cityFogActive:{value:number}}
const FogContext=createContext<FogUniforms|null>(null);
export function VisionFogProvider({view,children}:{view?:GameView;children:ReactNode}){
 const uniforms=useMemo(()=>{const texture=new THREE.DataTexture(new Uint8Array(256*256*4),256,256,THREE.RGBAFormat);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;return {cityFogMap:{value:texture},cityFogBounds:{value:new THREE.Vector4()},cityFogActive:{value:0}};},[]);
 // Mask upload is small (256 KiB), independent of quality and screen resolution.
 const maskKey=view?JSON.stringify([view.self.visibility,view.phase,view.players.find(p=>p.id===view.self.id)?.sealed,Math.round((view.players.find(p=>p.id===view.self.id)?.x??0)/5),Math.round((view.players.find(p=>p.id===view.self.id)?.y??0)/5)]):'';
 useEffect(()=>{uniforms.cityFogActive.value=view&&fogEnabled(view)?1:0;if(!view||!view.self.visibility)return;const bounds=fogBounds(view);uniforms.cityFogBounds.value.set((bounds.left-500)/20,(bounds.top-350)/20,bounds.width/20,bounds.height/20);uniforms.cityFogMap.value.image.data=explorationMemory.update(view,bounds);uniforms.cityFogMap.value.needsUpdate=true;},[maskKey,uniforms]);
 useEffect(()=>()=>uniforms.cityFogMap.value.dispose(),[uniforms]);
 return <FogContext.Provider value={uniforms}>{children}</FogContext.Provider>;
}
export function useVisionFog(){return useContext(FogContext);}
export function applyVisionFog(shader:THREE.WebGLProgramParametersWithUniforms,uniforms:FogUniforms|null){if(!uniforms)return;Object.assign(shader.uniforms,uniforms);
 shader.vertexShader='varying vec2 vCityFogWorld;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vec4 fogVertex=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\n fogVertex=instanceMatrix*fogVertex;\n#endif\nvCityFogWorld=(modelMatrix*fogVertex).xz;\n#include <project_vertex>');
 shader.fragmentShader='varying vec2 vCityFogWorld;uniform sampler2D cityFogMap;uniform vec4 cityFogBounds;uniform float cityFogActive;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
 vec2 memory=texture2D(cityFogMap,(vCityFogWorld-cityFogBounds.xy)/cityFogBounds.zw).rg;
 float mistGrain=sin(vCityFogWorld.x*.23+sin(vCityFogWorld.y*.31))*sin(vCityFogWorld.y*.19)*.025;
 vec3 lostCityFog=vec3(.22,.25,.24)+mistGrain;
 vec3 remembered=mix(lostCityFog,gl_FragColor.rgb*.34,.45);
 gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(mix(lostCityFog,remembered,memory.g),gl_FragColor.rgb,memory.r),cityFogActive);`);
}
