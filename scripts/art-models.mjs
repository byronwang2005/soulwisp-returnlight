import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {prune,dedup,resample,textureCompress} from '@gltf-transform/functions';
import sharp from 'sharp';
const root=new URL('../',import.meta.url),publicRoot=new URL('apps/web/public/',root),sourceRoot=new URL('design/art/models/',root);
const original=JSON.parse(await readFile(new URL('design/art/sources/kaykit-manifest.json',root)));
const sha=data=>createHash('sha256').update(data).digest('hex');
const brokenSource='https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07/addons/kaykit_dungeon_remastered/Assets/gltf/wall_broken.gltf.glb';
await mkdir(sourceRoot,{recursive:true});
if(process.argv.includes('--download'))for(const entry of [...original.files.filter(f=>f.file.endsWith('.glb')),{file:'/assets/dungeon/wall_broken.gltf.glb',source:brokenSource}]){
  const destination=new URL(entry.file.split('/').at(-1),sourceRoot);try{await access(destination);continue;}catch{}
  const response=await fetch(entry.source);if(!response.ok)throw new Error(`Source failed: ${entry.source}`);const bytes=Buffer.from(await response.arrayBuffer());if(entry.sha256&&sha(bytes)!==entry.sha256)throw new Error('Source hash mismatch');await writeFile(destination,bytes);
}
const clips=['Idle','Running_A','1H_Melee_Attack_Slice_Horizontal','Death_A','Spellcast_Raise','Dodge_Forward','Interact','Cheer','Hit_A','Blocking'];
const selected=original.files.filter(f=>f.file.endsWith('.glb')&&(f.file.includes('/characters/')||/\/(?:chest(?:_gold)?|wall\.gltf|column\.gltf)\.glb$/.test(f.file)));
selected.push({file:'/assets/dungeon/wall_broken.gltf.glb',source:brokenSource});
const io=new NodeIO(),files=[],metrics=[];
for(const entry of selected){
  const name=entry.file.split('/').at(-1),input=new URL(name,sourceRoot),source=await readFile(input);if(entry.sha256&&sha(source)!==entry.sha256)throw new Error(`Original source differs: ${name}`);
  const doc=await io.read(input.pathname),r=doc.getRoot();const triangles=()=>r.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);const beforeTriangles=triangles();const beforeClips=r.listAnimations().length,beforePrimitives=r.listMeshes().reduce((n,m)=>n+m.listPrimitives().length,0);
  const character=entry.file.includes('/characters/');
  if(character){
    const weapons=name.includes('Knight')?['1H_Sword','Badge_Shield']:name.includes('Barbarian')?['1H_Axe','Barbarian_Round_Shield']:name.includes('Mage')?['1H_Wand','Spellbook']:['Knife','Knife_Offhand'];
    const hidden=new Set(r.listNodes().filter(n=>n.getMesh()&&/(Shield|Sword|Axe|Crossbow|Knife|Throwable|Mug|Spellbook|Wand|Staff)/.test(n.getName())&&!weapons.includes(n.getName())));
    for(const a of [...r.listAnimations()]){if(!clips.includes(a.getName())){a.listChannels().forEach(c=>c.dispose());a.listSamplers().forEach(s=>s.dispose());a.dispose();continue;}for(const c of [...a.listChannels()])if(hidden.has(c.getTargetNode()))c.dispose();}
    for(const n of hidden)n.setMesh(null);
  }
  await doc.transform(resample(),prune({keepLeaves:true}),dedup(),textureCompress({encoder:sharp,targetFormat:'png',resize:[256,256]}));
  const bytes=Buffer.from(await io.writeBinary(doc)),destination=new URL(entry.file.slice(1),publicRoot);await mkdir(new URL('./',destination),{recursive:true});await writeFile(destination,bytes);
  files.push({...entry,sha256:sha(bytes),bytes:bytes.length,animations:r.listAnimations().map(a=>a.getName()),derivedFrom:{file:`design/art/models/${name}`,sha256:sha(source),bytes:source.length},processing:'glTF Transform 4.4.0; selected animation clips and equipment; resample, prune, dedup; 256px palette atlas'});
  metrics.push({file:entry.file,sourceBytes:source.length,runtimeBytes:bytes.length,sourceTriangles:beforeTriangles,runtimeTriangles:triangles(),sourceAnimations:beforeClips,runtimeAnimations:r.listAnimations().length,sourcePrimitives:beforePrimitives,runtimePrimitives:r.listMeshes().reduce((n,m)=>n+m.listPrimitives().length,0)});
}
for(const entry of original.files.filter(f=>f.file.endsWith('LICENSE.txt')))files.push(entry);
const manifest={...original,files,revision:'stylized-bronze-v1',sourceManifest:'design/art/sources/kaykit-manifest.json',materials:'/assets/materials/manifest.json',landscape:{wall:'/assets/dungeon/wall_broken.gltf.glb',intactWall:'/assets/dungeon/wall.gltf.glb',column:'/assets/dungeon/column.gltf.glb'},landmarks:{beacon:'stone-lantern',altar:'broken-altar',cleanse:'verdigris-basin',purify:'core-cradle',exit:'returnlight-gate'},processing:'scripts/art-models.mjs'};
for(const [profession,entry]of Object.entries(manifest.characters))entry.appearance=profession;
manifest.scene.materials={floor:{id:'plaza',meters:2.7},road:{id:'road',meters:3.3}};manifest.scene.foundationDepth=.6;manifest.scene.groundManifest=manifest.materials;
await writeFile(new URL('assets/manifest.json',publicRoot),JSON.stringify(manifest,null,2)+'\n');await mkdir(new URL('docs/verification/',root),{recursive:true});
await writeFile(new URL('docs/verification/art-models.json',root),JSON.stringify({tool:'glTF Transform 4.4.0',source:'fixed CC0 KayKit sources',metrics,sourceBytes:metrics.reduce((n,m)=>n+m.sourceBytes,0),runtimeBytes:metrics.reduce((n,m)=>n+m.runtimeBytes,0)},null,2)+'\n');
console.log(`Models: ${(metrics.reduce((n,m)=>n+m.sourceBytes,0)/1048576).toFixed(2)} -> ${(metrics.reduce((n,m)=>n+m.runtimeBytes,0)/1048576).toFixed(2)} MiB`);
