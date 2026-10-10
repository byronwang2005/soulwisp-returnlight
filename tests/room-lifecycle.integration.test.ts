import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameView } from '@wangxu/shared';

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
async function lobby() {
  const host = await account();
  const room = observe(await client.create('expedition', { capacity: 4, ticket: host.ticket }));
  await until(() => views.has(room));
  return { host, room, invite: views.get(room)!.invite };
}
async function join(invite: string, ticket: string) { return observe(await client.joinOrCreate('expedition', { invite, capacity: 4, ticket })); }

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

  it('does not let a rejected simultaneous join disconnect or remove the accepted seat', async () => {
    const { room, invite } = await lobby();
    const visitor = await account();
    const attempts = await Promise.allSettled([join(invite, visitor.ticket), join(invite, visitor.ticket)]);
    const accepted = attempts.filter(result => result.status === 'fulfilled');
    expect(accepted).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const joined = (accepted[0] as PromiseFulfilledResult<Room>).value;
    await until(() => views.get(room)?.players.length === 2 && views.get(room)?.players.find(player => player.id === visitor.userId)?.connected === true);
    await expect(client.create('expedition', { capacity: 4, ticket: visitor.ticket })).rejects.toThrow('此账户已有远征席位');
    expect(views.get(room)!.players.filter(player => player.id === visitor.userId)).toHaveLength(1);
    await leave(joined); await leave(room);
  });

  it('holds the account lock during a dropped connection and restores the original session', async () => {
    const { room, invite } = await lobby(); const visitor = await account();
    const joined = await join(invite, visitor.ticket);
    await until(() => views.get(room)?.players.length === 2);
    const token = joined.reconnectionToken;
    const sessionId = joined.sessionId;
    joined.reconnection.enabled = false;
    joined.connection.close(4010, 'integration network drop');
    connections.delete(joined);
    await until(() => views.get(room)?.players.find(player => player.id === visitor.userId)?.connected === false);
    await expect(client.create('expedition', { capacity: 4, ticket: visitor.ticket })).rejects.toThrow('此账户已有远征席位');
    const recovered = observe(await client.reconnect(token));
    expect(recovered.sessionId).toBe(sessionId);
    await until(() => views.get(room)?.players.find(player => player.id === visitor.userId)?.connected === true);
    expect(views.get(room)!.players.filter(player => player.id === visitor.userId)).toHaveLength(1);
    await leave(recovered); await leave(room);
  });

  it('releases a lobby seat after a voluntary departure', async () => {
    const { room, host } = await lobby();
    await leave(room);
    const next = observe(await client.create('expedition', { capacity: 4, ticket: host.ticket }));
    await until(() => views.has(next));
    expect(views.get(next)!.self.id).toBe(host.userId);
    await leave(next);
  });

  it('keeps an active departed account out of a second expedition until the old room is disposed', async () => {
    const { room, host, invite } = await lobby(); const group = [room];
    for (let index = 0; index < 3; index++) { const member = await account(); group.push(await join(invite, member.ticket)); }
    await until(() => views.get(room)?.players.length === 4);
    for (const connection of group) connection.send('command', { type: 'ready', ready: true });
    await until(() => views.get(room)?.phase === 'EXPLORE');
    await leave(room);
    await expect(client.create('expedition', { capacity: 4, ticket: host.ticket })).rejects.toThrow('此账户已有远征席位');
    expect(views.get(group[1]!)?.result).toBeNull();
    for (const connection of group.slice(1)) await leave(connection);
    await new Promise(resolve => setTimeout(resolve, 150));
    const next = observe(await client.create('expedition', { capacity: 4, ticket: host.ticket }));
    await until(() => views.has(next));
    expect(views.get(next)!.self.id).toBe(host.userId);
    await leave(next);
  }, 15_000);

  it('reopens a completed expedition with a real empty seat after one participant leaves', async () => {
    const { room, host, invite } = await lobby(); const group = [room];
    for (let index = 0; index < 3; index++) { const member = await account(); group.push(await join(invite, member.ticket)); }
    await until(() => views.get(room)?.players.length === 4);
    for (const connection of group) connection.send('command', { type: 'ready', ready: true });
    await until(() => views.get(room)?.phase === 'RESULT' && !!views.get(room)?.result, 35_000);
    await until(async () => (await fetch(`${base}/api/camp`, { headers: { Cookie: host.cookie } }).then(response => response.json())).matches === 1);
    await leave(group[3]!);
    room.send('command', { type: 'restart' });
    await until(() => views.get(room)?.phase === 'LOBBY' && views.get(room)?.players.length === 3);
    expect(views.get(room)!.players.every(player => player.connected)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    const newcomer = await account(); const joined = await join(invite, newcomer.ticket);
    await until(() => views.get(room)?.players.length === 4);
    expect(views.get(room)!.players.some(player => player.id === newcomer.userId)).toBe(true);
    await leave(joined);
    for (const connection of group.slice(0, 3)) await leave(connection);
  }, 45_000);
});
