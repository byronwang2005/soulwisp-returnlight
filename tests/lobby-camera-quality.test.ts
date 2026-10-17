import { describe, expect, it, vi } from 'vitest';
import type { RemoteVideoTrack } from 'livekit-client';
import { cameraBuffer, CameraStats } from '../apps/web/src/lobby-camera-quality';
const report = (...stats: Record<string, unknown>[]) => new Map(stats.map(stat => [stat.id, stat])) as unknown as RTCStatsReport;
const track = (receiver: object) => ({ receiver, setPlayoutDelay: vi.fn((seconds: number) => Reflect.set(receiver, 'playoutDelayHint', seconds)) }) as unknown as RemoteVideoTrack;

describe('camera-only buffering', () => {
  it('prefers milliseconds on the standard receiver and restores its previous target', () => {
    const receiver = { jitterBufferTarget: null, playoutDelayHint: .1 }, video = track(receiver);
    const result = cameraBuffer(video, true);
    expect(result.status).toBe('smooth'); expect(receiver.jitterBufferTarget).toBe(300);
    expect(video.setPlayoutDelay).not.toHaveBeenCalled(); expect(receiver.playoutDelayHint).toBe(.1);
    result.restore(); expect(receiver.jitterBufferTarget).toBeNull();
    const realtime = cameraBuffer(video, false); expect(receiver.jitterBufferTarget).toBe(0);
    realtime.restore(); expect(receiver.jitterBufferTarget).toBeNull();
  });
  it('falls back to the SDK in seconds, including a throwing standard setter', () => {
    const receiver = { playoutDelayHint: .05 }, video = track(receiver);
    Object.defineProperty(receiver, 'jitterBufferTarget', { get: () => null, set: () => { throw new Error('unsupported'); } });
    const result = cameraBuffer(video, true);
    expect(video.setPlayoutDelay).toHaveBeenCalledWith(.3); expect(receiver.playoutDelayHint).toBe(.3);
    result.restore(); expect(receiver.playoutDelayHint).toBe(.05);
    cameraBuffer(video, false); expect(video.setPlayoutDelay).toHaveBeenLastCalledWith(0);
  });
  it('reports missing and rejected APIs without interrupting playback', () => {
    expect(cameraBuffer(track({}), true).status).toBe('unsupported');
    expect(cameraBuffer(track({}), false).status).toBe('realtime');
    const video = track({ playoutDelayHint: 0 }); vi.mocked(video.setPlayoutDelay).mockImplementation(() => { throw new Error('ended'); });
    expect(cameraBuffer(video, true).status).toBe('unsupported');
    expect(cameraBuffer({ receiver: undefined } as RemoteVideoTrack, true).status).toBe('unsupported');
  });
});

describe('video interval statistics', () => {
  it('separates capture from encoding and measures actual bitrate and encoded frames', () => {
    const stats = new CameraStats();
    const outbound = { id: 'camera', type: 'outbound-rtp', kind: 'video', timestamp: 1000, bytesSent: 1000, framesEncoded: 30, frameWidth: 1280, frameHeight: 720, qualityLimitationReason: 'cpu' };
    const capture = { width: 1920, height: 1080, frameRate: 60 };
    expect(stats.sample(report(outbound), 'send', capture)).toMatchObject({ captureWidth: 1920, width: 1280, fps: null, bitrate: null, limitation: 'cpu' });
    expect(stats.sample(report({ ...outbound, timestamp: 4000, bytesSent: 3_751_000, framesEncoded: 120 }), 'send', capture)).toMatchObject({ bitrate: 10_000_000, fps: 30 });
  });
  it('uses interval loss and buffer averages and excludes audio and retransmission streams', () => {
    const stats = new CameraStats();
    const inbound = { id: 'camera', type: 'inbound-rtp', kind: 'video', timestamp: 1000, bytesReceived: 500, packetsLost: 20, packetsReceived: 100, framesDecoded: 60, jitterBufferDelay: 4, jitterBufferEmittedCount: 60 };
    const auxiliary = [{ id: 'audio', type: 'inbound-rtp', kind: 'audio', bytesReceived: 9999999 }, { id: 'rtx-codec', mimeType: 'video/rtx' }, { ...inbound, id: 'rtx', codecId: 'rtx-codec', bytesReceived: 99999999 }];
    expect(stats.sample(report(inbound, ...auxiliary), 'receive')).toMatchObject({ bitrate: null, bufferMs: null });
    expect(stats.sample(report({ ...inbound, timestamp: 4000, bytesReceived: 375500, packetsLost: 23, packetsReceived: 397, framesDecoded: 240, jitterBufferDelay: 58, jitterBufferEmittedCount: 240 }, ...auxiliary), 'receive')).toMatchObject({ bitrate: 1_000_000, fps: 60, lossPercent: 1, bufferMs: 300 });
  });
  it('does not invent zeros for missing fields, resets, or zero observation intervals', () => {
    const stats = new CameraStats();
    const sample = { id: 'video', type: 'inbound-rtp', mediaType: 'video', timestamp: 1000, bytesReceived: 10 };
    stats.sample(report(sample), 'receive');
    expect(stats.sample(report(sample), 'receive')).toMatchObject({ bitrate: null, fps: null, width: null, lossPercent: null, bufferMs: null });
    expect(stats.sample(report({ ...sample, timestamp: 2000, bytesReceived: 0 }), 'receive').bitrate).toBeNull();
    stats.clear(); expect(stats.sample(report({ ...sample, timestamp: 3000 }), 'receive').bitrate).toBeNull();
    expect(stats.sample(report(), 'receive')).toMatchObject({ width: null, bitrate: null });
    expect(stats.sample(report({ ...sample, timestamp: 4000 }), 'receive').bitrate).toBeNull();
    expect(stats.sample(report({ ...sample, id: 'replacement', timestamp: 5000 }), 'receive').bitrate).toBeNull();
  });
});
