import {local,fs,path,loadEnv,binary,run} from './lib.mjs';
import {postgresEnvironment} from './postgres.mjs';
const file=path.resolve(process.argv[2]||path.join(local,'backups',`wangxu-${new Date().toISOString().replaceAll(':','-')}.dump`));fs.mkdirSync(path.dirname(file),{recursive:true});
const env=loadEnv();run(binary('pg_dump'),['--format=custom','--file',file],{env:postgresEnvironment(env.DATABASE_URL,env)});fs.chmodSync(file,0o600);console.log(`Backup: ${file}`);
