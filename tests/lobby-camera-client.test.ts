import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ request: vi.fn(), capture: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), mic: vi.fn(), rooms: [] as any[] }));
vi.mock('../apps/web/src/api', () => ({ request: fake.request }));
vi.mock('../apps/web/src/audio-devices', () => ({ bindAudioRoom: () => () => {}, applyVoiceVolume: vi.fn() }));
vi.mock('../apps/web/src/sound-player', () => ({ playLobbySound: vi.fn(), unlockEffects: vi.fn(), preloadSounds: vi.fn() }));
vi.mock('livekit-client', async () => {
  const actual = await vi.importActual<typeof import('livekit-client')>('livekit-client');
  class Room {
    metadata = ''; state = actual.ConnectionState.Disconnected; canPlaybackAudio = true; activeSpeakers = [];
    remoteParticipants = new Map(); private listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    localParticipant = { identity: 'self', name: '自己', sid: 'sid-self', isMicrophoneEnabled: false,
      permissions: { canPublish: true, canPublishSources: [actual.Track.sourceToProto(actual.Track.Source.Microphone)] },
      audioTrackPublications: new Map(), videoTrackPublications: new Map(), setMicrophoneEnabled: fake.mic,
      publishTrack: async (track: any, options: unknown) => {
        await fake.publish(track, options); const publication = { source: actual.Track.Source.Camera, track };
        this.localParticipant.videoTrackPublications.set('camera', publication); this.emit(actual.RoomEvent.LocalTrackPublished, publication); return publication;
      },
      unpublishTrack: async (track: any) => { await fake.unpublish(track); this.localParticipant.videoTrackPublications.delete('camera'); this.emit(actual.RoomEvent.LocalTrackUnpublished, { source: actual.Track.Source.Camera, track }); },
    };
    constructor() { fake.rooms.push(this); }
    on(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); return this; }
    off(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, (this.listeners.get(event) ?? []).filter(value => value !== listener)); return this; }
    emit(event: string, ...args: unknown[]) { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
    removeAllListeners() { this.listeners.clear(); }
    startAudio = async () => {}; prepareConnection = async () => {};
    connect = async () => { this.state = actual.ConnectionState.Connected; };
    disconnect = async () => { this.state = actual.ConnectionState.Disconnected; this.emit(actual.RoomEvent.Disconnected, actual.DisconnectReason.CLIENT_INITIATED); };
  }
  return { ...actual, Room, createLocalVideoTrack: fake.capture };
});
import { ConnectionState, RoomEvent, Track, TrackEvent } from 'livekit-client';
import { LobbyVoiceConnection, lobbyCameraOwner } from '../apps/web/src/lobby-voice';
const connections: LobbyVoiceConnection[] = [];
const lease = { id: 'lease-self', epoch: 'epoch', participantSid: 'sid-self' };
function cameraTrack() {
  const handlers = new Map<string, () => void>();
  return { source: Track.Source.Camera, kind: Track.Kind.Video, stop: vi.fn(), on: (event: string, callback: () => void) => handlers.set(event, callback),
    end: () => handlers.get(TrackEvent.Ended)?.(), mediaStreamTrack: { getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }) } };
}
async function join() { const connection = new LobbyVoiceConnection(); connections.push(connection); await connection.join(); return connection; }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); fake.rooms = [];
  fake.capture.mockImplementation(async () => cameraTrack());
  fake.request.mockImplementation(async (path: string, command?: any) => {
    if (path.endsWith('/token')) return { url: 'local', token: 'ticket', epoch: 'epoch' };
    if (!path.endsWith('/camera')) return { available: true, online: 0, capacity: 0, url: null };
    const room = [...fake.rooms].reverse().find(room => room.state === ConnectionState.Connected);
    if (command.action === 'acquire') {
      room.localParticipant.permissions.canPublishSources.push(Track.sourceToProto(Track.Source.Camera));
      room.metadata = JSON.stringify({ kind: 'public-lobby', epoch: 'epoch', camera: { id: 'self', name: '自己', participantSid: 'sid-self' } });
      room.emit(RoomEvent.RoomMetadataChanged); room.emit(RoomEvent.ParticipantPermissionsChanged);
      return { lease };
    }
    if (command.action === 'release' && room) { room.metadata = JSON.stringify({ kind: 'public-lobby', epoch: 'epoch', camera: null }); room.emit(RoomEvent.RoomMetadataChanged); }
    return { lease: command.action === 'release' ? null : lease };
  });
});
afterEach(() => { connections.splice(0).forEach(connection => connection.dispose()); vi.useRealTimers(); });

