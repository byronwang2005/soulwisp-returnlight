import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {WorldObject} from '@wangxu/shared';
import {ART_PALETTE,PROFESSION_ART,type ArtSurface,type Attachment} from './art-config';
export type ArtMaterials=Record<ArtSurface,THREE.MeshStandardMaterial>;
type Shape='box'|'cylinder'|'cone'|'sphere'|'torus';
export interface Part{shape:Shape;size:number[];at:[number,number,number];rotation?:[number,number,number];surface:ArtSurface;}
export const part=(shape:Shape,size:number[],at:[number,number,number],surface:ArtSurface,rotation?:[number,number,number]):Part=>({shape,size,at,surface,rotation});
function geometry(p:Part){switch(p.shape){case'box':return new THREE.BoxGeometry(...p.size as [number,number,number]);case'cylinder':return new THREE.CylinderGeometry(...p.size as [number,number,number,number]);case'cone':return new THREE.ConeGeometry(...p.size as [number,number,number]);case'sphere':return new THREE.SphereGeometry(p.size[0],8,6);case'torus':return new THREE.TorusGeometry(p.size[0],p.size[1],4,p.size[2]??12);}}
export function assembleArt(parts:Part[],materials:ArtMaterials,name:string){
  const group=new THREE.Group();group.name=name;
  for(const surface of [...new Set(parts.map(p=>p.surface))]){
    const chunks=parts.filter(p=>p.surface===surface).map(p=>{const original=geometry(p),g=original.toNonIndexed();if(original!==g)original.dispose();const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...p.at),new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation??[0,0,0])),new THREE.Vector3(1,1,1));return g.applyMatrix4(matrix);});
    const merged=mergeGeometries(chunks,false)!;chunks.forEach(g=>g.dispose());const mesh=new THREE.Mesh(merged,materials[surface]);mesh.castShadow=mesh.receiveShadow=true;mesh.name=`${name}:${surface}`;group.add(mesh);
  }
  return group;
}
export function landmarkParts(kind:WorldObject['kind'],id:string):Part[]{
  const stone='foundation',copper='bronze';
  if(kind==='beacon')return [part('cylinder',[.57,.65,.18,8],[0,.09,0],stone),part('cylinder',[.21,.3,1.32,8],[0,.84,0],stone),part('box',[.62,.12,.62],[0,1.53,0],copper),part('cone',[.46,.34,4],[0,2.17,0],copper),...[-1,1].flatMap(x=>[-1,1].map(z=>part('box',[.065,.56,.065],[x*.24,1.86,z*.24],copper))),part('torus',[.15,.035,10],[0,2.44,0],copper)];
  if(kind==='altar')return [part('cylinder',[.78,.85,.22,5],[0,.11,0],stone),part('cylinder',[.49,.65,.62,5],[0,.53,0],stone),part('cylinder',[.78,.63,.12,5],[0,.9,0],stone),...Array.from({length:5},(_,i)=>{const a=i*Math.PI*2/5;return part('box',[.07,.43,.07],[Math.cos(a)*.61,.67,Math.sin(a)*.61],copper,[0,-a,.12]);}),part('torus',[.36,.035,10],[0,.99,0],copper,[Math.PI/2,0,0]),part('box',[.11,.015,.54],[.05,1.01,0],copper,[0,.5,0]),part('box',[.18,.13,.16],[.67,.065,.14],stone,[0,.45,0])];
  if(kind==='cleanse'){
    const purify=id==='purify';return [part('cylinder',[.83,.91,.2,purify?6:12],[0,.1,0],stone),part('cylinder',[.55,.7,.42,purify?6:12],[0,.41,0],stone),part('torus',[.6,.075,purify?6:12],[0,.65,0],copper,[Math.PI/2,0,0]),...Array.from({length:purify?3:4},(_,i)=>{const a=i*Math.PI*2/(purify?3:4);return part('box',[.11,purify?.55:.2,.15],[Math.cos(a)*.4,purify?.91:.5,Math.sin(a)*.4],copper,[0,-a,purify?.25:0]);}),part('cylinder',[.4,.45,.045,12],[0,.63,0],copper)];
  }
  if(kind==='exit')return [part('box',[5.7,.14,1.05],[0,.07,0],stone),...[-1,1].flatMap(side=>[part('box',[.8,.23,.94],[side*2.35,.25,0],stone),part('box',[.56,2.8,.6],[side*2.35,1.65,0],stone),part('box',[.86,.23,.92],[side*2.35,3.18,0],stone),part('box',[.09,2.4,.065],[side*2.35,1.7,.33],copper)]),part('box',[5.5,.42,.68],[0,3.42,0],stone),part('box',[4.55,.075,.04],[0,3.4,.37],copper),part('torus',[.29,.065,12],[0,3.42,.4],copper),part('cylinder',[.13,.2,.65,5],[-2.85,.395,.22],stone)];
  return [];
}
export function attachmentParts(kind:Attachment):{bone:string;parts:Part[]}{
  const bronze='bronze',cloth='cloth',leather='leather';
  switch(kind){
    case'shoulder-lantern':return {bone:'chest',parts:[part('box',[.18,.25,.18],[-.66,.48,.03],bronze),part('box',[.09,.13,.19],[-.66,.48,.03],cloth),part('torus',[.07,.018,8],[-.66,.65,.03],bronze)]};
    case'scout-pouch':return {bone:'hips',parts:[part('box',[.23,.25,.15],[.4,.28,-.04],leather),part('box',[.06,.05,.02],[.4,.28,.04],bronze)]};
    case'tools':return {bone:'chest',parts:[part('box',[.4,.46,.24],[0,.08,-.55],leather),part('box',[.055,.62,.06],[.14,.17,-.69],bronze,[0,0,.24]),part('box',[.25,.075,.11],[.08,.41,-.69],bronze,[0,0,.24])]};
    case'cargo':return {bone:'chest',parts:[part('box',[.55,.52,.3],[0,.12,-.56],leather),part('box',[.055,.56,.32],[-.16,.12,-.56],bronze),part('box',[.055,.56,.32],[.16,.12,-.56],bronze)]};
    case'documents':return {bone:'hips',parts:[part('box',[.21,.32,.14],[-.4,.26,.04],leather),part('cylinder',[.043,.043,.35,8],[-.4,.31,.04],cloth,[0,0,.18])]};
    case'medicine':return {bone:'hips',parts:[part('box',[.27,.23,.16],[.4,.27,.08],leather),...[-1,1].map(x=>part('cylinder',[.045,.05,.18,8],[.4+x*.07,.36,.18],bronze)),part('box',[.12,.03,.015],[.4,.27,.17],cloth),part('box',[.03,.12,.015],[.4,.27,.17],cloth)]};
    case'scarf':return {bone:'chest',parts:[part('box',[.65,.11,.35],[0,.32,.11],cloth),part('box',[.14,.39,.045],[.25,.1,.31],cloth)]};
    case'goggles':return {bone:'head',parts:[...[-1,1].map(x=>part('torus',[.13,.035,8],[x*.17,.84,.7],bronze)),part('box',[.09,.035,.035],[0,.84,.7],leather)]};
    case'gear':return {bone:'hand.l',parts:[part('torus',[.14,.04,8],[0,.08,0],bronze,[Math.PI/2,0,0]),...Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return part('box',[.06,.08,.06],[Math.cos(a)*.16,.08,Math.sin(a)*.16],bronze,[0,a,0]);})]};
    case'lens':return {bone:'chest',parts:[part('torus',[.11,.035,10],[-.54,.37,.26],bronze),part('box',[.04,.2,.04],[-.54,.21,.26],leather)]};
    case'short-cap':return {bone:'head',parts:[part('cylinder',[.46,.5,.18,8],[0,.99,0],cloth),part('box',[.6,.045,.3],[0,.91,.35],leather)]};
    case'bell':return {bone:'hips',parts:[part('cone',[.16,.24,8],[-.43,.28,.12],bronze),part('sphere',[.04],[-.43,.15,.12],bronze),part('torus',[.07,.02,8],[-.43,.45,.12],bronze)]};
    case'clock':return {bone:'chest',parts:[part('torus',[.15,.045,12],[.59,.4,.13],bronze),part('box',[.023,.19,.02],[.59,.43,.14],cloth),part('box',[.11,.023,.02],[.64,.4,.14],cloth)]};
    case'quiver':return {bone:'chest',parts:[part('cylinder',[.12,.11,.58,8],[.24,.17,-.57],leather,[0,0,-.24]),...[-1,0,1].map(x=>part('box',[.022,.64,.022],[.19+x*.06,.45,-.57],bronze,[0,0,-.24]))]};
    case'leaf-cape':return {bone:'chest',parts:[part('cone',[.55,.65,5],[-.05,.03,-.5],cloth,[.18,0,Math.PI])]};
  }
}
export function attachProfessionArt(scene:THREE.Object3D,profession:keyof typeof PROFESSION_ART,materials:ArtMaterials){
  for(const kind of PROFESSION_ART[profession].attachments){const {bone,parts}=attachmentParts(kind),parent=scene.getObjectByName(bone);if(!parent)throw new Error(`Missing attachment bone: ${bone}`);parent.add(assembleArt(parts,materials,`attachment:${kind}`));}
}
export function disposeArtGeometry(group:THREE.Object3D){group.traverse(node=>{if(node instanceof THREE.Mesh)node.geometry.dispose();});}
export function fallbackArtMaterials():ArtMaterials{return Object.fromEntries(['foundation','bronze','wood','cloth','leather'].map(surface=>[surface,new THREE.MeshStandardMaterial({color:surface==='bronze'?ART_PALETTE.bronze:surface==='cloth'?ART_PALETTE.paper:surface==='foundation'?ART_PALETTE.stone:'#92704b',metalness:surface==='bronze'?.7:0,roughness:surface==='bronze'?.55:.9})])) as ArtMaterials;}
