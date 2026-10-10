import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';
import type { Room } from 'livekit-client';
import { VoiceLobbyService } from '../apps/server/src/voice-lobby.js';
import type { VoiceLobbyTicket } from '@wangxu/shared';

type Scope = Window & { LivekitClient: typeof import('livekit-client'); lobby: Room; markers: number[]; markerContext: AudioContext };
const config = { apiKey: process.env.LIVEKIT_API_KEY!, apiSecret: process.env.LIVEKIT_API_SECRET!,
  serverUrl: process.env.LIVEKIT_URL ?? 'http://127.0.0.1:7880', publicUrl: process.env.LIVEKIT_PUBLIC_URL ?? 'ws://127.0.0.1:7880' };
const admin = new RoomServiceClient(config.serverUrl, config.apiKey, config.apiSecret, { requestTimeout: 2, failover: false });
const blocked = new Set<string>();
const service = new VoiceLobbyService(config, id => blocked.has(id));
const contexts: BrowserContext[] = [];
const measurements: Record<string, unknown> = { capturedAt: new Date().toISOString(), runtime: process.version,
  environment: 'local self-hosted LiveKit / Chromium / injected audio; not a Europe Wi-Fi, mobile, TURN/TLS or physical microphone measurement' };
let browser: Browser, http: Server, startedServer: ChildProcess | undefined, url: string;
const run = randomUUID();
const forceRelay = process.env.LIVEKIT_TEST_FORCE_RELAY === '1';
async function eventually<T>(read: () => Promise<T>, condition: (value: T) => boolean, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T;
  do { value = await read(); if (condition(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  throw new Error(`Condition not satisfied: ${JSON.stringify(value!)}`);
}
async function page(): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
  const result = await context.newPage(); await result.goto(url);
  await result.addScriptTag({ path: path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
  return result;
}
async function connect(page: Page, ticket: VoiceLobbyTicket): Promise<number> {
  return page.evaluate(async ticket => {
    const scope = window as unknown as Scope;
    const { Room, AudioPresets, RoomEvent } = scope.LivekitClient;
    if (ticket.forceRelay) {
      // Keep server-issued TURN credentials, but exclude UDP/TCP TURN and non-443 TLS endpoints.
      const Native = window.RTCPeerConnection;
      const tls = (configuration: RTCConfiguration = {}): RTCConfiguration => ({ ...configuration, iceTransportPolicy: 'relay',
        iceServers: (configuration.iceServers ?? []).map(server => ({ ...server,
          urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(value => /^turns:[^?]*:443(?:\?|$)/i.test(value)),
        })).filter(server => server.urls.length > 0) });
      window.RTCPeerConnection = class extends Native {
        constructor(configuration?: RTCConfiguration) { super(tls(configuration)); }
        setConfiguration(configuration: RTCConfiguration) { super.setConfiguration(tls(configuration)); }
      };
    }
    scope.lobby = new Room({ audioCaptureDefaults: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, red: true, forceStereo: false, stopMicTrackOnMute: false } });
    scope.lobby.on(RoomEvent.TrackSubscribed, track => { if (track.kind === 'audio') document.body.append(track.attach()); });
    await scope.lobby.prepareConnection(ticket.url);
    const start = performance.now();
    await scope.lobby.startAudio(); await scope.lobby.connect(ticket.url, ticket.token, {
      ...(ticket.forceRelay ? { rtcConfig: { iceTransportPolicy: 'relay' as const } } : {}),
    });
    return performance.now() - start;
  }, { ...ticket, forceRelay });
}
async function receivers(page: Page) {
  return page.evaluate(async () => {
    const room = (window as unknown as Scope).lobby;
    return Promise.all([...room.remoteParticipants.values()].map(async participant => {
      const track = [...participant.audioTrackPublications.values()].find(value => value.isSubscribed && value.audioTrack)?.audioTrack;
      const report = await track?.getRTCStatsReport(); let packets = 0, bytes = 0; let rtt: number | null = null;
      let protocol: string | null = null, relay: boolean | null = null, relayProtocol: string | null = null;
      report?.forEach(stat => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') { packets += stat.packetsReceived ?? 0; bytes += stat.bytesReceived ?? 0; }
        if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
          if (typeof stat.currentRoundTripTime === 'number') rtt = stat.currentRoundTripTime * 1000;
          const local = report?.get(stat.localCandidateId), remote = report?.get(stat.remoteCandidateId);
          protocol = local?.protocol ?? remote?.protocol ?? null;
          relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
          relayProtocol = local?.relayProtocol ?? null;
        }
      });
      return { identity: participant.identity, live: track?.mediaStreamTrack.readyState === 'live', packets, bytes, rttMs: rtt, protocol, relay, relayProtocol };
    }));
  });
}

describe('real public voice lobby', () => {
  beforeAll(async () => {
    try { await admin.listRooms(); } catch {
      const binary = path.resolve('.local/bin/livekit-server');
      if (!existsSync(binary)) throw new Error('Install local LiveKit first.');
      startedServer = spawn(binary, ['--config', path.resolve('.local/livekit.yaml')], { stdio: 'ignore' });
      await eventually(async () => { try { await admin.listRooms(); return true; } catch { return false; } }, Boolean, 15_000);
    }
    http = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Public lobby integration</title>'); });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address = http.address(); if (!address || typeof address === 'string') throw new Error('No HTTP address');
    url = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  }, 30_000);
  afterAll(async () => {
    await browser?.close(); await service.dispose();
    await new Promise<void>(resolve => http ? http.close(() => resolve()) : resolve());
    startedServer?.kill('SIGTERM');
    mkdirSync('.local/verification', { recursive: true });
    writeFileSync('.local/verification/voice-lobby.json', JSON.stringify(measurements, null, 2));
  });

  it('issues server-owned microphone-only grants and rejects an existing expedition seat', async () => {
    const status = await service.status(); expect(status).toMatchObject({ available: true, online: 0, capacity: 10 });
    const token = await service.issueToken({ id: `${run}-claims`, name: '归灯语音者' });
    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(token.token);
    expect(claims.sub).toBe(`${run}-claims`); expect(claims.name).toBe('归灯语音者');
    expect(claims.video).toMatchObject({ canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false, canPublishSources: ['microphone'] });
    expect(claims.exp! - claims.nbf!).toBeLessThanOrEqual(20);
    blocked.add(`${run}-blocked`);
    await expect(service.issueToken({ id: `${run}-blocked`, name: '远征者' })).rejects.toMatchObject({ status: 403, code: 'IN_EXPEDITION' });
  });

  for (const count of [2, 4, 10]) {
    it(`admits ${count} muted clients and forwards every simultaneous microphone`, async () => {
      const pages = await Promise.all(Array.from({ length: count }, () => page()));
      try {
        const tokens = await Promise.all(pages.map((_page, index) => service.issueToken({ id: `${run}-${count}-${index}`, name: `语音者${index + 1}` })));
        const name = (await new TokenVerifier(config.apiKey, config.apiSecret).verify(tokens[0]!.token)).video!.room!;
        const connectMs = await Promise.all(pages.map((page, index) => connect(page, tokens[index]!)));
        const muted = await admin.listParticipants(name); expect(muted).toHaveLength(count);
        expect(muted.every(participant => participant.permission?.canPublish && participant.tracks.length === 0)).toBe(true);
        await Promise.all(pages.map(page => page.evaluate(async () => { await (window as unknown as Scope).lobby.localParticipant.setMicrophoneEnabled(true); })));
        const media = await eventually(() => Promise.all(pages.map(receivers)), values => values.every(tracks => tracks.length === count - 1 && tracks.every(track => track.live && track.packets > 0 && track.bytes > 0)), 20_000);
        if (forceRelay) expect(media.every(tracks => tracks.every(track => track.relay === true && track.relayProtocol === 'tls'))).toBe(true);
        const sorted = [...connectMs].sort((a, b) => a - b);
        measurements[`${count}Participants`] = { connectMs, connectP50Ms: sorted[Math.ceil(count * .5) - 1], connectP95Ms: sorted[Math.ceil(count * .95) - 1], receivers: media };
        if (count === 10) {
          if (startedServer?.pid) {
            const sample = execFileSync('ps', ['-p', String(startedServer.pid), '-o', '%cpu=,rss='], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
            measurements.serverLoad = { method: 'owned local LiveKit ps snapshot during 10 simultaneous microphone publications', cpuPercent: sample[0], residentKiB: sample[1] };
          }
          await expect(service.issueToken({ id: `${run}-overflow`, name: '第十一人' })).rejects.toMatchObject({ status: 409, code: 'LOBBY_FULL' });
          // Fetch a replacement ticket while full: an existing identity still occupies only one seat.
          const replacement = await service.issueToken({ id: `${run}-${count}-0`, name: '接管者' });
          const second = await page();
          await pages[0]!.evaluate(() => { (window as unknown as Scope).lobby.on((window as unknown as Scope).LivekitClient.RoomEvent.Disconnected, reason => { document.body.dataset.reason = String(reason); }); });
          await connect(second, replacement);
          await eventually(() => pages[0]!.evaluate(() => document.body.dataset.reason), value => value === '2'); // DUPLICATE_IDENTITY
          expect(await admin.listParticipants(name)).toHaveLength(10);
          await second.evaluate(async () => { await (window as unknown as Scope).lobby.disconnect(); });
          // SFU capacity is also authoritative when eleven valid tickets race into an empty room.
        }
        if (count === 2) {
          const before = await pages[0]!.evaluate(() => [...(window as unknown as Scope).lobby.localParticipant.audioTrackPublications.values()][0]!.track!.mediaStreamTrack.id);
          await pages[0]!.evaluate(async () => { const room = (window as unknown as Scope).lobby; await room.localParticipant.setMicrophoneEnabled(false); await room.localParticipant.setMicrophoneEnabled(true); });
          expect(await pages[0]!.evaluate(() => [...(window as unknown as Scope).lobby.localParticipant.audioTrackPublications.values()][0]!.track!.mediaStreamTrack.id)).toBe(before);
        }
      } finally {
        await Promise.allSettled(pages.map(page => page.evaluate(async () => { await (window as unknown as Scope).lobby?.disconnect(); })));
        await Promise.allSettled(pages.map(page => page.context().close()));
      }
    }, 60_000);
  }

  it('rejects the eleventh connection even with tickets minted before concurrent admission', async () => {
    const pages = await Promise.all(Array.from({ length: 11 }, () => page()));
    try {
      const tokens = await Promise.all(pages.map((_page, index) => service.issueToken({ id: `${run}-race-${index}`, name: `并发者${index}` })));
      const results = await Promise.allSettled(pages.map((page, index) => connect(page, tokens[index]!)));
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    } finally {
      await Promise.allSettled(pages.map(page => page.evaluate(async () => { await (window as unknown as Scope).lobby?.disconnect(); })));
      await Promise.allSettled(pages.map(page => page.context().close()));
    }
  }, 45_000);

  it('measures decoded audio marker delay against a source reference on a shared host clock', async () => {
    const sender = await page(), receiver = await page();
    const pages = [sender, receiver];
    try {
      const tokens = await Promise.all(pages.map((_page, index) => service.issueToken({ id: `${run}-marker-${index}`, name: `标记${index}` })));
      await Promise.all(pages.map((page, index) => connect(page, tokens[index]!)));
      const processor = `class Marker extends AudioWorkletProcessor {
        constructor() { super(); this.active = false; }
        process(inputs, outputs) {
          const input = inputs[0]?.[0]; if (!input) return true;
          outputs[0]?.forEach(channel => channel.set(input));
          let sum = 0; for (const value of input) sum += value * value;
          const active = sum / input.length > .002;
          if (active && !this.active) this.port.postMessage(currentFrame / sampleRate);
          this.active = active; return true;
        }
      } registerProcessor('marker', Marker);`;
      for (const page of pages) await page.evaluate(async processor => {
        const scope = window as unknown as Scope;
        scope.markers = []; scope.markerContext = new AudioContext(); await scope.markerContext.resume();
        const blob = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }));
        try { await scope.markerContext.audioWorklet.addModule(blob); } finally { URL.revokeObjectURL(blob); }
      }, processor);
      await receiver.evaluate(() => {
        const scope = window as unknown as Scope;
        scope.lobby.on(scope.LivekitClient.RoomEvent.TrackSubscribed, track => {
          if (track.kind !== 'audio') return;
          track.attachedElements.forEach(element => { element.muted = true; });
          const context = scope.markerContext;
          const detector = new AudioWorkletNode(context, 'marker');
          detector.port.onmessage = event => {
            const clock = context.getOutputTimestamp();
            if (!clock.contextTime || !clock.performanceTime) throw new Error('Output audio clock unavailable');
            scope.markers.push(performance.timeOrigin + clock.performanceTime + (event.data - clock.contextTime) * 1000);
          };
          context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(detector).connect(context.destination);
        });
      });
      await sender.evaluate(async () => {
        const scope = window as unknown as Scope, context = scope.markerContext;
        const oscillator = context.createOscillator(); oscillator.frequency.value = 1000;
        const gate = context.createGain(); gate.gain.value = 0;
        const detector = new AudioWorkletNode(context, 'marker');
        detector.port.onmessage = event => {
          const clock = context.getOutputTimestamp();
          if (!clock.contextTime || !clock.performanceTime) throw new Error('Output audio clock unavailable');
          scope.markers.push(performance.timeOrigin + clock.performanceTime + (event.data - clock.contextTime) * 1000);
        };
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gate); gate.connect(destination); gate.connect(detector).connect(context.destination);
        oscillator.start();
        await scope.lobby.localParticipant.publishTrack(destination.stream.getAudioTracks()[0]!, { source: scope.LivekitClient.Track.Source.Microphone });
        // Let the subscription and jitter buffer settle before measuring 12 separate tone onsets.
        const start = context.currentTime + 2;
        for (let index = 0; index < 12; index++) {
          gate.gain.setValueAtTime(.3, start + index);
          gate.gain.setValueAtTime(0, start + index + .25);
        }
      });
      await eventually(() => receiver.evaluate(() => (window as unknown as Scope).markers.length), count => count >= 12, 20_000);
      const source = await sender.evaluate(() => (window as unknown as Scope).markers);
      const sink = await receiver.evaluate(() => (window as unknown as Scope).markers);
      expect(source).toHaveLength(12); expect(sink).toHaveLength(12);
      const delays = source.map((time, index) => sink[index]! - time).sort((a, b) => a - b);
      expect(delays.every(delay => delay > 0 && delay < 1000)).toBe(true);
      measurements.audioMarkers = { method: '12 tone onsets; source-reference and decoded-receiver AudioWorklets mapped through AudioContext.getOutputTimestamp and performance.timeOrigin on the same host',
        includes: 'browser encode, SFU, decode and audio output clock scheduling', excludes: 'physical microphone, speaker, Bluetooth and external network', samplesMs: delays,
        p50Ms: delays[Math.ceil(delays.length * .5) - 1], p95Ms: delays[Math.ceil(delays.length * .95) - 1] };
    } finally { await Promise.allSettled(pages.map(page => page.context().close())); }
  }, 40_000);

  it('rotates an expired room and cleans up only its own names after restart', async () => {
    const old = await service.issueToken({ id: `${run}-old`, name: '旧大厅' });
    const oldName = (await new TokenVerifier(config.apiKey, config.apiSecret).verify(old.token)).video!.room!;
    await admin.deleteRoom(oldName);
    const next = await service.issueToken({ id: `${run}-new`, name: '新大厅' }); expect(next.epoch).not.toBe(old.epoch);
    const stale = await page(); await expect(connect(stale, old)).rejects.toThrow(); await stale.context().close();
    const another = new VoiceLobbyService(config);
    try {
      const otherToken = await another.issueToken({ id: `${run}-other`, name: '另一实例' });
      const otherName = (await new TokenVerifier(config.apiKey, config.apiSecret).verify(otherToken.token)).video!.room!;
      await service.dispose();
      expect((await admin.listRooms([otherName])).length).toBe(1);
      await expect(service.issueToken({ id: `${run}-late`, name: '已关闭' })).rejects.toMatchObject({ status: 503 });
    } finally { await another.dispose(); }
  });
});
