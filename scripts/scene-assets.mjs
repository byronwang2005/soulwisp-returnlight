import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../apps/web/public',import.meta.url));
const manifest=JSON.parse(await readFile(`${root}/assets/manifest.json`,'utf8'));
const metrics=[];
for(const [profession,entry]of [...Object.entries(manifest.characters),...Object.entries(manifest.enemies??{}).map(([name,entry])=>[`enemy:${name}`,entry])]){
  const measurementPath=entry.path.replace('Rogue_Hooded.glb','Rogue.glb');
  const data=await readFile(`${root}${measurementPath}`),gltf=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  for(const [action,clip]of Object.entries(entry.clips??{}))if(!gltf.animations?.some(a=>a.name===clip))throw new Error(`Missing ${action} clip for ${profession}: ${clip}`);
  const bounds=gltf.nodes.filter(node=>node.mesh!==undefined&&/_(?:Body|Head|ArmLeft|ArmRight|LegLeft|LegRight)$/.test(node.name)).flatMap(node=>gltf.meshes[node.mesh].primitives.map(primitive=>gltf.accessors[primitive.attributes.POSITION]));
  if(!bounds.length)throw new Error(`No body geometry: ${entry.path}`);
  const foot=Math.min(...bounds.map(b=>b.min[1])),top=Math.max(...bounds.map(b=>b.max[1]));
  metrics.push({profession,path:entry.path,measurementPath,rawHeight:top-foot,rawFoot:foot,scale:entry.scale,bodyHeight:(top-foot)*entry.scale,footHeight:foot*entry.scale+entry.footOffset});
  if(Math.abs((top-foot)*entry.scale-2.2)>.005||Math.abs(foot*entry.scale+entry.footOffset)>.005)throw new Error(`Body calibration differs: ${profession}`);
}
const report={measurement:'Skinned body bind geometry POSITION bounds; excludes hats, cape and held equipment; hooded Rogue uses the bare Rogue head as body reference',bodyHeight:2.2,metrics};
if(process.argv.includes('--record'))await writeFile('docs/verification/character-scale.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
