import {bindAudioRoom,applyVoiceVolume} from './audio-devices';
import { AudioPresets, ConnectionState, DisconnectReason, Room, RoomEvent, Track, TrackEvent, createLocalVideoTrack,
  type Participant, type RemoteTrack, type LocalVideoTrack, type RemoteVideoTrack, type VideoCaptureOptions, type TrackPublishOptions } from 'livekit-client';
import type { VoiceLobbyInfo, VoiceLobbyTicket, VoiceLobbyCameraOwner, VoiceLobbyCameraLease, VoiceLobbyCameraCommand } from '@wangxu/shared';
import { request } from './api';
import { LobbyStats, type LobbyTrackMetrics } from './lobby-stats';
import { cameraBuffer, CameraStats, type CameraMetrics, type CameraBufferStatus } from './lobby-camera-quality';
import {LobbySoundTracker} from './lobby-sounds';
import {playLobbySound,unlockEffects,preloadSounds} from './sound-player';

export interface LobbyMember { id: string; name: string; muted: boolean; speaking: boolean; self: boolean }
export interface LobbySnapshot {
  info: VoiceLobbyInfo; state: 'idle' | 'joining' | 'connected' | 'reconnecting'; members: LobbyMember[];
  muted: boolean; listening: boolean; micBusy: boolean; playbackBlocked: boolean; message: string;
  metrics: LobbyTrackMetrics[]; connectMs: number | null;
  cameraOwner: VoiceLobbyCameraOwner | null; cameraTrack: LocalVideoTrack | RemoteVideoTrack | null;
  cameraEnabled: boolean; cameraBusy: boolean;
  cameraMetrics: CameraMetrics | null; cameraSmooth: boolean; cameraBufferStatus: CameraBufferStatus;
}
export const LOBBY_CAMERA_CAPTURE: VideoCaptureOptions = { resolution: { width: 1920, height: 1080, frameRate: 60 }, frameRate: { ideal: 60, max: 60 }, facingMode: 'user' };
export const LOBBY_CAMERA_PUBLISH: TrackPublishOptions = { source: Track.Source.Camera, videoCodec: 'h264',
  videoEncoding: { maxBitrate: 10_000_000, maxFramerate: 60 }, simulcast: false, degradationPreference: 'maintain-resolution' };

export function lobbyCameraOwner(metadata: string | undefined, epoch: string | null): VoiceLobbyCameraOwner | null {
  try {
    const value = JSON.parse(metadata || '{}');
    const camera = value.camera;
    if (!epoch || value.kind !== 'public-lobby' || value.epoch !== epoch || !camera || typeof camera.id !== 'string' || typeof camera.name !== 'string' || typeof camera.participantSid !== 'string') return null;
    return { id: camera.id, name: camera.name, participantSid: camera.participantSid };
  } catch { return null; }
}
export const LOBBY_ROOM_OPTIONS = {
  audioCaptureDefaults: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  publishDefaults: { audioPreset: AudioPresets.speech, forceStereo: false, dtx: true, red: true, stopMicTrackOnMute: false },
  adaptiveStream: true,
};

/** Owns one media session; every asynchronous action checks the session generation. */
export class LobbyVoiceConnection {
  room = new Room(LOBBY_ROOM_OPTIONS);
  private snapshot: LobbySnapshot = { info: { available: false, online: 0, capacity: 0, url: null }, state: 'idle',
    members: [], muted: true, listening: true, micBusy: false, playbackBlocked: false, message: '', metrics: [], connectMs: null,
    cameraOwner: null, cameraTrack: null, cameraEnabled: false, cameraBusy: false,
    cameraMetrics: null, cameraSmooth: true, cameraBufferStatus: 'pending' };
  private listeners = new Set<() => void>();
  private audio = new Map<string, { track: RemoteTrack; element: HTMLMediaElement }>();
  private stats = new LobbyStats();
  private generation = 0;
  private disposed = false;
  private preparedUrl: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private sampling = false;
  private refreshing = false;
  private startedAt = 0;
  private unbindDevices:(()=>void)|undefined;
  private epoch: string | null = null;
  private cameraLease: VoiceLobbyCameraLease | null = null;
  private localCamera: LocalVideoTrack | null = null;
  private cameraTimer: ReturnType<typeof setInterval> | null = null;
  private cameraSequence = 0;
  private renewingCamera = false;
  private cameraStats = new CameraStats();
  private cameraStatsRevision = 0;
  private restoreCameraBuffer: (() => void) | null = null;