describe('camera controller lifecycle without browser media', () => {
  it('publishes a 1080p60 camera with a 3 Mbps cap independently of microphone and listening', async () => {
    const connection = await join(); await connection.toggleCamera();
    expect(fake.capture).toHaveBeenCalledWith(expect.objectContaining({ resolution: { width: 1920, height: 1080, frameRate: 60 } }));
    expect(fake.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: Track.Source.Camera, videoCodec: 'h264', videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 60 }, simulcast: false }));
    expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: true, cameraBusy: false, muted: true });
    expect(connection.getSnapshot().cameraTrack).toBe(fake.publish.mock.calls[0][0]);
    expect(fake.mic).not.toHaveBeenCalled(); connection.toggleListening();
    expect(connection.getSnapshot()).toMatchObject({ listening: false, cameraEnabled: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.request).toHaveBeenCalledWith('/voice/lobby/camera', { action: 'renew', epoch: 'epoch', participantSid: 'sid-self', leaseId: lease.id });
    const track = connection.getSnapshot().cameraTrack!; await connection.stopCamera();
    expect(track.stop).toHaveBeenCalled(); expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: false, cameraBusy: false, cameraTrack: null });
  });

  it('does not reserve the slot when permission is refused or a permission prompt resolves after leaving', async () => {
    const connection = await join(); fake.capture.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await connection.toggleCamera(); expect(connection.getSnapshot().message).toContain('权限被拒绝'); expect(fake.request.mock.calls.some(call => call[0].endsWith('/camera'))).toBe(false);
    let grant!: (track: any) => void; fake.capture.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const pending = connection.toggleCamera(); connection.leave(); const track = cameraTrack(); grant(track); await pending;
    expect(track.stop).toHaveBeenCalled(); expect(fake.publish).not.toHaveBeenCalled(); expect(connection.getSnapshot().state).toBe('idle');
  });

  it('releases a grant that arrives after leaving without reopening the camera', async () => {
    const connection = await join(); let grant!: (value: unknown) => void;
    const request = fake.request.getMockImplementation()!;
    fake.request.mockImplementation((path: string, command?: any) => command?.action === 'acquire' ? new Promise(resolve => { grant = resolve; }) : request(path, command));
    const pending = connection.toggleCamera(); await vi.waitFor(() => expect(grant).toBeTypeOf('function'));
    connection.leave(); grant({ lease }); await pending;
    expect(fake.publish).not.toHaveBeenCalled();
    expect(fake.request).toHaveBeenCalledWith('/voice/lobby/camera', { action: 'release', epoch: 'epoch', participantSid: 'sid-self', leaseId: lease.id });
    expect(connection.getSnapshot()).toMatchObject({ state: 'idle', cameraBusy: false, cameraEnabled: false });
  });

  it('stops the device and releases its lease when publishing fails', async () => {
    const connection = await join(); fake.publish.mockRejectedValueOnce(new Error('encode failed'));
    await connection.toggleCamera(); const track = fake.capture.mock.results[0];
    expect((await track.value).stop).toHaveBeenCalled();
    expect(fake.request).toHaveBeenCalledWith('/voice/lobby/camera', expect.objectContaining({ action: 'release' }));
    expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: false, cameraBusy: false, message: 'encode failed' });
  });

  it('waits for signaling permission after an HTTP grant and releases a grant when signaling never arrives', async () => {
    const connection = await join(), room = connection.room as any;
    const request = fake.request.getMockImplementation()!;
    fake.request.mockImplementation((path: string, command?: any) => command?.action === 'acquire' ? Promise.resolve({ lease }) : request(path, command));
    const pending = connection.toggleCamera(); await vi.advanceTimersByTimeAsync(0);
    expect(fake.publish).not.toHaveBeenCalled();
    room.localParticipant.permissions.canPublishSources.push(Track.sourceToProto(Track.Source.Camera));
    room.emit(RoomEvent.ParticipantPermissionsChanged); await pending;
    expect(connection.getSnapshot().cameraEnabled).toBe(true); await connection.stopCamera();
    room.localParticipant.permissions.canPublishSources = [Track.sourceToProto(Track.Source.Microphone)];
    const timeout = connection.toggleCamera(); await vi.advanceTimersByTimeAsync(3000); await timeout;
    expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: false, cameraBusy: false, message: '摄像头授权暂未同步，请重试。' });
  });

  it('unblocks controls and stops the device if the camera service never answers', async () => {
    const connection = await join(); const request = fake.request.getMockImplementation()!;
    fake.request.mockImplementation((path: string, command?: any) => command?.action === 'acquire' ? new Promise(() => {}) : request(path, command));
    const pending = connection.toggleCamera(); await vi.advanceTimersByTimeAsync(5000); await pending;
    expect((await fake.capture.mock.results[0].value).stop).toHaveBeenCalled();
    expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: false, cameraBusy: false, message: '摄像头服务响应超时，请重试。' });
  });

  it('releases independently of SDK renegotiation and ignores a late unpublish from an old camera', async () => {
    const connection = await join(); await connection.toggleCamera(); const oldTrack = connection.getSnapshot().cameraTrack!;
    let finish!: () => void; fake.unpublish.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await connection.stopCamera();
    expect(fake.request).toHaveBeenCalledWith('/voice/lobby/camera', expect.objectContaining({ action: 'release' }));
    expect(connection.getSnapshot().cameraBusy).toBe(false);
    await connection.toggleCamera(); const nextTrack = connection.getSnapshot().cameraTrack!;
    expect(nextTrack).not.toBe(oldTrack);
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: true, cameraBusy: false, cameraTrack: nextTrack });
  });

  it('closes the local camera on device removal, lease failure and terminal disconnect', async () => {
    const connection = await join(); await connection.toggleCamera();
    (connection.getSnapshot().cameraTrack as any).end();
    await vi.waitFor(() => expect(connection.getSnapshot().cameraBusy).toBe(false));
    expect(connection.getSnapshot().cameraEnabled).toBe(false);
    await connection.toggleCamera(); fake.request.mockRejectedValueOnce(new Error('lease lost')); await vi.advanceTimersByTimeAsync(5000);
    expect(connection.getSnapshot()).toMatchObject({ cameraEnabled: false, cameraBusy: false });
    await connection.toggleCamera(); const track = connection.getSnapshot().cameraTrack!;
    (connection.room as any).emit(RoomEvent.Disconnected);
    expect(track.stop).toHaveBeenCalled(); expect(connection.getSnapshot()).toMatchObject({ state: 'idle', cameraOwner: null, cameraTrack: null, cameraBusy: false });
  });

  it('renders only the server-authorized participant session and drops video after revocation', async () => {
    const connection = await join(), room = connection.room as any, track = cameraTrack();
    room.remoteParticipants.set('remote', { identity: 'remote', sid: 'sid-new', name: '远端', isMicrophoneEnabled: false, getTrackPublication: () => ({ videoTrack: track }) });
    room.metadata = JSON.stringify({ kind: 'public-lobby', epoch: 'epoch', camera: { id: 'remote', name: '远端', participantSid: 'sid-old' } });
    room.emit(RoomEvent.RoomMetadataChanged); expect(connection.getSnapshot().cameraTrack).toBeNull();
    room.metadata = JSON.stringify({ kind: 'public-lobby', epoch: 'epoch', camera: { id: 'remote', name: '远端', participantSid: 'sid-new' } });
    room.emit(RoomEvent.TrackSubscribed, track); expect(connection.getSnapshot().cameraTrack).toBe(track);
    room.metadata = JSON.stringify({ kind: 'public-lobby', epoch: 'epoch', camera: null }); room.emit(RoomEvent.RoomMetadataChanged);
    expect(connection.getSnapshot().cameraTrack).toBeNull();
    expect(lobbyCameraOwner('invalid', 'epoch')).toBeNull();
    expect(lobbyCameraOwner(JSON.stringify({ kind: 'public-lobby', epoch: 'old', camera: { id: 'remote', name: '远端', participantSid: 'sid-new' } }), 'epoch')).toBeNull();
  });
});
