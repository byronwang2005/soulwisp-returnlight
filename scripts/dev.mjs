import {root,local,fs,path,spawn,run,binary,loadEnv,waitFor} from './lib.mjs';
const production=process.argv.includes('--production');const env=loadEnv();if(production)env.NODE_ENV='production';const children=[];const webPort=env.WEB_PORT||'5180';const apiPort=env.API_PORT||'3000';
run(process.execPath,['scripts/setup.mjs']);
function start(bin,args,label){const child=spawn(bin,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});children.push(child);for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>process.stdout.write(`[${label}] ${b}`));child.on('exit',code=>{if(code&& !closing){console.error(`${label} exited ${code}`);stop();process.exitCode=code;}});return child;}
let closing=false;function stop(){if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM');}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop();setTimeout(()=>process.exit(0),500).unref();});
try{start(binary('livekit-server'),['--config',path.join(local,'livekit.yaml')],'voice');}catch{console.log('LiveKit binary missing: text is available; run node scripts/install-services.mjs for local voice.');}
start(process.execPath,['--import','tsx',production?'apps/server/src/index.ts':'node_modules/tsx/dist/cli.mjs',...(!production?['watch','apps/server/src/index.ts']:[])],'server');
const web=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),...(production?['preview']:[]),'--host','0.0.0.0','--port',webPort,'--strictPort'],{cwd:path.join(root,'apps/web'),env,stdio:'inherit'});children.push(web);web.on('exit',code=>{if(code&&!closing){stop();process.exitCode=code;}});
try{await waitFor(`http://127.0.0.1:${apiPort}/api/health`);await waitFor(`http://127.0.0.1:${webPort}`);console.log(`\n《亡絮：归灯》 http://localhost:${webPort} · API :${apiPort} · 房间 :${env.GAME_PORT||2567} · Ctrl+C 停止应用\n`);}catch(e){console.error(e.message);stop();process.exitCode=1;}
