import {LostCity,SoulFibers} from './LostCity';
import {VisionFogProvider} from './VisionFog';
import {visibleObjects,visibleActors} from './fog-memory';
import {ArtMaterialProvider} from './ArtMaterials';
import {AttackAudioMarker,ATTACK_DURATION} from './attack-audio';
import {useFeedbackSettings} from './settings';
import {usePreferences} from './preferences';
import {RenderMotion} from './render-motion';
import {CharacterLife} from './CharacterLife';
import {Landscape} from './Landscape';
import {Ground} from './Ground';
import {NavigationTrail} from './NavigationTrail';
import type {NavigationTarget} from './navigation';
import {ArtLandmark} from './ArtLandmark';
import {PROFESSION_ART} from './art-config';
import {attachProfessionArt} from './art-geometry';
import {useArtMaterials,addSurfaceDetail,CHARACTER_SURFACES,BOX_SURFACES,NO_SURFACES,type ArtProfile} from './ArtMaterials';
import {AutoQuality,qualityProfile} from './render-quality';
import {SCENE} from '@wangxu/shared';
import {ActionButton} from './ActionButton';
import { Component, Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, PerformanceMonitor, useProgress, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FeedbackEvent, GameView, MapNode, PlayerView, Profession, Vec2, WorldObject } from '@wangxu/shared';

