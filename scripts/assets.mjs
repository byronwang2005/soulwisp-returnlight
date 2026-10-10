import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'apps/web/public/assets');
const packs=[
 {id:'characters',repo:'KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0',sha:'672074b73ba276876a19e8816ecdc5241817ab47',prefix:'addons/kaykit_character_pack_adventures/Characters/gltf/',files:['Knight.glb','Rogue.glb','Rogue_Hooded.glb','Mage.glb','Barbarian.glb']},
 {id:'dungeon',repo:'KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',sha:'b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07',prefix:'addons/kaykit_dungeon_remastered/Assets/gltf/',files:['chest.glb','chest_gold.glb','pillar_decorated.gltf.glb','column.gltf.glb','floor_tile_large.gltf.glb','wall.gltf.glb','torch_lit.gltf.glb','stairs.gltf.glb','table_small.gltf.glb']}
];
const files=[];
for(const pack of packs){
 await fs.mkdir(path.join(out,pack.id),{recursive:true});
 for(const filename of [...pack.files,'LICENSE.txt']){
  const source=`https://raw.githubusercontent.com/${pack.repo}/${pack.sha}/${filename==='LICENSE.txt'?'LICENSE.txt':pack.prefix+filename}`;
  const dest=path.join(out,pack.id,filename); const response=await fetch(source);
  if(!response.ok)throw new Error(`${source}: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer()); await fs.writeFile(dest,bytes);
  let animations=[]; if(filename.endsWith('.glb')){ const length=bytes.readUInt32LE(12); const json=JSON.parse(bytes.subarray(20,20+length).toString());animations=(json.animations||[]).map(x=>x.name); }
  files.push({file:`/assets/${pack.id}/${filename}`,source,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,animations});
 }
}
const manifest={license:'CC0-1.0',creator:'Kay Lousberg',source:'https://kaylousberg.itch.io/',downloadedAt:new Date().toISOString(),characters:{warden:'/assets/characters/Knight.glb',scout:'/assets/characters/Rogue_Hooded.glb',scavenger:'/assets/characters/Barbarian.glb',broker:'/assets/characters/Mage.glb',medic:'/assets/characters/Mage.glb',engineer:'/assets/characters/Knight.glb',forensic:'/assets/characters/Mage.glb',bellkeeper:'/assets/characters/Barbarian.glb',ranger:'/assets/characters/Rogue.glb'},files};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Imported ${files.length} CC0 assets, ${Math.round(files.reduce((a,f)=>a+f.bytes,0)/1024/1024)} MiB`);
