import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';

const source=path.dirname(fileURLToPath(import.meta.url));
const output=path.resolve(process.argv[2]||source);
const connectionPath=process.argv[3]||path.resolve(source,'../../apps/web/src/minecraft-server.json');
const connection=JSON.parse(await fs.readFile(connectionPath,'utf8'));
const host=connection.address.split(':')[0];
if(host.length>253||! /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||connection.address!==`${host}:25565`)throw new Error('The public connection must be a domain on TCP 25565.');
if(connection.version!=='1.21.1'||connection.maxPlayers!==6||connection.loader!=='NeoForge'||connection.loaderVersion!=='21.1.133'||connection.modpackVersion!=='1.0.5'||!connection.onlineMode||!connection.whitelist||!['normal','hard'].includes(connection.difficulty))throw new Error('Unexpected connection configuration.');
const blade=JSON.parse(await fs.readFile(path.join(source,'starblade/resourcepack.json'),'utf8'));
if(!blade||!/^https:\/\/gaming\.byron\.wang\/minecraft\/starblade-[a-f0-9]{40}\.zip$/.test(blade.url)||! /^[a-f0-9]{40}$/.test(blade.sha1)||!blade.url.includes(blade.sha1))throw new Error('Invalid required weapon resource pack.');
const release=JSON.parse(await fs.readFile(path.join(source,'starblade/release.json'),'utf8'));
const lock=JSON.parse(await fs.readFile(path.join(source,'mods.lock.json'),'utf8'));
await fs.mkdir(path.join(output,'data/mods'),{recursive:true});
await fs.mkdir(path.join(output,'data/logs'),{recursive:true});
await fs.mkdir(path.join(output,'backups'),{recursive:true,mode:0o700});
// Keep the existing management credential across re-renders.
let previous='';
try{previous=await fs.readFile(path.join(output,'.env'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
const password=previous.match(/^RCON_PASSWORD=([a-f0-9]{64})$/m)?.[1]||randomBytes(32).toString('hex');
const whitelist=previous.match(/^MINECRAFT_WHITELIST=([A-Za-z0-9_,]*)$/m)?.[1]||'';
const previousBind=previous.match(/^MINECRAFT_BIND_IP=(.*)$/m)?.[1];
const bindIp=isIP(previousBind||'')===4?previousBind:(await lookup(host,{family:4})).address;
await fs.writeFile(path.join(output,'.env'),`MINECRAFT_VERSION=${connection.version}\nMINECRAFT_LOADER_VERSION=${connection.loaderVersion}\nMINECRAFT_MAX_PLAYERS=${connection.maxPlayers}\nMINECRAFT_DIFFICULTY=${connection.difficulty}\nMINECRAFT_BIND_IP=${bindIp}\nMINECRAFT_WHITELIST=${whitelist}\nMINECRAFT_RESOURCE_PACK=${blade.url}\nMINECRAFT_RESOURCE_PACK_SHA1=${blade.sha1}\nMINECRAFT_RESOURCE_PACK_ENFORCE=TRUE\nRCON_PASSWORD=${password}\n`,{mode:0o600});
await fs.chmod(path.join(output,'.env'),0o600);
if(output!==source)await fs.copyFile(path.join(source,'compose.yaml'),path.join(output,'compose.yaml'));
for(const mod of lock.mods){
  if((mod.url&&!/^https:\/\/cdn\.modrinth\.com\//.test(mod.url))||! /^[a-f0-9]{128}$/.test(mod.sha512)||path.basename(mod.filename)!==mod.filename)throw new Error(`Invalid locked artifact: ${mod.project}`);
  const target=path.join(output,'data/mods',mod.filename);
  let bytes;
  try{bytes=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes||createHash('sha512').update(bytes).digest('hex')!==mod.sha512){
    if(!mod.url)throw new Error(`Prepare the supplied server pack first: ${mod.filename}`);
    const response=await fetch(mod.url,{signal:AbortSignal.timeout(60_000)});
    if(!response.ok)throw new Error(`Download failed for ${mod.project}: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(createHash('sha512').update(bytes).digest('hex')!==mod.sha512)throw new Error(`Checksum mismatch: ${mod.project}`);
    await fs.writeFile(target,bytes);
  }
  console.log(`Verified ${mod.project} ${mod.version||lock.version}`);
}
if(path.basename(release.filename)!==release.filename||! /^[a-f0-9]{64}$/.test(release.sha256))throw new Error('Invalid server module release.');
const addon=await fs.readFile(path.join(source,'starblade/dist',release.filename));
if(createHash('sha256').update(addon).digest('hex')!==release.sha256)throw new Error('Server module checksum mismatch.');
await fs.writeFile(path.join(output,'data/mods',release.filename),addon);
const legacy=path.join(output,'data/mods','byron-perks-1.0.0.jar');
await fs.rm(legacy,{force:true});
const expected=new Set([...lock.mods.map(mod=>mod.filename),release.filename]);
const extra=(await fs.readdir(path.join(output,'data/mods'))).filter(name=>name.endsWith('.jar')&&!expected.has(name));
if(extra.length)throw new Error(`Unmanaged mods require review: ${extra.join(', ')}`);
console.log('Rendered Create configuration; private binding, management credentials and whitelist were preserved.');
