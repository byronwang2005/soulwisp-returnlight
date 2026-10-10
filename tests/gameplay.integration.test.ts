import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import type { CampData, GameCommand, GameView, MapNode, PlayerView, WorldObject } from '@wangxu/shared';

const base='http://127.0.0.1:3013',socket='ws://127.0.0.1:2573',scale=8;
const origin=process.env.AUTH_BASE_URL??'http://localhost:5173';
const database=new pg.Pool({connectionString:process.env.DATABASE_URL});
const connected:Room[]=[],accountIds:string[]=[],matchIds=new Set<string>();
let server:ChildProcess,logs='';
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean|Promise<boolean>,timeout=15_000,label='condition'){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await sleep(40);}
  throw new Error(`Timed out waiting for ${label}; ${logs.slice(-1500)}`);
}
beforeAll(async()=>{
  server=spawn(process.execPath,['--import','tsx','apps/server/src/index.ts'],{env:{...process.env,NODE_ENV:'test',GAME_TIME_SCALE:String(scale),API_PORT:'3013',GAME_PORT:'2573',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:''},stdio:['ignore','pipe','pipe']});
  server.stdout?.on('data',chunk=>{logs+=chunk;});server.stderr?.on('data',chunk=>{logs+=chunk;});
  await until(async()=>{try{return (await fetch(`${base}/api/health`)).ok;}catch{return false;}},20_000,'isolated gameplay server');
},25_000);
afterAll(async()=>{
  await Promise.all(connected.map(room=>Promise.race([room.leave().catch(()=>{}),sleep(500)])));
  server?.kill('SIGTERM');await sleep(400);
  if(matchIds.size)await database.query('DELETE FROM matches WHERE id=ANY($1::text[])',[Array.from(matchIds)]);
  if(accountIds.length)await database.query('DELETE FROM auth_user WHERE id=ANY($1::text[])',[accountIds]);
  await database.end();
});
interface Account{userId:string;ticket:string;cookie:string;}
interface Peer{account:Account;room:Room;view:GameView|null;seq:number;errors:string[];committed:string|null;}
async function account(index:number):Promise<Account>{
  const response=await fetch(`${base}/api/auth/sign-up/email`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:`gameplay-${crypto.randomUUID()}@example.test`,password:'Local-Gameplay-Thread-24!',name:`归灯同行${index}`})});
  expect(response.ok,await response.clone().text()).toBe(true);const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
  const ticketResponse=await fetch(`${base}/api/game-ticket`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:'{}'});
  expect(ticketResponse.ok).toBe(true);const ticket=await ticketResponse.json() as {ticket:string;userId:string};accountIds.push(ticket.userId);return {...ticket,cookie};
}
async function expedition(count:number){
  const accounts=await Promise.all(Array.from({length:count},(_,i)=>account(i))),client=new Client(socket),peers:Peer[]=[];
  for(let i=0;i<count;i++){
    const room=i===0?await client.create('expedition',{capacity:count,ticket:accounts[i]!.ticket}):await client.joinOrCreate('expedition',{capacity:count,invite:peers[0]!.view!.invite,ticket:accounts[i]!.ticket});
    connected.push(room);const peer:Peer={account:accounts[i]!,room,view:null,seq:0,errors:[],committed:null};peers.push(peer);
    room.onMessage('view',(view:GameView)=>{peer.view=view;});room.onMessage('error',(error:{message:string})=>{peer.errors.push(error.message);});
    room.onMessage('settlementCommitted',(message:{matchId:string})=>{peer.committed=message.matchId;matchIds.add(message.matchId);});
    await until(()=>!!peer.view,10_000,'initial private view');
  }
  await until(()=>peers.every(peer=>peer.view?.players.length===count),10_000,'all seats');
  peers.forEach(peer=>send(peer,{type:'ready',ready:true}));await phase(peers[0]!,'EXPLORE',1);
  expect(peers.filter(peer=>peer.view?.self.faction==='wolf')).toHaveLength(peers[0]!.view!.config.wolves);
  return peers;
}
function send(peer:Peer,command:GameCommand){peer.room.send('command',command);}
function self(peer:Peer):PlayerView{const player=peer.view!.players.find(p=>p.id===peer.account.userId)!;if(player.x===null||player.y===null)throw new Error('Own living coordinates missing');return player;}
async function phase(peer:Peer,target:GameView['phase'],chapter?:number){
  await until(()=>peer.view?.phase===target&&(chapter===undefined||peer.view.chapter===chapter),120_000,`${target} chapter ${chapter??'*'}`);
}
function distances(a:{x:number;y:number},b:{x:number;y:number}){return Math.hypot(a.x-b.x,a.y-b.y);}
function edges(nodes:MapNode[]):[string,string][]{
  const result:[string,string][]=[];for(let i=1;i<nodes.length;i++)result.push([nodes[i]!.id,nodes[i===nodes.length-1?1:i+1]!.id]);
  result.push([nodes[0]!.id,nodes[1]!.id],[nodes[0]!.id,nodes[1+Math.floor((nodes.length-1)/2)]!.id]);return result;
}
function path(peer:Peer,target:{x:number;y:number}){
  const nodes=peer.view!.nodes,nearest=(point:{x:number;y:number})=>nodes.reduce((a,b)=>distances(a,point)<distances(b,point)?a:b),start=nearest(self(peer) as {x:number;y:number}),goal=nearest(target);
  const previous=new Map<string,string>(),seen=new Set([start.id]),queue=[start.id];
  while(queue.length&&!seen.has(goal.id)){const current=queue.shift()!;for(const [a,b]of edges(nodes)){const next=a===current?b:b===current?a:null;if(next&&!seen.has(next)){seen.add(next);previous.set(next,current);queue.push(next);}}}
  const ids=[goal.id];while(ids[0]!==start.id)ids.unshift(previous.get(ids[0]!)!);return [...ids.map(id=>nodes.find(n=>n.id===id)!),target];
}
function movingPhase(peer:Peer){return peer.view!.phase==='EXPLORE'||peer.view!.phase==='EXTRACT';}
async function navigate(peers:Peer[],target:{x:number;y:number}){
  const leader=peers[0]!,deadline=Date.now()+40_000;
  for(let replan=0;replan<3;replan++){
    await until(()=>movingPhase(leader),40_000,'next playable phase');let interrupted=false;
    for(const point of path(leader,target)){
      while(true){
        if(Date.now()>deadline)throw new Error(`Navigation stuck to ${JSON.stringify(target)}: ${JSON.stringify(self(leader))}`);
        if(!movingPhase(leader)){interrupted=true;break;}
        if(peers.every(peer=>distances(self(peer) as {x:number;y:number},point)<8))break;
        for(const peer of peers){const body=self(peer);expect(body.sealed||body.down).toBe(false);const dx=point.x-body.x!,dy=point.y-body.y!,length=Math.hypot(dx,dy),gain=Math.min(1,length/180);
          send(peer,{type:'move',x:length<8?0:dx/length*gain,y:length<8?0:dy/length*gain,seq:++peer.seq});}
        await sleep(50);
      }
      if(interrupted)break;
    }
    peers.forEach(peer=>send(peer,{type:'move',x:0,y:0,seq:++peer.seq}));await sleep(120);
    if(!interrupted)return;
  }
  throw new Error('Too many council interruptions in one navigation');
}
async function interaction(peer:Peer,target:WorldObject,completed:()=>boolean){
  await navigate([peer],target);
  let deadline=Date.now()+6_000;
  while(Date.now()<deadline&&!completed()){
    if(!movingPhase(peer)){await until(()=>movingPhase(peer),40_000,'interaction council return');await navigate([peer],target);deadline=Date.now()+6_000;}
    if(!peer.view!.self.interaction)send(peer,{type:'interact',targetId:target.id});
    await sleep(80);
  }
  expect(completed(),`Interaction ${target.id}: ${JSON.stringify(peer.view?.self)}; errors ${peer.errors.slice(-3)}`).toBe(true);
}
async function findObject(peer:Peer,id:string):Promise<WorldObject>{
  for(const node of peer.view!.nodes){let object=peer.view!.objects.find(o=>o.id===id);if(object)return object;await navigate([peer],node);object=peer.view!.objects.find(o=>o.id===id);if(object)return object;}
  throw new Error(`Visible search did not find ${id}`);
}
async function defeatGuardian(humans:Peer[]){
  const leader=humans[0]!,exit=leader.view!.objects.find(o=>o.id==='exit')!;await navigate(humans,{x:exit.x,y:exit.y-5});
  const guardian=leader.view!.objects.find(o=>o.id==='guardian');expect(guardian).toBeDefined();const deadline=Date.now()+6000;
  while(!leader.view!.eliteDefeated&&Date.now()<deadline){
    for(const peer of humans){const body=self(peer);if(!body.down)send(peer,{type:'attack',targetId:'guardian'});}
    await sleep(100);
  }
  expect(leader.view!.eliteDefeated).toBe(true);expect(humans.every(peer=>!self(peer).down)).toBe(true);
}
async function engineering(carrier:Peer){
  for(const beacon of carrier.view!.objects.filter(o=>o.kind==='beacon')){
    if(beacon.progress<1)await interaction(carrier,beacon,()=>carrier.view!.objects.find(o=>o.id===beacon.id)?.progress===1);
  }
  expect(carrier.view!.beaconsLit).toBe(carrier.view!.config.beacons);
  const core=await findObject(carrier,'core');await interaction(carrier,core,()=>self(carrier).carryingCore);
  const purify=carrier.view!.objects.find(o=>o.id==='purify')!;await interaction(carrier,purify,()=>carrier.view!.corePurified);
}
async function escortAndVerify(peers:Peer[],carrier:Peer){
  await phase(carrier,'EXTRACT');const exit=carrier.view!.objects.find(o=>o.id==='exit')!;await navigate([carrier],exit);
  await until(()=>peers.every(peer=>peer.view?.result?.winner==='human'),30_000,'human final settlement');
  expect(carrier.view!.holdProgress).toBeCloseTo(8);expect(carrier.view!.result!.reason).toContain('护送');
  await until(()=>peers.every(peer=>!!peer.committed),15_000,'PostgreSQL commit acknowledgement');
  const committed=peers[0]!.committed!;expect(peers.every(peer=>peer.committed===committed)).toBe(true);
  const persisted=await database.query('SELECT winner,reason FROM matches WHERE id=$1',[committed]);expect(persisted.rows).toHaveLength(1);expect(persisted.rows[0].winner).toBe('human');
  const rewards=await database.query('SELECT user_id,fragments,secrets,won FROM match_rewards WHERE match_id=$1',[committed]);expect(rewards.rows).toHaveLength(peers.length);
  for(const peer of peers){
    const result=peer.view!.result!,reward=result.rewards[peer.account.userId]!,row=rewards.rows.find(r=>r.user_id===peer.account.userId);
    expect(row.fragments).toBe(reward.fragments);expect(row.secrets).toBe(reward.secrets);expect(row.won).toBe(peer.view!.self.faction==='human');
    const camp=await fetch(`${base}/api/camp`,{headers:{Cookie:peer.account.cookie}}).then(r=>r.json()) as CampData;
    expect(camp.matches).toBe(1);expect(camp.fragments).toBe(reward.fragments);expect(camp.secrets).toBe(reward.secrets);expect(camp.wins).toBe(peer.view!.self.faction==='human'?1:0);
  }
  const before=await database.query('SELECT sum(fragments)::integer AS fragments FROM match_rewards WHERE match_id=$1',[committed]);await sleep(300);
  expect((await database.query('SELECT sum(fragments)::integer AS fragments FROM match_rewards WHERE match_id=$1',[committed])).rows).toEqual(before.rows);
}

describe('live SDK intents, authoritative objectives and PostgreSQL rewards',()=>{
  it.concurrent('four players recover from a mistaken seal and complete the entire common expedition',async()=>{
    const peers=await expedition(4),humans=peers.filter(peer=>peer.view!.self.faction==='human'),mistaken=humans.pop()!;
    await phase(peers[0]!,'VOTE',2);peers.forEach(peer=>send(peer,{type:'vote',targetId:mistaken.account.userId}));
    await phase(peers[0]!,'EXPLORE',3);expect(mistaken.view!.players.find(p=>p.id===mistaken.account.userId)?.sealed).toBe(true);expect(mistaken.view!.players.every(p=>p.x===null)).toBe(true);
    await defeatGuardian(humans);await engineering(humans[0]!);await escortAndVerify(peers,humans[0]!);
  },200_000);
  it.concurrent('ten players complete physical objectives with no wolf contribution or profession requirement',async()=>{
    const peers=await expedition(10),humans=peers.filter(peer=>peer.view!.self.faction==='human'),carrier=humans[0]!;
    await phase(carrier,'EXPLORE',3);await engineering(carrier);await phase(carrier,'EXPLORE',4);await defeatGuardian(humans);await escortAndVerify(peers,carrier);
  },250_000);
});
