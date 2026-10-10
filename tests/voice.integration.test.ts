import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, request as forwardRequest, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';
import type { Room } from 'livekit-client';
import { VoiceService, type VoiceState } from '../apps/server/src/voice.js';

type BrowserWindow = Window & { LivekitClient: typeof import('livekit-client'); councilRoom?: Room };
const apiKey = process.env.LIVEKIT_API_KEY!, apiSecret = process.env.LIVEKIT_API_SECRET!;
const serverUrl = process.env.LIVEKIT_URL ?? 'http://127.0.0.1:7880';
const publicUrl = process.env.LIVEKIT_PUBLIC_URL ?? 'ws://127.0.0.1:7880';
const client = new RoomServiceClient(serverUrl, apiKey, apiSecret, { requestTimeout: 2, failover: false });
const service = new VoiceService({ apiKey, apiSecret, serverUrl, publicUrl });
const roomId = `voice-test-${randomUUID()}`;
let browser: Browser, pageServer: Server, startedServer: ChildProcess | undefined;
let pages: Page[] = [], localUrl: string;
const state: VoiceState = { phase: 'DISCUSS', chapter: 1, speakerId: 'speaker-a', open: false, players: [
  { id: 'speaker-a', name: '第一位灯卫', sealed: false }, { id: 'speaker-b', name: '第二位斥候', sealed: false }, { id: 'ghost', name: '回响', sealed: true },
] };
async function eventually<T>(read: () => Promise<T>, condition: (value: T) => boolean, timeout = 5000): Promise<T> {
  const until = Date.now() + timeout;
  let last: T;
  do { last = await read(); if (condition(last)) return last; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < until);
  throw new Error(`Condition was not satisfied: ${JSON.stringify(last!)}`);
}
async function connect(token: { token: string; url: string }, page = pages[0]!) {
  await page.evaluate(async ({ token, url }) => {
    const scope = window as unknown as BrowserWindow;
    scope.councilRoom = new scope.LivekitClient.Room();
    scope.councilRoom.on(scope.LivekitClient.RoomEvent.TrackSubscribed, track => {
      if (track.kind === 'audio') document.body.append(track.attach());
    });
    await scope.councilRoom.connect(url, token, { autoSubscribe: true });
  }, token);
}

