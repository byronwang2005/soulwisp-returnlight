import {root,local,fs,path,run,binary,loadEnv} from './lib.mjs';
import {randomBytes} from 'node:crypto';
fs.mkdirSync(local,{recursive:true});
if(!fs.existsSync(path.join(root,'.env'))){const password=randomBytes(20).toString('hex');const secret=randomBytes(32).toString('hex');fs.writeFileSync(path.join(root,'.env'),`DATABASE_URL=postgres://wangxu:${password}@127.0.0.1:55432/wangxu\nAUTH_SECRET=${secret}\nAUTH_BASE_URL=http://localhost:5180\nALLOWED_ORIGINS=http://localhost:5180,http://127.0.0.1:5180\nAPI_PORT=3000\nGAME_PORT=2567\nLIVEKIT_URL=http://127.0.0.1:7880\nLIVEKIT_PUBLIC_URL=ws://localhost:7880\nLIVEKIT_API_KEY=wangxu-local\nLIVEKIT_API_SECRET=${randomBytes(32).toString('hex')}\n`,{mode:0o600});}
const env=loadEnv();const db=new URL(env.DATABASE_URL);const datadir=path.join(local,'postgres');
if(!fs.existsSync(path.join(datadir,'PG_VERSION'))){fs.writeFileSync(path.join(local,'pg-password'),decodeURIComponent(db.password),{mode:0o600});try{run(binary('initdb'),['-D',datadir,'-U',decodeURIComponent(db.username),'--auth=scram-sha-256','--pwfile',path.join(local,'pg-password'),'--encoding=UTF8','--locale=C']);}finally{fs.rmSync(path.join(local,'pg-password'),{force:true});}}
const ready=await import('node:child_process').then(({spawnSync})=>spawnSync(binary('pg_isready'),['-h',db.hostname,'-p',db.port],{stdio:'ignore'}).status===0);
if(!ready)run(binary('pg_ctl'),['-D',datadir,'-l',path.join(local,'postgres.log'),'-o',`-p ${db.port} -h ${db.hostname} -k ${local}`,'-w','start']);
const dbEnv={...env,PGPASSWORD:decodeURIComponent(db.password)};
const databaseName=decodeURIComponent(db.pathname.slice(1));if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName))throw new Error('Local database name must use letters, numbers and underscores.');
const child=await import('node:child_process');const found=child.spawnSync(binary('psql'),['-h',db.hostname,'-p',db.port,'-U',decodeURIComponent(db.username),'-d','postgres','-tAc',`SELECT 1 FROM pg_database WHERE datname='${databaseName}'`],{encoding:'utf8',env:dbEnv});
if(found.status!==0)throw new Error('Cannot authenticate isolated PostgreSQL. Check .env and .local/postgres.log.');
if(!found.stdout.trim())run(binary('createdb'),['-h',db.hostname,'-p',db.port,'-U',decodeURIComponent(db.username),databaseName],{env:dbEnv});
const rtc=env.LAN_IP||'127.0.0.1';
fs.writeFileSync(path.join(local,'livekit.yaml'),`port: 7880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  tcp_port: 7881\n  port_range_start: 50000\n  port_range_end: 50100\n  use_external_ip: false\n  node_ip: ${rtc}\nroom:\n  auto_create: false\nkeys:\n  ${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}\n`,{mode:0o600});
console.log('Local database is ready on 127.0.0.1:55432. Secrets saved in ignored .env.');
