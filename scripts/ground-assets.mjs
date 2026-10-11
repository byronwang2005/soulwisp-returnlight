import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../apps/web/public',import.meta.url));
const manifest=JSON.parse(await readFile(`${root}/assets/ground/manifest.json`,'utf8'));
for(const entry of manifest.files){
  const destination=`${root}${entry.file}`;
  let bytes;
  if(process.argv.includes('--download')){
    const response=await fetch(entry.source);if(!response.ok)throw new Error(`${entry.source}: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
  }else bytes=await readFile(destination);
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==entry.sha256||bytes.length!==entry.bytes)throw new Error(`Asset differs from pinned revision: ${entry.file}`);
  if(process.argv.includes('--download'))await writeFile(destination,bytes);
}
console.log(`Verified ${manifest.files.length} pinned CC0 ground textures`);
