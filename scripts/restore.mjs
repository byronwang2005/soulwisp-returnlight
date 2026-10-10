import {loadEnv,binary,run} from './lib.mjs';
import {spawnSync} from 'node:child_process';
import {postgresEnvironment,sameDatabase} from './postgres.mjs';
const [file,target]=process.argv.slice(2);if(!file||!target)throw new Error('Usage: npm run restore -- backup.dump postgres://user:password@host:port/EMPTY_DATABASE. Restore only into a newly created empty database.');
const source=loadEnv();if(sameDatabase(target,source.DATABASE_URL))throw new Error('Choose an empty target database; active game database is protected.');
const env=postgresEnvironment(target,source);const check=spawnSync(binary('psql'),['-tAc',"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S')"],{encoding:'utf8',env});
if(check.status!==0||check.stdout.trim()!=='0')throw new Error('Restore requires a reachable empty target database.');
run(binary('pg_restore'),['--exit-on-error','--single-transaction','--no-owner','--dbname',env.PGDATABASE,file],{env});console.log('Restore completed. Verify account/inventory/settlement counts before switching DATABASE_URL.');