type AssetEntry = string | {path?:string;url?:string;scale?:number;footOffset?:number;bodyHeight?:number;appearance?:Profession;clips?:Record<string,string>};
export interface ActionCue {serial:number;type:string}
export interface AssetManifest {characters?:Partial<Record<Profession,AssetEntry>>;dungeon?:Record<string,AssetEntry>;enemies?:Record<string,AssetEntry>;[key:string]:unknown}
export function useAssets() { const [assets,setAssets]=useState<AssetManifest|null>(null); useEffect(()=>{void fetch('/assets/manifest.json').then(r=>r.ok?r.json():null).then(setAssets).catch(()=>{});},[]); return assets; }
const FLASH_COLOR=new THREE.Color('#f4faf3');
const COLORS: Record<Profession,string> = {warden:'#d2b466',scout:'#7ac9c7',scavenger:'#d08c66',broker:'#ab9ccc',medic:'#99bc8a',engineer:'#bf925c',forensic:'#8db3cf',bellkeeper:'#bda26a',ranger:'#83b69d'};
const pathOf = (entry?:AssetEntry) => typeof entry==='string'?entry:entry?.path || entry?.url;
class AssetBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> { state={failed:false}; static getDerivedStateFromError(){return{failed:true};} render(){return this.state.failed?this.props.fallback:this.props.children;} }
function Label({text,position,selected=false,hp}:{text:string;position:[number,number,number];selected?:boolean;hp?:number}){const [fontRevision,setFontRevision]=useState(0);useEffect(()=>{let live=true;if(!document.fonts.check('500 32px "Noto Serif SC Variable"',text))void document.fonts.load('500 32px "Noto Serif SC Variable"',text).then(()=>{if(live)setFontRevision(revision=>revision+1);}).catch(()=>{});return()=>{live=false;};},[text]);const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=384;canvas.height=80;const ctx=canvas.getContext('2d')!;ctx.fillStyle='rgba(27,34,26,.94)';ctx.fillRect(1,1,382,76);ctx.strokeStyle=selected?'#dfbc87':'#92704b';ctx.lineWidth=2;ctx.strokeRect(1,1,382,76);ctx.font='500 32px "Noto Serif SC Variable", "Songti SC", serif' ;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=selected?'#f2d6a5':'#e1d6bd';ctx.fillText(text,192,hp===undefined?40:32,355);if(hp!==undefined){ctx.fillStyle='#14332e';ctx.fillRect(12,59,360,5);ctx.fillStyle='#a9ccae';ctx.fillRect(12,59,360*Math.max(0,hp),5);}const result=new THREE.CanvasTexture(canvas);result.colorSpace=THREE.SRGBColorSpace;return result;},[text,selected,hp,fontRevision]);useEffect(()=>()=>texture.dispose(),[texture]);return <sprite position={position} scale={[3.4,.85,1]}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false}/></sprite>;}
function FloatingImpact({text,color}:{text:string;color:string}){const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.font='bold 28px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=5;ctx.strokeStyle='#10262c';ctx.strokeText(text,80,32);ctx.fillStyle=color;ctx.fillText(text,80,32);const result=new THREE.CanvasTexture(canvas);result.colorSpace=THREE.SRGBColorSpace;return result;},[text,color]);useEffect(()=>()=>texture.dispose(),[texture]);return <sprite scale={[1.6,.64,1]}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false}/></sprite>;}
function Model({entry,animation='idle',tint,opacity=1,flashKey,hitStopKey,actionKey,onSwing,reduced=false,profile=qualityProfile(2,1)}:{entry:AssetEntry;animation?:string;tint?:string;opacity?:number;flashKey?:number;hitStopKey?:number;actionKey?:number;onSwing?:()=>void;reduced?:boolean;profile?:ArtProfile}) {
  const gltf=useGLTF(pathOf(entry)!);
  const appearance=typeof entry==='object'?entry.appearance:undefined;
  const artMaterials=useArtMaterials(profile,appearance?CHARACTER_SURFACES:NO_SURFACES);
  const scene=useMemo(()=>{
    const copy=clone(gltf.scene),owned=new Map<string,THREE.Material>();
    const role=appearance?PROFESSION_ART[appearance]:undefined;
    copy.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
      if(role?.hide.includes(object.name))object.visible=false;
      const selective=/Mage_Arm|Rogue_Head_Hooded/.test(object.name);
      const zone=/Cape|_Body$/.test(object.name)||selective?'cloth':/Helmet|Shield|Sword|Axe|Knife|Wand|Crossbow/.test(object.name)?'bronze':undefined;
      const materialFor=(original:THREE.Material)=>{const key=`${original.uuid}:${zone??'base'}:${selective}`;let material=owned.get(key);if(!material){material=original.clone();if(material instanceof THREE.MeshStandardMaterial){if(role&&zone){addSurfaceDetail(material,artMaterials[zone].map!,zone==='cloth'?role.cloth:role.equipment,selective);material.metalness=zone==='bronze'?.45:0;material.roughness=zone==='bronze'?.6:.88;}if(tint)material.color.lerp(new THREE.Color(tint),.25);material.transparent=opacity<1;material.opacity=opacity;}owned.set(key,material);}return material;};
      object.castShadow=object.receiveShadow=true;object.material=Array.isArray(object.material)?object.material.map(materialFor):materialFor(object.material);
    });
    if(appearance){attachProfessionArt(copy,appearance,artMaterials);copy.traverse(object=>{if(object instanceof THREE.Mesh&&object.name.startsWith('attachment:')){const material=(object.material as THREE.MeshStandardMaterial).clone();material.transparent=opacity<1;material.opacity=opacity;object.material=material;}});}
    return copy;
  },[gltf.scene,appearance,tint,artMaterials]);
  useEffect(()=>{scene.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){material.transparent=opacity<1;material.opacity=opacity;}});},[scene,opacity]);
  const attackAudio=useRef(new AttackAudioMarker()),attackAction=useRef<THREE.AnimationAction|null>(null),swingRef=useRef(onSwing);swingRef.current=onSwing;
  const mixer=useMemo(()=>new THREE.AnimationMixer(scene),[scene]);
  const materials=useMemo(()=>{const list:{material:THREE.MeshStandardMaterial;color:THREE.Color;intensity:number}[]=[];scene.traverse(object=>{if(object instanceof THREE.Mesh){for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof THREE.MeshStandardMaterial)list.push({material,color:material.emissive.clone(),intensity:material.emissiveIntensity});}});return list;},[scene]);const wasFlashing=useRef(false);
  const flashAt=useRef(-1000),stopUntil=useRef(0);useEffect(()=>{if(flashKey!==undefined&&!reduced)flashAt.current=performance.now();},[flashKey,reduced]);useEffect(()=>{if(hitStopKey!==undefined&&!reduced)stopUntil.current=performance.now()+48;},[hitStopKey,reduced]);
  useEffect(()=>{const clips=gltf.animations;const names:Record<string,string>={idle:'Idle',run:'Running_A',attack:'1H_Melee_Attack_Slice_Horizontal',dead:'Death_A',skill:'Spellcast_Raise',dodge:'Dodge_Forward',interact:'Interact',transform:'Cheer',hit:'Hit_A'};const named=typeof entry==='object'?entry.clips?.[animation]:undefined;const clip=clips.find(c=>c.name===(named||names[animation])) || clips[0];if(clip){const action=mixer.clipAction(clip);action.reset().setLoop(['dead','hit','attack'].includes(animation)?THREE.LoopOnce:THREE.LoopRepeat,Infinity);action.clampWhenFinished=['dead','attack'].includes(animation);action.setEffectiveTimeScale(animation==='attack'?clip.duration/ATTACK_DURATION:1);if(animation==='attack'){attackAction.current=action;attackAudio.current.start(performance.now(),clip.duration);}action.fadeIn(animation==='attack'?.04:.15).play();return()=>{attackAction.current=null;attackAudio.current.clear();action.fadeOut(.15);};}},[animation,actionKey,gltf.animations,mixer,entry]);
  useEffect(()=>()=>{mixer.stopAllAction();mixer.uncacheRoot(scene);scene.traverse(object=>{if(object instanceof THREE.Mesh&&object.name.startsWith('attachment:'))object.geometry.dispose();});const owned=new Set<THREE.Material>();scene.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])owned.add(material);});owned.forEach(material=>{if(!Object.values(artMaterials).includes(material as THREE.MeshStandardMaterial))material.dispose();});},[mixer,scene]);
  useFrame((_,delta)=>{const now=performance.now();if(gltf.animations.length&&(reduced||now>=stopUntil.current))mixer.update(Math.min(delta,.05));if(attackAction.current&&attackAudio.current.take(attackAction.current.time,now))swingRef.current?.();const flash=reduced?0:Math.max(0,1-(now-flashAt.current)/180);if(flash>0||wasFlashing.current){for(const entry of materials){entry.material.emissive.copy(entry.color).lerp(FLASH_COLOR,flash);entry.material.emissiveIntensity=entry.intensity+flash*1.6;}wasFlashing.current=flash>0;}});
  return <primitive object={scene} position={[0,typeof entry==='object'?entry.footOffset??0:0,0]} scale={typeof entry==='object'?entry.scale??1:1}/>;
}
const StaticModels=memo(function StaticModels({path,objects,profile}:{path:string;objects:{object:WorldObject;entry:AssetEntry}[];profile:ArtProfile}){
  const gltf=useGLTF(path);
  const artMaterials=useArtMaterials(profile,BOX_SURFACES);
  const materials=useMemo(()=>{const originals=new Set<THREE.Material>();gltf.scene.traverse(n=>{if(n instanceof THREE.Mesh)(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>originals.add(m));});return new Map([...originals].map(m=>{const copy=m.clone();if(copy instanceof THREE.MeshStandardMaterial)addSurfaceDetail(copy,artMaterials.wood.map!,path.includes('gold')?'#b58a58':'#98775b');return [m,copy];}));},[gltf.scene,artMaterials,path]);
  useEffect(()=>()=>materials.forEach(m=>m.dispose()),[materials]);
  const meshes=useMemo(()=>{const meshes:THREE.Mesh[]=[];gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(node=>{if(node instanceof THREE.Mesh)meshes.push(node);});return meshes;},[gltf.scene]);
  const instances=useRef<(THREE.InstancedMesh|null)[]>([]);
  useLayoutEffect(()=>{const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
    for(let m=0;m<meshes.length;m++){const instance=instances.current[m];if(!instance)continue;
      objects.forEach(({object,entry},i)=>{const factor=typeof entry==='object'?entry.scale??1:1,foot=typeof entry==='object'?entry.footOffset??0:0;matrix.compose(position.set(object.x,foot,object.y),rotation,scale.setScalar(factor)).multiply(meshes[m].matrixWorld);instance.setMatrixAt(i,matrix);});
      instance.instanceMatrix.needsUpdate=true;instance.computeBoundingSphere();
    }
  },[meshes,objects]);
  return <>{meshes.map((mesh,index)=><instancedMesh key={index} ref={instance=>{instances.current[index]=instance;}} args={[mesh.geometry,Array.isArray(mesh.material)?mesh.material.map(m=>materials.get(m)!):materials.get(mesh.material)!,objects.length]} castShadow receiveShadow dispose={null}/>)}</>;
},(a,b)=>a.path===b.path&&a.profile.level===b.profile.level&&JSON.stringify(a.objects.map(({object:o,entry})=>[o.id,o.kind,o.x,o.y,entry]))===JSON.stringify(b.objects.map(({object:o,entry})=>[o.id,o.kind,o.x,o.y,entry])));
function FallbackPerson({profession,sealed=false}:{profession:Profession;sealed?:boolean}) {
  const color=sealed?'#c8e5ec':COLORS[profession];return <group scale={1.25}>
    <mesh position={[0,.6,0]} castShadow><capsuleGeometry args={[.3,.6,4,8]}/><meshStandardMaterial color={color} roughness={.7} transparent={sealed} opacity={sealed?.45:1}/></mesh>
    <mesh position={[0,1.53,0]} castShadow><sphereGeometry args={[.22,12,12]}/><meshStandardMaterial color="#b9c5c1"/></mesh>
    <mesh position={[.34,.82,.15]}><boxGeometry args={[.13,.25,.13]}/><meshStandardMaterial color="#f4cc78" emissive="#f8ba4b" emissiveIntensity={1.2}/></mesh>
  </group>;
}
function Person({player,entry,self,followAnchor,frameAt,cue,onSwing,selected=false,interacting=false,feedback,reduced=false,labelled=true,profile}:{player:PlayerView;entry?:AssetEntry;self:boolean;followAnchor?:RefObject<THREE.Group|null>;frameAt?:number;cue?:ActionCue;onSwing?:()=>void;selected?:boolean;interacting?:boolean;feedback?:FeedbackEvent[];reduced?:boolean;labelled?:boolean;profile:ArtProfile}) {
  const group=useRef<THREE.Group>(null);const initialPosition=useRef<[number,number,number]>([player.x??0,0,player.y??0]);const motion=useRef<RenderMotion|null>(null);if(!motion.current)motion.current=new RenderMotion(performance.now(),player.x??0,player.y??0);
  useLayoutEffect(()=>{motion.current!.update(performance.now(),player.x??0,player.y??0);},[player.x,player.y,frameAt]);const last=useRef({x:player.x??0,y:player.y??0});const heading=useRef(0);const [moving,setMoving]=useState(false);
  const attach=useCallback((node:THREE.Group|null)=>{group.current=node;if(followAnchor)followAnchor.current=node;},[followAnchor]);
  const[action,setAction]=useState<string>();useEffect(()=>{if(!self||!cue)return;setAction(cue.type);const timer=setTimeout(()=>setAction(undefined),cue.type==='skill'?1100:650);return()=>clearTimeout(timer);},[cue?.serial,self]);
  useEffect(()=>{const dx=(player.x??0)-last.current.x,dz=(player.y??0)-last.current.y;const moved=Math.hypot(dx,dz)>.004;if(moved)heading.current=Math.atan2(dx,dz);if(player.facing)heading.current=Math.atan2(player.facing.x,player.facing.y);setMoving(moved);last.current={x:player.x??0,y:player.y??0};const timer=setTimeout(()=>setMoving(false),250);return()=>clearTimeout(timer);},[player.x,player.y,player.facing?.x,player.facing?.y]);
  useFrame((_,delta)=>{if(!group.current)return;const angularDelta=Math.atan2(Math.sin(heading.current-group.current.rotation.y),Math.cos(heading.current-group.current.rotation.y));group.current.rotation.y+=angularDelta*(1-Math.exp(-18*delta));const point=motion.current!.position(performance.now());group.current.position.set(point.x,0,point.y);});
  const fallback=<FallbackPerson profession={player.profession} sealed={player.sealed}/>;
  const impact=feedback?.filter(event=>event.targetId===player.id&&['hurt','hit','block','push'].includes(event.kind)).at(-1);const hitStop=self?feedback?.filter(event=>['hit','hurt','block','collision'].includes(event.kind)).at(-1):undefined;
  return <group ref={attach} name={`player:${player.id}`} position={initialPosition.current} >
    <group>{entry?<AssetBoundary fallback={fallback}><Suspense fallback={fallback}><Model entry={entry} actionKey={self?cue?.serial:undefined} onSwing={self?onSwing:undefined} animation={player.down?'dead':interacting?'interact':action||(moving?'run':'idle')} tint={['default','base'].includes(player.cosmetic)?undefined:player.cosmetic.startsWith('silver-')?'#d4e5ed':'#ecbc62'} opacity={player.sealed?.4:1} flashKey={impact?.id} hitStopKey={hitStop?.id} reduced={reduced} profile={profile}/></Suspense></AssetBoundary>:fallback}</group>
    {player.shield>0&&<mesh position={[0,1,0]}><sphereGeometry args={[.95,16,12]}/><meshBasicMaterial color="#9cdbd7" transparent opacity={.13} wireframe/></mesh>}
    {player.transformed&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.07,0]}><ringGeometry args={[.66,.84,32]}/><meshBasicMaterial color="#c891b2" transparent opacity={.8}/></mesh>}
    {action==='skill'&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.11,0]}><ringGeometry args={[1.1,1.3,48]}/><meshBasicMaterial color="#ceeaca" transparent opacity={.8}/></mesh>}
    {self&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.04,0]}><ringGeometry args={[.46,.51,32]}/><meshBasicMaterial color="#a7e9dd" transparent opacity={.8}/></mesh>}
    {player.carryingCore&&<mesh position={[0,2.2,0]}><octahedronGeometry args={[.3]}/><meshStandardMaterial color="#ffd88a" emissive="#ffd88a" emissiveIntensity={2}/></mesh>}
    {['first-thread','tutorial-lantern'].includes(player.cosmetic)&&<group position={[-.65,1.15,0]}><mesh><icosahedronGeometry args={[.15,0]}/><meshStandardMaterial color="#dae8de" emissive={player.cosmetic==='first-thread'?'#ccf2ec':'#f9d891'} emissiveIntensity={2}/></mesh><pointLight intensity={.6} distance={3} color="#d7edda"/></group>}
    {(self||selected||player.down)&&<CharacterLife hp={player.hp} maxHp={player.maxHp} down={player.down} sealed={player.sealed} reduced={reduced}/>}
    {labelled&&selected&&!self&&<Label text={player.name} position={[0,3.9,0]}/>}
  </group>;
}
function Guardian({object,entry,players,reduced,profile}:{object:WorldObject;entry?:AssetEntry;players:PlayerView[];reduced:boolean;profile:ArtProfile}){
  const group=useRef<THREE.Group>(null),maxHp=useRef(object.hp??100),previousHp=useRef(object.hp??100),serial=useRef(0);
  const[reaction,setReaction]=useState(false);maxHp.current=Math.max(maxHp.current,object.hp??0);
  useEffect(()=>{if((object.hp??0)>=previousHp.current){previousHp.current=object.hp??0;return;}previousHp.current=object.hp??0;serial.current++;setReaction(true);const timer=setTimeout(()=>setReaction(false),650);return()=>clearTimeout(timer);},[object.hp]);
  const target=players.filter(p=>p.x!==null&&p.y!==null&&!p.down&&!p.sealed).sort((a,b)=>Math.hypot(a.x!-object.x,a.y!-object.y)-Math.hypot(b.x!-object.x,b.y!-object.y))[0];
  const heading=target?Math.atan2(target.x!-object.x,target.y!-object.y):Math.PI;
  useFrame((_,delta)=>{if(group.current){const difference=Math.atan2(Math.sin(heading-group.current.rotation.y),Math.cos(heading-group.current.rotation.y));group.current.rotation.y+=difference*(1-Math.exp(-12*delta));}});
  const fallback=<FallbackPerson profession="warden"/>;
  return <group ref={group} name={`guardian:${object.id}`} position={[object.x,0,object.y]}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.05,0]}><ringGeometry args={[.85,1.02,32]}/><meshBasicMaterial color="#de806a" transparent opacity={.75}/></mesh>
    {entry?<AssetBoundary fallback={fallback}><Suspense fallback={fallback}><Model entry={entry} animation={reaction?'hit':'idle'} tint="#815045" flashKey={serial.current||undefined} reduced={reduced} profile={profile}/></Suspense></AssetBoundary>:fallback}
    <mesh position={[0,2.35,0]} castShadow><boxGeometry args={[.14,.32,.48]}/><meshStandardMaterial color="#953f35" roughness={.8}/></mesh>
    <CharacterLife hp={object.hp??maxHp.current} maxHp={maxHp.current} down={false} sealed={false} reduced={reduced}/>
    <Label text={object.name} position={[0,4,0]} selected/>
  </group>;
}
function Landmark({object,selected,entry,instanced=false,profile}:{object:WorldObject;selected:boolean;entry?:AssetEntry;instanced?:boolean;profile:ArtProfile}) {
  const modeled=['beacon','altar','cleanse','exit'].includes(object.kind);
  const bright=object.kind==='beacon'||object.kind==='exit'||object.kind==='core';const gold=object.progress>=1?'#dcecca':'#e9bd62';const color=object.kind==='altar'?'#ac7dcb':object.kind==='cleanse'?(object.id==='purify'?'#ccb77c':'#7fafa7'):bright?gold:object.kind==='resource'?'#86d9cc':'#8a9ea3';
  const mesh=useRef<THREE.Mesh>(null);useFrame(state=>{if(mesh.current&&(object.kind==='core'||object.kind==='resource'))mesh.current.position.y=.75+Math.sin(state.clock.elapsedTime*1.6+object.x)*.1;});
  return <group position={[object.x,0,object.y]} >
    {!modeled&&<mesh position={[0,.12,0]} receiveShadow><cylinderGeometry args={[object.kind==='exit'?3.2:object.kind==='resource'?.3:.65,object.kind==='exit'?3.25:object.kind==='resource'?.35:.7,.12,8]}/><meshStandardMaterial color="#4e5643" metalness={.25} roughness={.8}/></mesh>}
    {modeled?<Suspense fallback={null}><ArtLandmark object={object} profile={profile}/></Suspense>:entry?(instanced?null:<AssetBoundary fallback={null}><Suspense fallback={null}><Model entry={entry}/></Suspense></AssetBoundary>):object.kind==='beacon'?<group><mesh position={[0,1,0]} castShadow><cylinderGeometry args={[.16,.25,1.8,8]}/><meshStandardMaterial color="#6e7659"/></mesh><mesh position={[0,2,0]}><icosahedronGeometry args={[.32,0]}/><meshStandardMaterial color={gold} emissive={gold} emissiveIntensity={object.progress>=1?3:.4}/></mesh><pointLight position={[0,2,0]} color={gold} intensity={object.progress>=1?6:1} distance={8}/></group>:<mesh ref={mesh} position={[0,.75,0]} castShadow>{object.kind==='chest'||object.kind==='deposit'?<boxGeometry args={[1.25,.72,.8]}/>:object.kind==='altar'?<coneGeometry args={[.7,1.6,5]}/>:object.kind==='cleanse'?<cylinderGeometry args={[.7,.85,.7,object.id==='purify'?6:12]}/>:<octahedronGeometry args={[object.kind==='exit'?.9:.42]}/>}<meshStandardMaterial color={color} emissive={color} emissiveIntensity={bright?.9:.15} metalness={.5} roughness={.35}/></mesh>}
    {(selected||object.kind==='exit')&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.27,0]}><ringGeometry args={[object.kind==='exit'?3.15:1.1,object.kind==='exit'?3.25:1.2,48]}/><meshBasicMaterial color={selected?'#eec988':'#8dd9ce'} transparent opacity={.75}/></mesh>}
    {(selected||object.kind==='beacon'||object.kind==='exit'||object.kind==='deposit'||object.kind==='cleanse')&&<Label text={`${object.name}${object.progress>0&&object.progress<1?` ${Math.round(object.progress*100)}%`:''}`} position={[0,object.kind==='beacon'?2.8:object.kind==='exit'?3.9:1.7,0]} selected={selected}/>}
  </group>;
}
function CameraFollow({view,camp,reduced,anchor}:{view?:GameView;camp?:boolean;reduced:boolean;anchor:RefObject<THREE.Group|null>}) {
  const{camera}=useThree();const follow=useRef(new THREE.Vector3());const shake=useRef({at:-1000,power:0});
  const latest=view?.self.feedback?.filter(event=>['hit','hurt','collision','push','block'].includes(event.kind)).at(-1);
  useEffect(()=>{if(latest&&!reduced)shake.current={at:performance.now(),power:latest.kind==='hurt'?.15:latest.kind==='collision'?.055:.095};},[latest?.id,reduced]);
  // Person advances first. Both camera position and aim use that same rendered anchor.
  useFrame(()=>{
    if(camp){camera.lookAt(0,.5,0);return;}
    if(!anchor.current)return;
    follow.current.copy(anchor.current.position);
    const now=performance.now(),falloff=Math.max(0,1-(now-shake.current.at)/220),power=reduced?0:shake.current.power*falloff;
    follow.current.x+=Math.sin(now*.12)*power;follow.current.z+=Math.cos(now*.15)*power;
    camera.position.set(follow.current.x+19,follow.current.y+25,follow.current.z+23);
    camera.lookAt(follow.current);
  });return null;
}
function ImpactBurst({event,reduced,onEnd,showLabel=true}:{event:FeedbackEvent;reduced:boolean;onEnd:()=>void;showLabel?:boolean}){const born=useRef(performance.now());const group=useRef<THREE.Group>(null);const ring=useRef<THREE.Mesh>(null);const floating=useRef<THREE.Group>(null);const good=['complete','pickup','rescue'].includes(event.kind);const color=good?'#f0d993':event.kind==='block'||event.kind==='cast'?'#a4e7da':event.kind==='hurt'||event.kind==='down'?'#f4c9bb':'#e5ede2';useFrame(()=>{const t=(performance.now()-born.current)/1000;if(t>(reduced?.3:.9)){onEnd();return;}if(group.current){group.current.scale.setScalar(reduced?1:.55+t*1.8);group.current.position.y=.2+t*(good?1.1:.45);group.current.traverse(object=>{if(object instanceof THREE.Mesh&&object.material instanceof THREE.MeshBasicMaterial)object.material.opacity=Math.max(0,1-t/(reduced?.3:.9));});}if(ring.current)ring.current.rotation.z=t*2;if(floating.current)floating.current.position.y=reduced?2.5:2.4+t*.8;});return <group position={[(event.x-500)/20,0,(event.y-350)/20]}><group ref={group}><mesh ref={ring} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[good?.4:.15,good?.47:.25,32]}/><meshBasicMaterial color={color} transparent opacity={.9} depthWrite={false} toneMapped={false}/></mesh>{!reduced&&Array.from({length:good?12:7},(_,i)=>{const a=i*Math.PI*2/(good?12:7);return <mesh key={i} position={[Math.cos(a)*.65,.35+(i%3)*.13,Math.sin(a)*.65]} rotation={[a,a,a]}><octahedronGeometry args={[good?.045:.075]}/><meshBasicMaterial color={color} transparent opacity={1} toneMapped={false} depthWrite={false}/></mesh>;})}</group>{showLabel&&['hit','hurt','block'].includes(event.kind)&&event.power>0&&<group ref={floating} position={[0,2.4,0]}><FloatingImpact text={event.kind==='block'?'格挡':event.kind==='hurt'?'受击':'命中'} color={color}/></group>}</group>;}
function ImpactEffects({events,reduced,matchKey}:{events:FeedbackEvent[];reduced:boolean;matchKey:string}){const seen=useRef(new Set<number>());const[active,setActive]=useState<FeedbackEvent[]>([]);useEffect(()=>{seen.current.clear();setActive([]);},[matchKey]);useEffect(()=>{const fresh=events.filter(event=>!seen.current.has(event.id));fresh.forEach(event=>seen.current.add(event.id));if(fresh.length)setActive(previous=>[...previous,...fresh].slice(-12));},[events]);return <>{active.map(event=><ImpactBurst key={event.id} event={event} reduced={reduced} showLabel={active.filter(other=>other.targetId===event.targetId&&['hit','hurt','block'].includes(other.kind)).at(-1)?.id===event.id} onEnd={()=>setActive(previous=>previous.filter(e=>e.id!==event.id))}/>)}</>;}
function RendererLifecycle({onLost,onSample}:{onLost:()=>void;onSample:(fps:number)=>void}){
  const {gl}=useThree();const progress=useProgress();const readyAt=useRef(performance.now());
  useEffect(()=>{if(progress.active)readyAt.current=performance.now();},[progress.active]);
  useEffect(()=>{const warm=()=>{readyAt.current=performance.now();};document.addEventListener('visibilitychange',warm);return()=>document.removeEventListener('visibilitychange',warm);},[]);
  useEffect(()=>{const canvas=gl.domElement;const lost=(event:Event)=>{event.preventDefault();onLost();};canvas.addEventListener('webglcontextlost',lost);return()=>canvas.removeEventListener('webglcontextlost',lost);},[gl,onLost]);
  const sample=(api:{fps:number})=>{if(!progress.active&&!document.hidden&&performance.now()-readyAt.current>=3000)onSample(api.fps);};
  return <PerformanceMonitor ms={2500} iterations={1} threshold={.5} factor={1} bounds={()=>[59,59]} onDecline={sample} onIncline={sample}/>;
}
function MaterialEnvironment(){
  const {gl,scene}=useThree();
  useEffect(()=>{const generator=new THREE.PMREMGenerator(gl),room=new RoomEnvironment(),target=generator.fromScene(room,.04);scene.environment=target.texture;scene.environmentIntensity=.24;room.dispose();generator.dispose();return()=>{if(scene.environment===target.texture)scene.environment=null;target.dispose();};},[gl,scene]);return null;
}
function Sun({view,profile}:{view?:GameView;profile:ReturnType<typeof qualityProfile>}){
  const light=useRef<THREE.DirectionalLight>(null),target=useMemo(()=>new THREE.Object3D(),[]);
  useFrame(()=>{const self=view?.players.find(p=>p.id===view.self.id);const x=self?.x??0,z=self?.y??0;target.position.set(x,0,z);light.current?.position.set(x+8,22,z-12);});
  return <><primitive object={target}/><directionalLight ref={light} target={target} position={[8,22,-12]} intensity={2.3} color="#fff0d7" castShadow={profile.shadows} shadow-mapSize={[profile.shadowSize,profile.shadowSize]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} shadow-normalBias={.04}/></>;
}
const Scenery=memo(function Scenery({nodes,edges,profile}:{nodes:MapNode[];edges:[string,string][];profile:ReturnType<typeof qualityProfile>}){return <>
  <color attach="background" args={['#555d57']}/><fog attach="fog" args={['#555d57',45,110]}/>
  <ambientLight intensity={.7} color="#e1e0d5"/><hemisphereLight color="#dedbd2" groundColor="#46473d" intensity={1.25}/>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.72,0]} receiveShadow><planeGeometry args={[300,300]}/><meshStandardMaterial color="#434a40" roughness={1} onBeforeCompile={shader=>{shader.vertexShader='varying vec2 vMist;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vMist=(modelMatrix*vec4(transformed,1.)).xz;\n#include <project_vertex>');shader.fragmentShader='varying vec2 vMist;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n float haze=sin(vMist.x*.11+sin(vMist.y*.13))*cos(vMist.y*.09);\n diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.46,.50,.46),.4+haze*.22);');}} customProgramCacheKey={()=>'lost-city-soil-mist-v1'}/></mesh>
  <Suspense fallback={null}><Ground nodes={nodes} edges={edges} profile={profile}/></Suspense><Suspense fallback={null}><Landscape nodes={nodes} edges={edges} detailed={profile.decorations} profile={profile}/></Suspense>
  <Suspense fallback={null}><LostCity nodes={nodes} edges={edges} profile={profile}/></Suspense>