describe('real self-hosted LiveKit council permissions', () => {
  beforeAll(async () => {
    try { await client.listRooms(); } catch {
      const binary = path.resolve('.local/bin/livekit-server');
      if (!existsSync(binary)) throw new Error('LiveKit binary missing: run the local service installer first.');
      startedServer = spawn(binary, ['--config', path.resolve('.local/livekit.yaml')], { stdio: 'ignore' });
      await eventually(async () => { try { await client.listRooms(); return true; } catch { return false; } }, Boolean, 15_000);
    }
    pageServer = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>LiveKit integration</title>'); });
    await new Promise<void>(resolve => pageServer.listen(0, '127.0.0.1', resolve));
    const address = pageServer.address();
    if (!address || typeof address === 'string') throw new Error('No test HTTP address');
    localUrl = `http://127.0.0.1:${address.port}`;
    const channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
    browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    for (let index = 0; index < 3; index++) {
      const context = await browser.newContext({ permissions: ['microphone'] });
      const page = await context.newPage();
      await page.goto(localUrl);
      await page.addScriptTag({ path: path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
      pages.push(page);
    }
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
    await service.dispose();
    await new Promise<void>(resolve => pageServer ? pageServer.close(() => resolve()) : resolve());
    startedServer?.kill('SIGTERM');
  });

  it('creates a council, admits three independent clients muted, and grants only the current speaker', async () => {
    expect(await service.syncRoom(roomId, state)).toBe(true);
    const tokens = await Promise.all(state.players.map(player => service.issueToken(roomId, player.id)));
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(tokens[0]!.token);
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canPublishData).toBe(false);
    await Promise.all(tokens.map((token, index) => connect(token, pages[index]!)));
    const rooms = await client.listRooms();
    const council = rooms.find(room => JSON.parse(room.metadata || '{}').gameRoomId === roomId)!;
    expect(council).toBeTruthy();
    const participants = await eventually(() => client.listParticipants(council.name), participants => participants.length === 3 && participants.find(player => player.identity === 'speaker-a')?.permission?.canPublish === true);
    expect(participants.find(player => player.identity === 'speaker-b')?.permission?.canPublish).toBe(false);
    expect(participants.find(player => player.identity === 'ghost')?.permission?.canPublish).toBe(false);
    expect(participants.find(player => player.identity === 'ghost')?.permission?.canSubscribe).toBe(true);
    await pages[0]!.evaluate(async () => { await (window as unknown as BrowserWindow).councilRoom!.localParticipant.setMicrophoneEnabled(true); });
    const published = await eventually(() => client.listParticipants(council.name), participants => (participants.find(player => player.identity === 'speaker-a')?.tracks.length ?? 0) === 1);
    expect(published.find(player => player.identity === 'speaker-a')?.tracks[0]?.source).toBe(2); // MICROPHONE
  }, 20_000);

  it('updates SFU permissions when the speaking turn changes and never grants a ghost a microphone', async () => {
    expect(await service.syncRoom(roomId, { ...state, speakerId: 'speaker-b' })).toBe(true);
    const room = (await client.listRooms()).find(room => JSON.parse(room.metadata || '{}').gameRoomId === roomId)!;
    const participants = await client.listParticipants(room.name);
    expect(participants.find(player => player.identity === 'speaker-a')?.permission?.canPublish).toBe(false);
    expect(participants.find(player => player.identity === 'speaker-b')?.permission?.canPublish).toBe(true);
    expect(await service.syncRoom(roomId, { ...state, open: true, speakerId: null })).toBe(true);
    const open = await client.listParticipants(room.name);
    expect(open.filter(player => player.permission?.canPublish)).toHaveLength(2);
    expect(open.find(player => player.identity === 'ghost')?.permission?.canPublish).toBe(false);
  });

  it('deletes an old epoch, rejects its token instead of auto-creating a room, and rotates the next chapter', async () => {
    const old = await service.issueToken(roomId, 'speaker-a');
    const oldRoom = (await new TokenVerifier(apiKey, apiSecret).verify(old.token)).video!.room!;
    expect(await service.closeRoom(roomId)).toBe(true);
    expect((await client.listRooms()).some(room => room.name === oldRoom)).toBe(false);
    await expect(service.issueToken(roomId, 'speaker-a')).rejects.toMatchObject({ status: 403 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(localUrl);
    await page.addScriptTag({ path: path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
    await expect(connect(old, page)).rejects.toThrow();
    expect((await client.listRooms()).some(room => room.name === oldRoom)).toBe(false);
    await context.close();
    expect(await service.syncRoom(roomId, { ...state, chapter: 2 })).toBe(true);
    const next = await service.issueToken(roomId, 'speaker-a');
    expect(next.epoch).not.toBe(old.epoch);
    expect(await service.syncRoom(roomId, { ...state, phase: 'EXPLORE' })).toBe(true);
    expect(service.snapshot(roomId).epoch).toBeNull();
    await expect(service.issueToken(roomId, 'speaker-a')).rejects.toMatchObject({ status: 403 });
  }, 20_000);

  it('retries its own failed deletion at shutdown without removing a foreign SFU room', async () => {
    let deletionUnavailable = false;
    const proxy = createServer((incoming, response) => {
      if (deletionUnavailable && incoming.url?.includes('/DeleteRoom')) { response.writeHead(503); response.end('test deletion outage'); return; }
      const upstream = forwardRequest(new URL(incoming.url ?? '/', serverUrl), { method: incoming.method, headers: incoming.headers }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers); upstreamResponse.pipe(response);
      });
      upstream.on('error', () => { response.writeHead(503); response.end('upstream unavailable'); }); incoming.pipe(upstream);
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address(); if (!address || typeof address === 'string') throw new Error('No fault proxy address');
    const own = new VoiceService({ apiKey, apiSecret, publicUrl, serverUrl: `http://127.0.0.1:${address.port}` });
    const ownId = `shutdown-${randomUUID()}`, foreign = `foreign-${randomUUID()}`;
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await client.createRoom({ name: foreign, emptyTimeout: 600, metadata: JSON.stringify({ serverInstanceId: 'another-instance' }) });
      expect(await own.syncRoom(ownId, state)).toBe(true);
      const token = await own.issueToken(ownId, 'speaker-a');
      const name = (await new TokenVerifier(apiKey, apiSecret).verify(token.token)).video!.room!;
      expect(JSON.parse((await client.listRooms([name]))[0]!.metadata).serverInstanceId).toBeTypeOf('string');
      deletionUnavailable = true;
      expect(await own.closeRoom(ownId)).toBe(false);
      expect(own.snapshot(ownId).epoch).toBeNull();
      expect((await client.listRooms()).some(room => room.name === name)).toBe(true);
      await own.dispose();
      expect(warnings.mock.calls.some(call => String(call[0]).includes('shutdown cleanup incomplete'))).toBe(true);
      deletionUnavailable = false;
      await own.dispose();
      const remaining = await client.listRooms();
      expect(remaining.some(room => room.name === name)).toBe(false);
      expect(remaining.some(room => room.name === foreign)).toBe(true);
      expect(await own.syncRoom(ownId, state)).toBe(false);
      await expect(own.issueToken(ownId, 'speaker-a')).rejects.toMatchObject({ status: 403 });
    } finally {
      deletionUnavailable = false; await own.dispose(); await client.deleteRoom(foreign).catch(() => {}); warnings.mockRestore();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
    }
  }, 20_000);

  it('delivers the current microphone to nine receivers in a ten-seat council and rotates the speaker', async () => {
    const tenId = `ten-${randomUUID()}`;
    const tenState: VoiceState = { phase: 'DISCUSS', chapter: 1, speakerId: 'ten-0', open: false,
      players: Array.from({ length: 10 }, (_, index) => ({ id: `ten-${index}`, name: `十人议会${index + 1}`, sealed: false })) };
    const contexts = [], tenPages: Page[] = [];
    async function receivers(speaker: string, excluded: number) {
      return Promise.all(tenPages.filter((_page, index) => index !== excluded).map(page => page.evaluate(async identity => {
        const room = (window as unknown as BrowserWindow).councilRoom!;
        const publication = [...(room.remoteParticipants.get(identity)?.audioTrackPublications.values() ?? [])].find(value => value.isSubscribed && value.audioTrack);
        const track = publication?.audioTrack;
        const stats = await track?.getRTCStatsReport();
        let bytes = 0, packets = 0;
        stats?.forEach(value => { if (value.type === 'inbound-rtp' && value.kind === 'audio') { bytes += value.bytesReceived ?? 0; packets += value.packetsReceived ?? 0; } });
        return { subscribed: Boolean(publication?.isSubscribed), live: track?.mediaStreamTrack.readyState === 'live', bytes, packets };
      }, speaker)));
    }
    try {
      expect(await service.syncRoom(tenId, tenState)).toBe(true);
      for (let index = 0; index < 10; index++) {
        const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
        const page = await context.newPage(); await page.goto(localUrl);
        await page.addScriptTag({ path: path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js') }); tenPages.push(page);
      }
      const tokens = await Promise.all(tenState.players.map(player => service.issueToken(tenId, player.id)));
      await Promise.all(tokens.map((token, index) => connect(token, tenPages[index]!)));
      const name = (await new TokenVerifier(apiKey, apiSecret).verify(tokens[0]!.token)).video!.room!;
      const joined = await eventually(() => client.listParticipants(name), participants => participants.length === 10 && participants.find(value => value.identity === 'ten-0')?.permission?.canPublish === true, 10_000);
      expect(joined.filter(value => value.permission?.canPublish)).toHaveLength(1);
      await eventually(() => tenPages[0]!.evaluate(() => Boolean((window as unknown as BrowserWindow).councilRoom!.localParticipant.permissions?.canPublish)), Boolean);
      await tenPages[0]!.evaluate(async () => { await (window as unknown as BrowserWindow).councilRoom!.localParticipant.setMicrophoneEnabled(true); });
      const first = await eventually(() => receivers('ten-0', 0), values => values.length === 9 && values.every(value => value.subscribed && value.live && value.bytes > 0 && value.packets > 0), 10_000);
      expect(first).toHaveLength(9);
      expect(await service.syncRoom(tenId, { ...tenState, speakerId: 'ten-1' })).toBe(true);
      const rotated = await client.listParticipants(name);
      expect(rotated.find(value => value.identity === 'ten-0')?.permission?.canPublish).toBe(false);
      expect(rotated.filter(value => value.permission?.canPublish)).toHaveLength(1);
      await eventually(() => tenPages[1]!.evaluate(() => Boolean((window as unknown as BrowserWindow).councilRoom!.localParticipant.permissions?.canPublish)), Boolean);
      await tenPages[1]!.evaluate(async () => { await (window as unknown as BrowserWindow).councilRoom!.localParticipant.setMicrophoneEnabled(true); });
      const second = await eventually(() => receivers('ten-1', 1), values => values.length === 9 && values.every(value => value.subscribed && value.live && value.bytes > 0 && value.packets > 0), 10_000);
      expect(second).toHaveLength(9);
      expect(await service.closeRoom(tenId)).toBe(true);
    } finally {
      await Promise.all(contexts.map(context => context.close())); await service.closeRoom(tenId);
    }
  }, 60_000);
});
