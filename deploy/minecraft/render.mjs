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
if(connection.version!=='26.3'||connection.maxPlayers!==10||!connection.onlineMode||!connection.whitelist||connection.difficulty!=='normal')throw new Error('Unexpected connection configuration.');
const lock=JSON.parse(await fs.readFile(path.join(source,'mods.lock.json'),'utf8'));
await fs.mkdir(path.join(output,'data/mods'),{recursive:true});
await fs.mkdir(path.join(output,'data/logs'),{recursive:true});
await fs.mkdir(path.join(output,'data/config/servercore'),{recursive:true});
await fs.mkdir(path.join(output,'backups'),{recursive:true,mode:0o700});
// Keep the existing management credential across re-renders.
let previous='';
try{previous=await fs.readFile(path.join(output,'.env'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
const password=previous.match(/^RCON_PASSWORD=([a-f0-9]{64})$/m)?.[1]||randomBytes(32).toString('hex');
const whitelist=previous.match(/^MINECRAFT_WHITELIST=([A-Za-z0-9_,]*)$/m)?.[1]||'';
const previousBind=previous.match(/^MINECRAFT_BIND_IP=(.*)$/m)?.[1];
const bindIp=isIP(previousBind||'')===4?previousBind:(await lookup(host,{family:4})).address;
await fs.writeFile(path.join(output,'.env'),`MINECRAFT_VERSION=${connection.version}\nMINECRAFT_MAX_PLAYERS=${connection.maxPlayers}\nMINECRAFT_DIFFICULTY=${connection.difficulty}\nMINECRAFT_BIND_IP=${bindIp}\nMINECRAFT_WHITELIST=${whitelist}\nRCON_PASSWORD=${password}\n`,{mode:0o600});
await fs.chmod(path.join(output,'.env'),0o600);
if(output!==source)await fs.copyFile(path.join(source,'compose.yaml'),path.join(output,'compose.yaml'));
for(const mod of lock.mods){
  if(!/^https:\/\/cdn\.modrinth\.com\//.test(mod.url)||! /^[a-f0-9]{128}$/.test(mod.sha512)||path.basename(mod.filename)!==mod.filename)throw new Error(`Invalid locked artifact: ${mod.project}`);
  const target=path.join(output,'data/mods',mod.filename);
  let bytes;
  try{bytes=await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes||createHash('sha512').update(bytes).digest('hex')!==mod.sha512){
    const response=await fetch(mod.url,{signal:AbortSignal.timeout(60_000)});
    if(!response.ok)throw new Error(`Download failed for ${mod.project}: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(createHash('sha512').update(bytes).digest('hex')!==mod.sha512)throw new Error(`Checksum mismatch: ${mod.project}`);
    await fs.writeFile(target,bytes);
  }
  console.log(`Verified ${mod.project} ${mod.version}`);
}
const expected=new Set(lock.mods.map(mod=>mod.filename));
const extra=(await fs.readdir(path.join(output,'data/mods'))).filter(name=>name.endsWith('.jar')&&!expected.has(name));
if(extra.length)throw new Error(`Unmanaged mods require review: ${extra.join(', ')}`);
await fs.writeFile(path.join(output,'data/config/servercore/config.yml'),`features:
  lobotomize-villagers:
    enabled: false
dynamic:
  enabled: true
  target-mspt: 40
  default-values:
    VIEW_DISTANCE: 8
    SIMULATION_DISTANCE: 4
    MOBCAP_PERCENTAGE: 100
  dynamic-settings:
    - setting: VIEW_DISTANCE
      max: 8
      min: 6
      increment: 1
      interval: 30
`);
await fs.writeFile(path.join(output,'data/config/servercore/optimizations.yml'),`reduce-sync-loads: true
cache-ticking-chunks: true
optimize-command-blocks: false
fast-biome-lookups: false
cancel-duplicate-fluid-ticks: false
`);
console.log('Rendered Minecraft configuration; private management credentials were preserved.');
