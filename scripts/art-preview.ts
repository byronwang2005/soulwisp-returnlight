/** CPU-only glTF/Three.js projection. No browser, renderer, WebGL or GPU. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';
import {PROFESSION_ART} from '../apps/web/src/art-config';
import {attachProfessionArt,assembleArt,landmarkParts,fallbackArtMaterials} from '../apps/web/src/art-geometry';
import {groundPolygons,foundationGeometry,pavingGeometry} from '../apps/web/src/ground-geometry';
import {getConfig,getLayout} from '../packages/rules/src/index';
import {SCENE,type Profession} from '../packages/shared/src/index';
const root=new URL('../',import.meta.url),out=new URL('docs/verification/art-preview/',root),pub=new URL('apps/web/public/',root);
await mkdir(out,{recursive:true});const manifest=JSON.parse(await readFile(new URL('assets/manifest.json',pub),'utf8')),io=new NodeIO();
const mats=fallbackArtMaterials(),samples=new Map<THREE.Material,{data:Buffer;width:number;height:number;channels:number}>();
async function character(profession:Profession){
 const entry=manifest.characters[profession],doc=await io.read(new URL(entry.path.slice(1),pub).pathname),r=doc.getRoot(),group=new THREE.Group();
 // Evaluate the same initial Idle pose used by the runtime AnimationMixer.
 for(const channel of r.listAnimations().find(a=>a.getName()==='Idle')!.listChannels()){
  const node=channel.getTargetNode()!,values=channel.getSampler()!.getOutput()!,v=values.getElement(0,[]);
  if(channel.getTargetPath()==='translation')node.setTranslation(v as [number,number,number]);
  if(channel.getTargetPath()==='rotation')node.setRotation(v as [number,number,number,number]);
  if(channel.getTargetPath()==='scale')node.setScale(v as [number,number,number]);
 }
 const nodes=new Map(r.listNodes().map(n=>{const object=new THREE.Group();object.name=n.getName();object.position.fromArray(n.getTranslation());object.quaternion.fromArray(n.getRotation());object.scale.fromArray(n.getScale());return [n,object] as const;}));
 for(const n of r.listNodes()){const obj=nodes.get(n)!;for(const child of n.listChildren())obj.add(nodes.get(child)!);}
 for(const n of r.getDefaultScene()!.listChildren())group.add(nodes.get(n)!);
 for(const n of r.listNodes()){
  if(!n.getMesh())continue;const object=nodes.get(n)!;if(PROFESSION_ART[profession].hide.includes(n.getName())){object.visible=false;continue;}
  for(const p of n.getMesh()!.listPrimitives()){
   const pos=p.getAttribute('POSITION')!,positions=new Float32Array(pos.getArray()!),skin=n.getSkin();
   if(skin){const joints=skin.listJoints(),ibm=skin.getInverseBindMatrices()!,weights=p.getAttribute('WEIGHTS_0')!,indices=p.getAttribute('JOINTS_0')!;
    const invWorld=new THREE.Matrix4().fromArray(n.getWorldMatrix()).invert();
    const matrices=joints.map((j,i)=>new THREE.Matrix4().multiplyMatrices(invWorld,new THREE.Matrix4().fromArray(j.getWorldMatrix())).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i,[]))));
    for(let i=0;i<pos.getCount();i++){const vertex=new THREE.Vector3().fromArray(pos.getElement(i,[])),sum=new THREE.Vector3(),w=weights.getElement(i,[]),j=indices.getElement(i,[]);for(let k=0;k<4;k++)sum.addScaledVector(vertex.clone().applyMatrix4(matrices[j[k]]),w[k]);sum.toArray(positions,i*3);}
   }
   const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3));if(p.getIndices())g.setIndex(new THREE.BufferAttribute(new Uint32Array(p.getIndices()!.getArray()!),1));if(p.getAttribute('TEXCOORD_0'))g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(p.getAttribute('TEXCOORD_0')!.getArray()!),2));
   const selective=/Mage_Arm|Rogue_Head_Hooded/.test(n.getName()),zone=/Cape|_Body/.test(n.getName())||selective?'cloth':/Helmet|Shield|Sword|Axe|Knife|Wand|Crossbow/.test(n.getName())?'bronze':null;
   const color=zone==='cloth'?PROFESSION_ART[profession].cloth:zone==='bronze'?PROFESSION_ART[profession].equipment:'#ffffff',material=new THREE.MeshStandardMaterial({color});
   const texture=p.getMaterial()?.getBaseColorTexture();if(texture){const sample=await sharp(Buffer.from(texture.getImage()!)).removeAlpha().raw().toBuffer({resolveWithObject:true});samples.set(material,{data:sample.data,...sample.info});material.userData.selective=selective;}
   object.add(new THREE.Mesh(g,material));
  }
 }
 attachProfessionArt(group,profession,mats);group.scale.setScalar(entry.scale);group.position.y=entry.footOffset;return group;
}
function project(group:THREE.Group,x:number,y:number,width:number,height:number,worldHeight:number){
 group.updateMatrixWorld(true);const direction=new THREE.Vector3(.8,.45,1).normalize(),right=new THREE.Vector3(direction.z,0,-direction.x).normalize(),up=new THREE.Vector3().crossVectors(direction,right),bounds=new THREE.Box3().setFromObject(group),center=bounds.getCenter(new THREE.Vector3()),scale=Math.min(height/worldHeight,width/((bounds.max.x-bounds.min.x)*1.2));
 const triangles:{depth:number;svg:string}[]=[];
 group.traverseVisible(o=>{if(!(o instanceof THREE.Mesh))return;const g=o.geometry,p=g.getAttribute('position'),idx=g.index,uv=g.getAttribute('uv'),material=o.material as THREE.MeshStandardMaterial,sample=samples.get(material);
  for(let i=0;i<(idx?.count??p.count);i+=3){const ids=[0,1,2].map(k=>idx?idx.getX(i+k):i+k),v=ids.map(j=>new THREE.Vector3().fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld));const normal=new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]),v[2].clone().sub(v[0])).normalize();if(normal.dot(direction)<0)continue;
   let color=material.color.clone();if(sample&&uv){const u=ids.reduce((s,j)=>s+uv.getX(j),0)/3,vv=ids.reduce((s,j)=>s+uv.getY(j),0)/3,sx=Math.max(0,Math.min(sample.width-1,Math.floor(u*sample.width))),sy=Math.max(0,Math.min(sample.height-1,Math.floor(vv*sample.height))),offset=(sy*sample.width+sx)*sample.channels;const sampled=new THREE.Color().setRGB(sample.data[offset]/255,sample.data[offset+1]/255,sample.data[offset+2]/255,THREE.SRGBColorSpace);color=color.getHex()===0xffffff||(material.userData.selective&&Math.max(sampled.g,sampled.b)<sampled.r*1.12)?sampled:new THREE.Color().setRGB(.2126*sampled.r+.7152*sampled.g+.0722*sampled.b,.2126*sampled.r+.7152*sampled.g+.0722*sampled.b,.2126*sampled.r+.7152*sampled.g+.0722*sampled.b).multiply(color).lerp(sampled,.18);}
   const shade=.55+.45*Math.max(0,normal.dot(new THREE.Vector3(-.4,.8,1).normalize()));color.multiplyScalar(shade);
   const points=v.map(q=>{q.sub(center);return `${(x+width/2+q.dot(right)*scale).toFixed(2)},${(y+height/2-q.dot(up)*scale).toFixed(2)}`;}).join(' ');
   triangles.push({depth:v.reduce((s,q)=>s+q.dot(direction),0)/3,svg:`<polygon points="${points}" fill="#${color.getHexString()}"/>`});
  }
 });return triangles.sort((a,b)=>a.depth-b.depth).map(t=>t.svg).join('');
}
async function sheet(file:string,width:number,height:number,body:string){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171512"/>${body}</svg>`;await writeFile(new URL(`${file}.svg`,out),svg);await sharp(Buffer.from(svg)).png().toFile(new URL(`${file}.png`,out).pathname);}
const names={warden:'Warden',scout:'Scout',scavenger:'Scavenger',broker:'Broker',medic:'Medic',engineer:'Engineer',forensic:'Forensic',bellkeeper:'Bellkeeper',ranger:'Ranger'};
let body='';for(const [i,profession]of (Object.keys(PROFESSION_ART) as Profession[]).entries()){const x=(i%5)*250,y=Math.floor(i/5)*340,group=await character(profession);body+=`<text x="${x+125}" y="${y+26}" text-anchor="middle" fill="#efe4ce" font-family="sans-serif" font-size="18">${names[profession]}</text>`+project(group,x,y+45,250,280,3.3);}
await sheet('professions',1250,680,body);
body='';for(const [i,[kind,id]]of ([['beacon','beacon'],['altar','altar'],['cleanse','cleanse'],['cleanse','purify'],['exit','exit']] as const).entries()){const group=assembleArt(landmarkParts(kind,id),mats,id),x=i*320;body+=`<text x="${x+160}" y="28" text-anchor="middle" fill="#efe4ce" font-family="sans-serif" font-size="18">${id}</text>`+project(group,x,45,320,350,id==='exit'?7:3.4);}
await sheet('facilities',1600,410,body);
const layout=getLayout(getConfig(10),2),polygons=groundPolygons(layout.nodes.map(n=>({...n,x:(n.x-500)/20,y:(n.y-350)/20,radius:n.radius/20})),layout.edges,SCENE.corridorRadius/SCENE.unitsPerMeter),ground=new THREE.Group();ground.add(new THREE.Mesh(pavingGeometry(polygons.floor,2.7),new THREE.MeshStandardMaterial({color:'#aaa696'})),new THREE.Mesh(pavingGeometry(polygons.roads,3.3),new THREE.MeshStandardMaterial({color:'#777566'})),new THREE.Mesh(foundationGeometry(polygons.foundation),mats.foundation));await sheet('foundation',1200,750,project(ground,0,0,1200,750,45));
const ids=Object.keys(JSON.parse(await readFile(new URL('assets/materials/manifest.json',pub),'utf8')).materials),tiles=[];let label='';
for(const [i,id]of ids.entries()){const tile=await sharp(new URL(`assets/materials/${id}_color_1024.webp`,pub).pathname).resize(160,160).png().toBuffer(),x=i%4*340,y=Math.floor(i/4)*370;for(let a=0;a<2;a++)for(let b=0;b<2;b++)tiles.push({input:tile,left:x+a*160,top:y+35+b*160});label+=`<text x="${x+160}" y="${y+24}" text-anchor="middle" fill="#efe4ce" font-family="sans-serif" font-size="18">${id} (2 x 2)</text>`;}
const labels=Buffer.from(`<svg width="1360" height="740">${label}</svg>`);await sharp({create:{width:1360,height:740,channels:3,background:'#171512'}}).composite([...tiles,{input:labels,left:0,top:0}]).png().toFile(new URL('texture-tiles.png',out).pathname);
console.log('CPU projections: professions, facilities, foundation; 2x2 runtime texture tiles');
