import 'dotenv/config';
import {startLiveMatch,waitForIdle} from './live-lobby';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameView, LobbyView } from '@wangxu/shared';

const base = 'http://127.0.0.1:3022';
const client = new Client('ws://127.0.0.1:2582');
const origin = process.env.AUTH_BASE_URL ?? 'http://localhost:5173';
const accounts: { userId: string; ticket: string; cookie: string }[] = [];
const connections = new Set<Room>();
const views = new Map<Room, GameView>();
let server: ChildProcess;
let logs = '';
async function until(check: () => boolean | Promise<boolean>, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Lifecycle condition timed out: ${logs.slice(-1500)}`);
}
async function account() {
  const response = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: `lifecycle-${randomUUID()}@example.test`, name: '席位生命周期', password: `Test-${randomUUID()}` }) });
  expect(response.ok, await response.clone().text()).toBe(true);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const ticketResponse = await fetch(`${base}/api/game-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: '{}' });
  const value = { ...(await ticketResponse.json() as { userId: string; ticket: string }), cookie };
  accounts.push(value); return value;
}
function observe(room: Room) {
  connections.add(room);
  room.onMessage('view', (view: GameView) => views.set(room, view));
  room.onMessage('error', () => {});
  room.onMessage('settlementCommitted', () => {});
  return room;
}
async function leave(room: Room) { await room.leave(); connections.delete(room); }
const lobbyViews=new Map<Room,LobbyView>();
async function joinWaiting(account:{cookie:string}){
  const response=await fetch(`${base}/api/lobby/join`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:account.cookie},body:'{}'});
  expect(response.ok,await response.clone().text()).toBe(true);
  const room=await client.consumeSeatReservation(await response.json());return observeWaiting(room);
}
function observeWaiting(room:Room){connections.add(room);room.onMessage('lobbyView',(view:LobbyView)=>lobbyViews.set(room,view));room.onMessage('returned',()=>{});room.onMessage('settlementCommitted',()=>{});room.onMessage('error',()=>{});return room;}

describe('real room lifecycle and account seat ownership', () => {
  beforeAll(async () => {
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], { env: { ...process.env, NODE_ENV: 'test', GAME_TIME_SCALE: '60', API_PORT: '3022', GAME_PORT: '2582' }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout?.on('data', data => { logs += data; }); server.stderr?.on('data', data => { logs += data; });
    await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } }, 20_000);
  }, 25_000);
  afterAll(async () => {
    for (const room of connections) await Promise.race([room.leave().catch(() => {}), new Promise(resolve => setTimeout(resolve, 500))]);
    if (server?.exitCode === null) {
      const exited = new Promise<void>(resolve => server.once('exit', () => resolve()));
      server.kill('SIGTERM');
      await Promise.race([exited, new Promise<void>(resolve => setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); resolve(); }, 5000))]);
    }
    const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const ids = accounts.map(value => value.userId);
      await database.query('DELETE FROM matches WHERE id IN (SELECT match_id FROM match_rewards WHERE user_id=ANY($1::text[]))', [ids]);
      await database.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [ids]);
    } finally { await database.end(); }
  }, 15_000);

  it('rejects duplicate waiting control without removing the accepted member',async()=>{
    const member=await account();const attempts=await Promise.allSettled([joinWaiting(member),joinWaiting(member)]);
    const accepted=attempts.filter(result=>result.status==='fulfilled');expect(accepted).toHaveLength(1);expect(attempts.filter(result=>result.status==='rejected')).toHaveLength(1);
    const room=(accepted[0] as PromiseFulfilledResult<Room>).value;await until(()=>lobbyViews.get(room)?.members.length===1);
    await expect(client.create('expedition',{capacity:4,ticket:member.ticket})).rejects.toThrow('等待区');expect(lobbyViews.get(room)!.members[0]!.id).toBe(member.userId);await leave(room);
  });
  it('clears waiting readiness on drop and reconnects at the tail',async()=>{
    const first=await account(),second=await account(),a=await joinWaiting(first),b=await joinWaiting(second);a.send('lobbyCommand',{type:'ready',ready:true});await until(()=>lobbyViews.get(b)?.members.find(m=>m.id===first.userId)?.ready===true);
    const token=a.reconnectionToken;a.reconnection.enabled=false;a.connection.close(4010,'integration network drop');connections.delete(a);
    await until(()=>lobbyViews.get(b)?.members.length===1);const restored=observeWaiting(await client.reconnect(token));await until(()=>lobbyViews.get(restored)?.members.length===2);
    expect(lobbyViews.get(restored)!.members.at(-1)).toMatchObject({id:first.userId,ready:false});await leave(restored);await leave(b);
  });
  it('releases a waiting membership after voluntary departure',async()=>{
    const member=await account(),room=await joinWaiting(member);await leave(room);const next=await joinWaiting(member);await until(()=>lobbyViews.get(next)?.members.length===1);expect(lobbyViews.get(next)!.members[0]!.ready).toBe(false);await leave(next);
  });
  it('restores the original game seat and returns everyone through the common waiting queue',async()=>{
    const members=await Promise.all(Array.from({length:4},()=>account()));
    const match=await startLiveMatch(members,client,base,origin,room=>{observe(room);room.onMessage('returnToLobby',()=>{});});match.waiting.forEach(observeWaiting);
    await until(()=>match.games.every(room=>views.get(room)?.phase==='EXPLORE'),15000);
    const original=match.games[0]!,token=original.reconnectionToken,sessionId=original.sessionId;original.reconnection.enabled=false;original.connection.close(4010,'integration network drop');connections.delete(original);
    await until(()=>views.get(match.games[1]!)?.players.find(p=>p.id===members[0]!.userId)?.connected===false);
    await expect(client.joinById(original.roomId,{ticket:members[0]!.ticket})).rejects.toThrow();
    const restored=observe(await client.reconnect(token));restored.onMessage('returnToLobby',()=>{});expect(restored.sessionId).toBe(sessionId);
    const extra=await account(),extraWaiting=await joinWaiting(extra);
    await until(()=>!!views.get(restored)?.result,35000);match.waiting[0]!.send('returnEarly',{});
    await until(()=>lobbyViews.get(match.waiting[0]!)?.selfArea==='waiting');expect(lobbyViews.get(match.waiting[0]!)!.members.map(m=>m.id)).toEqual([extra.userId,members[0]!.userId]);
    await waitForIdle(base);await until(()=>lobbyViews.get(extraWaiting)?.members.length===5);
    expect(lobbyViews.get(extraWaiting)!.members.map(m=>m.id)).toEqual([extra.userId,...members.map(m=>m.userId)]);expect(lobbyViews.get(extraWaiting)!.members.every(m=>!m.ready)).toBe(true);
    await leave(restored);for(const room of match.games.slice(1))await leave(room);for(const room of match.waiting)await leave(room);await leave(extraWaiting);
  },65000);
});
