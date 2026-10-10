import {createHash} from 'node:crypto';
import {root,local,fs,path,run,loadEnv} from './lib.mjs';

const directory=path.join(local,'releases');fs.mkdirSync(directory,{recursive:true});
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const archive=path.join(directory,`soulwisp-returnlight-${version}.tar.gz`);
const entries=['README.md','CONTRIBUTING.md','AGENTS.md','.githooks','.github','package.json','package-lock.json','tsconfig.json','vitest.config.ts','playwright.config.ts','.node-version','.env.example','.gitignore','.dockerignore','apps','packages','scripts','tests','docs','design','research','deploy'];
run('tar',['--exclude=node_modules','--exclude=dist','--exclude=test-output','--exclude=._*','--exclude=.DS_Store','--exclude=deploy/.env','--exclude=deploy/caddy.json','--exclude=deploy/livekit.yaml','--exclude=deploy/backups','--exclude=deploy/verification','-czf',archive,...entries],{env:{...loadEnv(),COPYFILE_DISABLE:'1'}});
const checksum=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(`${archive}.sha256`,`${checksum}  ${path.basename(archive)}\n`);
console.log(`Source, assets, migrations, tools and validation: ${archive}`);
console.log('Private credentials, runtime databases and backups are excluded. Export your database separately with npm run backup.');
