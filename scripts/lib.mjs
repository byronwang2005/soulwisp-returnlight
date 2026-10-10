import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
export const root=path.resolve(import.meta.dirname,'..');
export const local=path.join(root,'.local');
export function loadEnv(){const result={...process.env};if(fs.existsSync(path.join(root,'.env')))for(const line of fs.readFileSync(path.join(root,'.env'),'utf8').split('\n')){const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])result[m[1]]=m[2];}return result;}
export function run(bin,args,options={}){const result=spawnSync(bin,args,{cwd:root,stdio:'inherit',env:loadEnv(),...options});if(result.status!==0)throw new Error(`${bin} exited ${result.status}: ${result.error?.message||''}`);}
export function binary(name){const own=path.join(local,'bin',name);if(fs.existsSync(own))return own;for(const dir of (process.env.PATH||'').split(path.delimiter)){const p=path.join(dir,name);if(fs.existsSync(p))return p;}throw new Error(`Missing ${name}. See docs/local-development.md.`);}
export async function waitFor(url,timeout=20000){const until=Date.now()+timeout;while(Date.now()<until){try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`Not ready: ${url}`);}
export {fs,path,spawn};