  private resetCameraQuality(): void {
    this.cameraStats.clear(); this.cameraStatsRevision++;
    this.restoreCameraBuffer?.(); this.restoreCameraBuffer = null;
    this.update({ cameraMetrics: null, cameraBufferStatus: this.snapshot.cameraSmooth ? 'pending' : 'realtime' });
  }

  setCameraSmooth(smooth: boolean): void {
    this.update({ cameraSmooth: smooth });
    this.applyCameraBuffer();
  }

  private applyCameraBuffer(): void {
    this.restoreCameraBuffer?.(); this.restoreCameraBuffer = null;
    const track = this.snapshot.cameraTrack;
    if (!track || this.snapshot.cameraEnabled || this.snapshot.state !== 'connected') {
      this.update({ cameraBufferStatus: this.snapshot.cameraSmooth ? 'pending' : 'realtime' }); return;
    }
    const result = cameraBuffer(track as RemoteVideoTrack, this.snapshot.cameraSmooth);
    this.restoreCameraBuffer = result.restore;
    this.update({ cameraBufferStatus: result.status });
  }

  private sounds=new LobbySoundTracker(playLobbySound);

  constructor() { this.bindRoom(this.room); }

  private bindRoom(room: Room): void {
    this.unbindDevices=bindAudioRoom(room);
    const members = () => {if(!this.disposed&&room===this.room)this.syncMembers();};
    room.on(RoomEvent.ParticipantConnected, members).on(RoomEvent.ParticipantDisconnected, members)
      .on(RoomEvent.TrackMuted, members).on(RoomEvent.TrackUnmuted, members)
      .on(RoomEvent.ActiveSpeakersChanged, members).on(RoomEvent.LocalTrackPublished, members)
      .on(RoomEvent.TrackPublished,members).on(RoomEvent.TrackUnpublished,members).on(RoomEvent.LocalTrackUnpublished,members);
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (this.disposed || room !== this.room) return;
      if (track.kind === Track.Kind.Video) { this.syncCamera(); return; }
      if (track.kind !== Track.Kind.Audio) return;
      const id = track.sid;
      if (!id) return;
      this.detach(id);
      const element = track.attach();
      applyVoiceVolume(element); element.autoplay = true; element.muted = !this.snapshot.listening; element.dataset.voice = 'lobby';
      element.dataset.participant = participant.identity;
      document.body.append(element);
      this.audio.set(id, { track, element });
      this.syncMembers();
    });
    room.on(RoomEvent.TrackUnsubscribed, track => { if (track.sid) this.detach(track.sid); this.syncMembers(); });
    room.on(RoomEvent.RoomMetadataChanged, () => {
      if (this.disposed || room !== this.room) return;
      this.syncCamera();
      if (this.cameraLease && (this.snapshot.cameraOwner?.participantSid !== this.cameraLease.participantSid || this.snapshot.cameraOwner.id !== room.localParticipant.identity)) {
        void this.stopCamera();
      }
    });
    room.on(RoomEvent.LocalTrackUnpublished, publication => {
      if (room === this.room && publication.source === Track.Source.Camera && publication.track === this.localCamera && this.snapshot.cameraEnabled) void this.stopCamera();
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => { this.update({ playbackBlocked: !room.canPlaybackAudio }); });
    const reconnecting = () => { this.resetCameraQuality(); this.update({ state: 'reconnecting', message: '连接暂时中断，正在恢复…', metrics: [] }); };
    room.on(RoomEvent.Reconnecting, reconnecting).on(RoomEvent.SignalReconnecting, reconnecting);
    room.on(RoomEvent.Reconnected, () => {
      this.stats.clear(); this.resetCameraQuality(); this.update({ state: 'connected', message: '' }); this.syncMembers(true); this.applyCameraBuffer();
      if (this.cameraLease && (room.localParticipant.sid !== this.cameraLease.participantSid || this.snapshot.cameraOwner?.participantSid !== this.cameraLease.participantSid)) void this.stopCamera();
    });
    room.on(RoomEvent.Disconnected, reason => {
      if (this.disposed || room !== this.room || this.snapshot.state === 'joining') return;
      this.sounds.leave();
      void this.stopCamera();
      this.generation++;
      this.epoch = null;
      this.clearMedia();
      this.update({ state: 'idle', muted: true, micBusy: false, members: [], metrics: [], cameraEnabled: false, cameraBusy: false, cameraTrack: null, cameraOwner: null,
        message: reason === DisconnectReason.DUPLICATE_IDENTITY ? '语音已在另一个页面接管。' : reason === DisconnectReason.ROOM_DELETED ? '大厅已重启，请重新加入。' : reason === DisconnectReason.CLIENT_INITIATED ? '' : '语音已断开，请重新加入。' });
      void this.refresh();
    });
  }

  getSnapshot = (): LobbySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<LobbySnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  async initialize(): Promise<void> {
    preloadSounds();
    await this.refresh();
    if (!this.disposed) this.refreshTimer = setInterval(() => { if (this.snapshot.state === 'idle' && !document.hidden) void this.refresh(); }, 10_000);
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.refreshing) return;
    this.refreshing = true;
    try {
      const info = await request<VoiceLobbyInfo>('/voice/lobby');
      if (this.disposed) return;
      this.update({ info });
      if (info.url && this.preparedUrl !== info.url) {
        this.preparedUrl = info.url;
        // A failed prewarm must never prevent an actual connection attempt.
        void this.room.prepareConnection(info.url).catch(() => { this.preparedUrl = null; });
      }
    } catch { this.update({ info: { available: false, online: 0, capacity: 0, url: null } }); }
    finally { this.refreshing = false; }
  }

  async join(): Promise<void> {
    if (this.disposed || this.snapshot.state !== 'idle') return;
    unlockEffects();
    const generation = ++this.generation;
    const room = this.room;
    this.startedAt = performance.now();
    this.update({ state: 'joining', message: '', muted: true, listening: true, connectMs: null, playbackBlocked: false });
    // Invoke during the click, before fetching the token, to unlock Safari's audio context.
    void room.startAudio().catch(() => { if (generation === this.generation) this.update({ playbackBlocked: true }); });
    try {
      const ticket = await request<VoiceLobbyTicket>('/voice/lobby/token', {});
      if (this.disposed || generation !== this.generation) return;
      this.epoch = ticket.epoch;
      await room.connect(ticket.url, ticket.token, { autoSubscribe: true });
      if (this.disposed || generation !== this.generation) { await room.disconnect(); return; }
      this.update({ state: 'connected', connectMs: performance.now() - this.startedAt, playbackBlocked: !room.canPlaybackAudio });
      this.syncMembers(true);
      this.sounds.join(this.snapshot.members);
      this.statsTimer = setInterval(() => void this.sampleStats(), 3000);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      const message = error instanceof Error ? error.message : '语音连接失败，请重试。';
      await room.disconnect();
      this.clearMedia();
      this.update({ state: 'idle', message: /participant|limit|full/i.test(message) ? '语音暂时无法连接，请重试。' : message });
      void this.refresh();
    }
  }

  async toggleMic(): Promise<void> {
    if (this.disposed || this.snapshot.state !== 'connected' || this.snapshot.micBusy) return;
    unlockEffects();
    const generation = this.generation;
    const room = this.room;
    const enable = this.snapshot.muted;
    this.update({ micBusy: true, message: '' });
    try {
      await room.localParticipant.setMicrophoneEnabled(enable);
      if (this.disposed || generation !== this.generation) {
        // A permission prompt may resolve after navigation or cancellation.
        for (const publication of room.localParticipant.audioTrackPublications.values()) {
          publication.track?.stop();
          if (publication.track) await room.localParticipant.unpublishTrack(publication.track);
        }
        return;
      }
      this.syncMembers();
    } catch (error) {
      if (generation === this.generation) {
        console.warn('[voice-lobby] microphone unavailable:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown media error');
        this.update({ message: '无法打开麦克风，请检查浏览器权限和音频设备。你仍可收听。' });
      }
    }
    finally { if (generation === this.generation) this.update({ micBusy: false }); }
  }

  private async cameraRequest(command: VoiceLobbyCameraCommand): Promise<VoiceLobbyCameraLease | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        request<{ lease: VoiceLobbyCameraLease | null }>('/voice/lobby/camera', command),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('摄像头服务响应超时，请重试。')), 5000); }),
      ]);
      return result.lease;
    } finally { if (timer) clearTimeout(timer); }
  }

  private async releaseCamera(lease: VoiceLobbyCameraLease): Promise<void> {
    await this.cameraRequest({ action: 'release', epoch: lease.epoch, participantSid: lease.participantSid, leaseId: lease.id });
  }

  private async waitForCameraPermission(room: Room, generation: number, sequence: number): Promise<void> {
    const allowed = () => room.localParticipant.permissions?.canPublish && room.localParticipant.permissions.canPublishSources.includes(Track.sourceToProto(Track.Source.Camera));
    if (allowed()) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); room.off(RoomEvent.ParticipantPermissionsChanged, check); error ? reject(error) : resolve(); };
      const check = () => {
        if (this.disposed || generation !== this.generation || sequence !== this.cameraSequence) finish(new Error('摄像头操作已取消'));
        else if (allowed()) finish();
      };
      const timer = setTimeout(() => finish(new Error('摄像头授权暂未同步，请重试。')), 3000);
      room.on(RoomEvent.ParticipantPermissionsChanged, check);
      check();
    });
  }

  async toggleCamera(): Promise<void> {
    if (this.disposed || this.snapshot.state !== 'connected' || this.snapshot.cameraBusy) return;
    if (this.snapshot.cameraEnabled) { await this.stopCamera(); return; }
    if (this.snapshot.cameraOwner) return;
    const generation = this.generation, sequence = ++this.cameraSequence, room = this.room;
    const epoch = this.epoch, participantSid = room.localParticipant.sid;
    if (!epoch || !participantSid) return;
    const current = () => !this.disposed && generation === this.generation && sequence === this.cameraSequence && room === this.room;
    let track: LocalVideoTrack | null = null, lease: VoiceLobbyCameraLease | null = null;
    this.update({ cameraBusy: true, message: '' });
    try {
      // Ask for the device before reserving the slot, so an unanswered prompt cannot hold it.
      track = await createLocalVideoTrack(LOBBY_CAMERA_CAPTURE);
      if (!current()) { track.stop(); return; }
      this.localCamera = track;
      track.on(TrackEvent.Ended, () => { if (this.localCamera === track) void this.stopCamera(); });
      lease = await this.cameraRequest({ action: 'acquire', epoch, participantSid });
      if (!lease) throw new Error('无法获得摄像头共享名额，请重试。');
      if (!current()) { track.stop(); await this.releaseCamera(lease); return; }
      this.cameraLease = lease;
      this.cameraTimer = setInterval(() => void this.renewCamera(), 5000);
      await this.waitForCameraPermission(room, generation, sequence);
      if (!current()) { track.stop(); return; }
      await room.localParticipant.publishTrack(track, LOBBY_CAMERA_PUBLISH);
      if (!current()) { track.stop(); await room.localParticipant.unpublishTrack(track); return; }
      this.update({ cameraEnabled: true }); this.syncCamera();
    } catch (error) {
      track?.stop();
      if (current()) {
        await this.stopCamera();
        // A lost grant response is recovered by the server's lease timeout.
        const name = error instanceof Error ? error.name : '';
        this.update({ message: name === 'NotAllowedError' ? '摄像头权限被拒绝，你仍可使用语音。' : name === 'NotFoundError' || name === 'NotReadableError' ? '无法使用摄像头，请检查设备连接或是否被其他应用占用。' : error instanceof Error ? error.message : '摄像头开启失败，请重试。' });
      }
    } finally { if (current()) this.update({ cameraBusy: false }); }
  }

  private async renewCamera(): Promise<void> {
    const lease = this.cameraLease, generation = this.generation;
    if (!lease || this.renewingCamera || this.snapshot.state !== 'connected') return;
    this.renewingCamera = true;
    try { await this.cameraRequest({ action: 'renew', epoch: lease.epoch, participantSid: lease.participantSid, leaseId: lease.id }); }
    catch {
      if (generation === this.generation && this.cameraLease === lease) {
        await this.stopCamera(); this.update({ message: '摄像头共享连接中断，请重新开启。' });
      }
    } finally { this.renewingCamera = false; }
  }

  async stopCamera(): Promise<void> {
    const track = this.localCamera, lease = this.cameraLease, room = this.room, generation = this.generation;
    const sequence = ++this.cameraSequence;
    this.localCamera = null; this.cameraLease = null;
    if (this.cameraTimer) clearInterval(this.cameraTimer);
    this.cameraTimer = null;
    track?.stop();
    this.resetCameraQuality();
    this.update({ cameraEnabled: false, cameraTrack: null, cameraBusy: Boolean(track || lease) });
    // SFU revocation must not wait for a pending SDK publish/renegotiation.
    if (track) void room.localParticipant.unpublishTrack(track).catch(() => {});
    try { if (lease) await this.releaseCamera(lease); }
    catch { if (generation === this.generation) this.update({ message: '摄像头已关闭，共享名额正在释放。' }); }
    finally { if (generation === this.generation && sequence === this.cameraSequence) this.update({ cameraBusy: false }); }
  }

  private syncCamera(): void {
    const owner = lobbyCameraOwner(this.room.metadata, this.epoch);
    let track: LocalVideoTrack | RemoteVideoTrack | null = null;
    if (owner?.participantSid === this.room.localParticipant.sid && this.snapshot.cameraEnabled) track = this.localCamera;
    else if (owner) {
      const participant = this.room.remoteParticipants.get(owner.id);
      if (participant?.sid === owner.participantSid) track = participant.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null;
    }
    const changed = track !== this.snapshot.cameraTrack || owner?.participantSid !== this.snapshot.cameraOwner?.participantSid || owner?.id !== this.snapshot.cameraOwner?.id;
    if (changed) this.resetCameraQuality();
    this.update({ cameraOwner: owner, cameraTrack: track });
    if (changed) this.applyCameraBuffer();
  }

  toggleListening(): void {
    if (this.snapshot.state !== 'connected') return;
    const listening = !this.snapshot.listening;
    this.audio.forEach(({ element }) => { element.muted = !listening; });
    this.update({ listening });
    if (listening) void this.startAudio();
  }

  async startAudio(): Promise<void> {
    const room = this.room, generation = this.generation;
    try { await room.startAudio(); if (generation === this.generation) this.update({ playbackBlocked: !room.canPlaybackAudio }); }
    catch { if (generation === this.generation) this.update({ playbackBlocked: true }); }
  }

  leave(): void {
    this.sounds.leave();
    void this.stopCamera();
    this.generation++;
    this.epoch = null;
    this.clearMedia();
    // Stop immediately; disconnect may still be waiting on signaling.
    const previous = this.room;
    this.unbindDevices?.();
    previous.removeAllListeners();
    for (const publication of previous.localParticipant.audioTrackPublications.values()) publication.track?.stop();
    for (const publication of previous.localParticipant.videoTrackPublications?.values() ?? []) publication.track?.stop();
    void previous.disconnect();
    this.room = new Room(LOBBY_ROOM_OPTIONS);
    this.bindRoom(this.room);
    this.preparedUrl = null;
    if (this.snapshot.info.url) void this.room.prepareConnection(this.snapshot.info.url).catch(() => {});
    this.update({ state: 'idle', members: [], muted: true, micBusy: false, playbackBlocked: false, metrics: [], message: '', cameraOwner: null, cameraTrack: null, cameraEnabled: false, cameraBusy: false });
  }

  dispose(): void {
    if (this.disposed) return;
    this.leave(); this.unbindDevices?.(); this.disposed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.room.removeAllListeners(); this.listeners.clear();
  }

  private syncMembers(silent=false): void {
    if (this.disposed || this.room.state === ConnectionState.Disconnected) return;
    const speaking = new Set(this.room.activeSpeakers.map(participant => participant.identity));
    const member = (participant: Participant, self: boolean): LobbyMember => ({ id: participant.identity,
      name: participant.name || '归灯者', muted: !participant.isMicrophoneEnabled, speaking: speaking.has(participant.identity), self });
    const members = [member(this.room.localParticipant, true), ...[...this.room.remoteParticipants.values()].map(participant => member(participant, false))];
    if(silent||this.snapshot.state!=='connected')this.sounds.baseline(members);
    else this.sounds.sync(members,this.snapshot.listening);
    this.update({ members, muted: !this.room.localParticipant.isMicrophoneEnabled, info: { ...this.snapshot.info, online: members.length } });
    this.syncCamera();
  }

  private detach(id: string): void {
    const audio = this.audio.get(id);
    if (!audio) return;
    audio.track.detach(audio.element); audio.element.remove(); this.audio.delete(id);
  }
  private clearMedia(): void {
    this.resetCameraQuality();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    for (const id of this.audio.keys()) this.detach(id);
    this.stats.clear();
  }
  private async sampleCameraStats(): Promise<void> {
    const track = this.snapshot.cameraTrack, revision = this.cameraStatsRevision;
    if (!track) return;
    const direction = this.snapshot.cameraEnabled ? 'send' : 'receive';
    try {
      const report = await track.getRTCStatsReport();
      if (this.disposed || revision !== this.cameraStatsRevision || track !== this.snapshot.cameraTrack || this.snapshot.state !== 'connected') return;
      if (!report) { this.cameraStats.clear(); this.update({ cameraMetrics: null }); return; }
      const capture = direction === 'send' ? track.mediaStreamTrack.getSettings() : undefined;
      this.update({ cameraMetrics: this.cameraStats.sample(report, direction, capture) });
    } catch {
      if (!this.disposed && revision === this.cameraStatsRevision && this.snapshot.state === 'connected') {
        this.cameraStats.clear(); this.update({ cameraMetrics: null });
      }
    }
  }
  private async sampleStats(): Promise<void> {
    if (this.sampling || this.disposed || this.snapshot.state !== 'connected') return;
    this.sampling = true;
    const generation = this.generation;
    try {
      await this.sampleCameraStats();
      const tracks = [...this.room.remoteParticipants.values()].flatMap(participant =>
        [...participant.audioTrackPublications.values()].filter(value => value.isSubscribed && value.audioTrack)
          .map(value => ({ track: value.audioTrack!, peer: participant.identity })));
      const metrics = await Promise.all(tracks.map(async ({ track, peer }) => {
        const report = await track.getRTCStatsReport();
        return report && generation === this.generation && !this.disposed ? this.stats.sample(track.sid!, peer, report) : null;
      }));
      if (generation !== this.generation || this.disposed) return;
      this.stats.retain(new Set(tracks.map(({ track }) => track.sid!)));
      this.update({ metrics: metrics.filter((value): value is LobbyTrackMetrics => value !== null) });
    } catch { /* Stats availability differs across browsers; media continues independently. */ }
    finally { this.sampling = false; }
  }
}
