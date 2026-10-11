import {useVisionFog,applyVisionFog} from './VisionFog';
import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import * as THREE from 'three';
import {SCENE,SCENE_MATERIALS,type MapNode} from '@wangxu/shared';
import {groundPolygons,pavingGeometry,foundationGeometry} from './ground-geometry';
import {groundTexturePaths} from './art-config';
import {useSharedMaps,useArtMaterials,STONE_SURFACES,type ArtProfile} from './ArtMaterials';

function Paving({geometry,name,profile}:{geometry:THREE.BufferGeometry;name:string;profile:ArtProfile}){
  const fog=useVisionFog();const paths=Object.values(groundTexturePaths(name,profile));
  const maps=useSharedMaps(paths);
  return <mesh geometry={geometry} receiveShadow name={`ground:${name}`}>
    <meshStandardMaterial map={maps[0]} aoMap={maps[1]} aoMapIntensity={.4} roughnessMap={maps[1]} normalMap={profile.normal?maps[2]:undefined} normalScale={[.3,.3]} metalness={0} roughness={1} color="#e0dac9" onBeforeCompile={shader=>{
      shader.vertexShader='varying vec2 vGroundWorld;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vGroundWorld=(modelMatrix*vec4(transformed,1.0)).xz;\n#include <project_vertex>');
      shader.fragmentShader='varying vec2 vGroundWorld;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n float age=sin(vGroundWorld.x*.27+sin(vGroundWorld.y*.19))*sin(vGroundWorld.y*.31+1.7);\n diffuseColor.rgb*=.96+age*.075;\n diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.78,.91,.77),smoothstep(.55,.95,age)*.28);');
      applyVisionFog(shader,fog);
    }} customProgramCacheKey={()=>'paving-macro-patina-fog-v2'}/>
  </mesh>;
}
function GroundMarks({nodes}:{nodes:MapNode[]}){
  const fog=useVisionFog();const moss=useRef<THREE.InstancedMesh>(null),cracks=useRef<THREE.InstancedMesh>(null);
  const transforms=useMemo(()=>{const green:THREE.Matrix4[]=[],broken:THREE.Matrix4[]=[];for(const n of nodes)for(let i=0;i<4;i++){const a=(i+1)*2.399+n.x*.019+n.y*.013,r=n.radius*(.28+i*.13),dummy=new THREE.Object3D(),x=n.x+Math.cos(a)*r,z=n.y+Math.sin(a)*r;dummy.position.set(x,.006,z);dummy.rotation.set(-Math.PI/2,0,a);dummy.scale.set(.45+i*.12,.18+i*.1,1);dummy.updateMatrix();green.push(dummy.matrix.clone());if(i<2)for(let j=0;j<3;j++){dummy.position.set(x+j*.18,.007,z+j*.08);dummy.rotation.set(-Math.PI/2,0,a+j*.25);dummy.scale.set(.27,.016,1);dummy.updateMatrix();broken.push(dummy.matrix.clone());}}return {green,broken};},[nodes]);
  useLayoutEffect(()=>{for(const [ref,list]of [[moss,transforms.green],[cracks,transforms.broken]] as const){list.forEach((m,i)=>ref.current!.setMatrixAt(i,m));ref.current!.instanceMatrix.needsUpdate=true;ref.current!.computeBoundingSphere();}},[transforms]);
  return <><instancedMesh ref={moss} args={[undefined,undefined,transforms.green.length]} name="ground:moss-marks"><circleGeometry args={[1,7]}/><meshBasicMaterial color="#6c7960" transparent opacity={.12} depthWrite={false} onBeforeCompile={shader=>applyVisionFog(shader,fog)} customProgramCacheKey={()=>'moss-mark-fog-v1'}/></instancedMesh><instancedMesh ref={cracks} args={[undefined,undefined,transforms.broken.length]} name="ground:crack-marks"><planeGeometry args={[1,1]}/><meshBasicMaterial color="#171512" transparent opacity={.16} depthWrite={false} onBeforeCompile={shader=>applyVisionFog(shader,fog)} customProgramCacheKey={()=>'crack-mark-fog-v1'}/></instancedMesh></>;
}
export function Ground({nodes,edges,profile}:{nodes:MapNode[];edges:[string,string][];profile:ArtProfile}){
  const key=JSON.stringify([nodes,edges]);const materials=useArtMaterials(profile,STONE_SURFACES);
  const geometry=useMemo(()=>{const polygons=groundPolygons(nodes,edges,SCENE.corridorRadius/SCENE.unitsPerMeter);return {floor:pavingGeometry(polygons.floor,SCENE_MATERIALS.floor.meters),roads:pavingGeometry(polygons.roads,SCENE_MATERIALS.road.meters),foundation:foundationGeometry(polygons.foundation)};},[key]);
  useEffect(()=>()=>Object.values(geometry).forEach(g=>g.dispose()),[geometry]);
  return <group><Paving geometry={geometry.floor} name={SCENE_MATERIALS.floor.id} profile={profile}/><Paving geometry={geometry.roads} name={SCENE_MATERIALS.road.id} profile={profile}/><mesh geometry={geometry.foundation} material={materials.foundation} receiveShadow name="ground:foundation"/>{profile.decorations&&<GroundMarks nodes={nodes}/>}</group>;
}
