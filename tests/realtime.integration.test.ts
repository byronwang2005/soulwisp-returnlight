import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import type { GameView } from '@wangxu/shared';
import 'dotenv/config';
let server:ChildProcess;let logs='';const base='http://127.0.0.1:3011';const origin=process.env.AUTH_BASE_URL||'http://localhost:5180';const connections:Room[]=[],accountIds:string[]=[];
async function waitUntil(check:()=>boolean|Promise<boolean>,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw new Error(`Timed out; ${logs.slice(-1500)}`);}
beforeAll(async()=>{server=spawn(process.execPath,['--import','tsx','apps/server/src/index.ts'],{env:{...process.env,NODE_ENV:'test',GAME_TIME_SCALE:'60',API_PORT:'3011',GAME_PORT:'2571'},stdio:['ignore','pipe','pipe']});server.stdout?.on('data',b=>{logs+=b;});server.stderr?.on('data',b=>{logs+=b;});await waitUntil(async()=>{try{return (await fetch(`${base}/api/health`)).ok;}catch{return false;}},20000);},25000);
afterAll(async()=>{await Promise.all(connections.map(room=>Promise.race([room.leave().catch(()=>{}),new Promise(r=>setTimeout(r,500))])));server?.kill('SIGTERM');await new Promise(r=>setTimeout(r,500));const database=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await database.query('DELETE FROM matches WHERE id IN (SELECT match_id FROM match_rewards WHERE user_id=ANY($1::text[]))',[accountIds]);await database.query('DELETE FROM auth_user WHERE id=ANY($1::text[])',[accountIds]);}finally{await database.end();}});
async function player(n:number){const r=await fetch(`${base}/api/auth/sign-up/email`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:`network-${Date.now()}-${crypto.randomUUID()}@example.test`,password:'LocalTest-Thread-32!',name:`试玩者${n}`})});expect(r.ok,await r.clone().text()).toBe(true);const registered=await r.json();accountIds.push(registered.user.id);const cookie=r.headers.get('set-cookie')!.split(';')[0]!;const ticket=await fetch(`${base}/api/game-ticket`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin},body:'{}'}).then(r=>r.json());return {cookie,...ticket};}
describe('真实 Colyseus / Hono / PostgreSQL 连接',()=>{
 for(let count=4;count<=10;count++)it(`${count}人独立账户完整阶段、私密载荷与幂等奖励`,async()=>{
  const accounts=await Promise.all(Array.from({length:count},(_,i)=>player(i)));const client=new Client('ws://127.0.0.1:2571');const views=new Map<number,GameView>();
  const first=await client.create('expedition',{capacity:count,ticket:accounts[0]!.ticket});connections.push(first);first.onMessage('view',(v:GameView)=>views.set(0,v));first.onMessage('error',()=>{});await waitUntil(()=>views.has(0));
  const invite=views.get(0)!.invite;const local=[first];for(let i=1;i<count;i++){const room=await client.joinOrCreate('expedition',{invite,capacity:count,ticket:accounts[i]!.ticket});connections.push(room);local.push(room);room.onMessage('view',(v:GameView)=>views.set(i,v));room.onMessage('error',()=>{});}
  await waitUntil(()=>views.size===count&&views.get(0)?.players.length===count);expect(new Set(local.map(r=>r.roomId)).size).toBe(1);
  for(const room of local)room.send('command',{type:'ready',ready:true});await waitUntil(()=>views.get(0)?.phase==='EXPLORE');
  let wolves=0;for(let i=0;i<count;i++){const v=views.get(i)!;if(v.self.faction==='wolf')wolves++;expect(v.players.every(p=>!('faction'in p))).toBe(true);expect(v.players.find(p=>p.id===v.self.id)?.x).not.toBeNull();}
  expect(wolves).toBe(views.get(0)!.config.wolves);
  await waitUntil(()=>views.get(0)?.phase==='RESULT'&&!!views.get(0)?.result,35000);
  expect(views.get(0)!.result!.winner).toBe('wolf');const ids=new Set(views.get(0)!.players.map(p=>p.id));expect(Object.keys(views.get(0)!.result!.factions).every(id=>ids.has(id))).toBe(true);
  for(const account of accounts){await waitUntil(async()=>{const camp=await fetch(`${base}/api/camp`,{headers:{Cookie:account.cookie}}).then(r=>r.json());return camp.matches===1;});const one=await fetch(`${base}/api/camp`,{headers:{Cookie:account.cookie}}).then(r=>r.json());const two=await fetch(`${base}/api/camp`,{headers:{Cookie:account.cookie}}).then(r=>r.json());expect(two.fragments).toBe(one.fragments);expect(two.matches).toBe(1);}
  for(const room of local){await room.leave();const i=connections.indexOf(room);if(i>=0)connections.splice(i,1);}
 },50000);
 it('未知邀请码不能创建新房，未登录不能拿房间凭证',async()=>{const unauth=await fetch(`${base}/api/game-ticket`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});expect(unauth.status).toBe(401);const a=await player(99);await expect(new Client('ws://127.0.0.1:2571').joinOrCreate('expedition',{ticket:a.ticket,invite:'INVALID'})).rejects.toThrow();});
});
