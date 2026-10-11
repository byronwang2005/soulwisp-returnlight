import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../apps/web/public/',import.meta.url);
if(process.argv.includes('--download'))throw new Error('Generated textures are restored from committed sources with node scripts/art-textures.mjs');
const manifest=JSON.parse(await readFile(new URL('assets/materials/manifest.json',root)));
for(const entry of manifest.files){const bytes=await readFile(new URL(entry.file.slice(1),root));if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error(`Material differs from manifest: ${entry.file}`);}
console.log(`Verified ${manifest.files.length} generated material maps`);