</>;},(a,b)=>JSON.stringify([a.nodes,a.edges,a.profile])===JSON.stringify([b.nodes,b.edges,b.profile]));
const CAMP_NODES:MapNode[]=[{id:'camp',name:'余灯集市',x:0,y:0,radius:9,artTheme:'hall'}];
function City({view,camp,assets,selected,reduced,profession,cosmetic,cue,onSwing,profile,edges}:{view?:GameView;camp?:boolean;assets:AssetManifest|null;selected?:string;reduced:boolean;profession:Profession;cosmetic:string;cue?:ActionCue;onSwing?:()=>void;profile:ReturnType<typeof qualityProfile>;edges:[string,string][]}) {
  const actorAnchor=useRef<THREE.Group|null>(null);
  const nodes=view?.nodes??CAMP_NODES;
  const staticKey=JSON.stringify(view?.objects.filter(o=>o.active).map(o=>[o.id,o.kind,o.x,o.y]));
  const batches=useMemo(()=>{const groups=new Map<string,{object:WorldObject;entry:AssetEntry}[]>();for(const object of view?.objects??[]){const entry=assets?.dungeon?.[object.id]??assets?.dungeon?.[object.kind],path=pathOf(entry);if(object.active&&object.kind!=='elite'&&entry&&path){const list=groups.get(path)??[];list.push({object,entry});groups.set(path,list);}}return [...groups];},[staticKey,assets]);

  return <>
    <MaterialEnvironment/><Sun view={view} profile={profile}/><Scenery nodes={nodes} edges={edges} profile={profile}/>
    {view?.objects.filter(object=>object.active&&object.kind!=='elite').map(object=><Landmark key={object.id} instanced object={object} selected={selected===object.id} entry={assets?.dungeon?.[object.id]??assets?.dungeon?.[object.kind]} profile={profile}/>)}
    {view?.objects.filter(o=>o.active&&o.kind==='elite').map(object=><Guardian key={object.id} object={object} entry={assets?.enemies?.guardian??assets?.characters?.warden} players={view.players} reduced={reduced} profile={profile}/>)}
    <Suspense fallback={null}>{batches.map(([path,objects])=><StaticModels key={path} path={path} objects={objects} profile={profile}/>)}</Suspense>
    {view&&visibleActors(view).map(player=><Person key={player.id} player={player} entry={assets?.characters?.[player.profession]} self={player.id===view.self.id} followAnchor={player.id===view.self.id?actorAnchor:undefined} frameAt={view.elapsed} cue={cue} onSwing={onSwing} selected={selected===player.id} interacting={player.id===view.self.id&&!!view.self.interaction} feedback={view.self.feedback} reduced={reduced} labelled={player.id!==view.self.id||!selected||selected===player.id} profile={profile}/>)}
    {camp&&<><Person player={{id:'preview',name:'归灯者',slot:0,profession,form:0,cosmetic,ready:true,connected:true,sealed:false,down:false,hp:100,maxHp:100,x:0,y:0,shield:0,transformed:false,carryingCore:false}} entry={assets?.characters?.[profession]} self={false} profile={profile}/><Landmark object={{id:'camp-lamp',kind:'beacon',name:'记忆灯',active:true,progress:1,x:-3,y:-2}} selected={false} profile={profile}/></>}
    <SoulFibers objects={view?.objects??[]} reduced={reduced}/><CameraFollow view={view} camp={camp} reduced={reduced} anchor={actorAnchor}/>{view&&<ImpactEffects events={view.self.feedback||[]} reduced={reduced} matchKey={`${view.roomId}:${view.self.id}`}/>}

  </>;
}
function FrameBudget({limit,active}:{limit:0|60|120;active:boolean}){
  const invalidate=useThree(state=>state.invalidate);
  useEffect(()=>{if(!active||!limit)return;let frame=0,last:number|undefined;const interval=1000/limit;const tick=(now:number)=>{if(last===undefined||now-last>=interval-.5){last=last===undefined?now:now-(Math.max(0,now-last-interval)%interval);invalidate();}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[active,limit,invalidate]);
  return null;
}
export function World({view,camp=false,idle=false,selected,assets,quality='auto',profession='warden',cosmetic='base',cue,onSwing,reduceMotion,events,navigationRoute=[],navigationDestination}:{view?:GameView;camp?:boolean;idle?:boolean;selected?:string;assets:AssetManifest|null;quality?:string;profession?:Profession;cosmetic?:string;cue?:ActionCue;onSwing?:()=>void;reduceMotion?:boolean;events?:FeedbackEvent[];navigationRoute?:Vec2[];navigationDestination?:NavigationTarget}) {
  const {frameRate}=usePreferences();const {settings:feedbackSettings}=useFeedbackSettings();
  useEffect(()=>{controller.current.resetSamples();},[frameRate,quality]);
  const viewRef=useRef(view);viewRef.current=view;const controller=useRef(new AutoQuality());const[level,setLevel]=useState(2);const profile=qualityProfile(quality==='auto'?level:quality==='high'?4:quality==='medium'?2:0,Math.max(1,window.devicePixelRatio),quality==='auto');const onSample=useCallback((fps:number)=>{if(quality==='auto')setLevel(controller.current.sample(fps,performance.now()));},[quality]);
  const reduced=reduceMotion??!feedbackSettings.motion;const [failed,setFailed]=useState(false);const handleLost=useCallback(()=>setFailed(true),[]);const[visible,setVisible]=useState(!document.hidden);useEffect(()=>{const update=()=>{setVisible(!document.hidden);controller.current.resetSamples();};document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
  const visual=useMemo(()=>view?{...view,self:{...view.self,feedback:events??view.self.feedback},nodes:view.nodes.map(n=>({...n,x:(n.x-500)/20,y:(n.y-350)/20,radius:n.radius/20})),objects:visibleObjects(view).map(o=>({...o,x:(o.x-500)/20,y:(o.y-350)/20})),players:view.players.map(p=>({...p,x:p.x===null?null:(p.x-500)/20,y:p.y===null?null:(p.y-350)/20}))}:undefined,[view,events]);
  return <div className={`world ${camp?'camp-world':''}`} data-frame-rate-limit={frameRate||'display'} data-quality-mode={quality} data-quality-level={profile.level} data-render-dpr={profile.dpr} aria-label={camp?'余灯集市三维营地':'归灯远征三维地图'}>{failed?<div className="renderer-fallback"><span>◈</span><p>三维画面暂不可用</p><small>请使用支持 WebGL 2 的浏览器；房间与议会操作仍可继续。</small><ActionButton iconKind="retry"  onClick={()=>setFailed(false)}>恢复三维画面</ActionButton></div>:<AssetBoundary fallback={<div className="renderer-fallback">三维画面加载失败，请重新进入。</div>}><Canvas frameloop={visible?(idle||frameRate?'demand':'always'):'never'} shadows={profile.shadows} dpr={profile.dpr} gl={{antialias:true,powerPreference:'high-performance'}} onCreated={({gl,scene})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;if(import.meta.env.DEV)Object.defineProperty(gl.domElement,'__soulwisp',{value:{scene,renderer:gl,get view(){return viewRef.current;}},configurable:true});}}><NavigationTrail route={navigationRoute} target={navigationDestination} reduced={reduced}/><FrameBudget limit={frameRate} active={visible&&!idle}/><RendererLifecycle onLost={handleLost} onSample={onSample}/><OrthographicCamera makeDefault position={[19,25,23]} zoom={camp?43:window.innerWidth<600?42:50} near={.1} far={160}/><Suspense fallback={null}><VisionFogProvider view={view}><ArtMaterialProvider profile={profile}><City view={visual} camp={camp} assets={assets} selected={selected} reduced={reduced} profession={profession} cosmetic={cosmetic} cue={cue} onSwing={onSwing} profile={profile} edges={view?.edges??[]}/></ArtMaterialProvider></VisionFogProvider></Suspense></Canvas></AssetBoundary>}<div className="world-vignette"/></div>;
}
