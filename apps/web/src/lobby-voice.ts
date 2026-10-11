import {bindAudioRoom,applyVoiceVolume} from './audio-devices';
import { AudioPresets, ConnectionState, DisconnectReason, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import type { VoiceLobbyInfo, VoiceLobbyTicket } from '@wangxu/shared';
import { request } from './api';
import { LobbyStats, type LobbyTrackMetrics } from './lobby-stats';
import {LobbySoundTracker} from './lobby-sounds';
import {playLobbySound,unlockEffects,preloadSounds} from './sound-player';

export interface LobbyMember { id: string; name: string; muted: boolean; speaking: boolean; self: boolean }
export interface LobbySnapshot {
  info: VoiceLobbyInfo; state: 'idle' | 'joining' | 'connected' | 'reconnecting'; members: LobbyMember[];
  muted: boolean; listening: boolean; micBusy: boolean; playbackBlocked: boolean; message: string;
  metrics: LobbyTrackMetrics[]; connectMs: number | null;
}
export const LOBBY_ROOM_OPTIONS = {
  audioCaptureDefaults: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  publishDefaults: { audioPreset: AudioPresets.speech, forceStereo: false, dtx: true, red: true, stopMicTrackOnMute: false },
};

/** Owns one media session; every asynchronous action checks the session generation. */
export class LobbyVoiceConnection {
  room = new Room(LOBBY_ROOM_OPTIONS);
  private snapshot: LobbySnapshot = { info: { available: false, online: 0, capacity: 0, url: null }, state: 'idle',
    members: [], muted: true, listening: true, micBusy: false, playbackBlocked: false, message: '', metrics: [], connectMs: null };
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
      if (this.disposed || room !== this.room || track.kind !== Track.Kind.Audio) return;
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
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => { this.update({ playbackBlocked: !room.canPlaybackAudio }); });
    const reconnecting = () => this.update({ state: 'reconnecting', message: '连接暂时中断，正在恢复…', metrics: [] });
    room.on(RoomEvent.Reconnecting, reconnecting).on(RoomEvent.SignalReconnecting, reconnecting);
    room.on(RoomEvent.Reconnected, () => { this.stats.clear(); this.update({ state: 'connected', message: '' }); this.syncMembers(true); });
    room.on(RoomEvent.Disconnected, reason => {
      if (this.disposed || room !== this.room || this.snapshot.state === 'joining') return;
      this.sounds.leave();
      this.generation++;
      this.clearMedia();
      this.update({ state: 'idle', muted: true, micBusy: false, members: [], metrics: [],
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
    this.generation++;
    this.clearMedia();
    // Stop immediately; disconnect may still be waiting on signaling.
    const previous = this.room;
    this.unbindDevices?.();
    previous.removeAllListeners();
    for (const publication of previous.localParticipant.audioTrackPublications.values()) publication.track?.stop();
    void previous.disconnect();
    this.room = new Room(LOBBY_ROOM_OPTIONS);
    this.bindRoom(this.room);
    this.preparedUrl = null;
    if (this.snapshot.info.url) void this.room.prepareConnection(this.snapshot.info.url).catch(() => {});
    this.update({ state: 'idle', members: [], muted: true, micBusy: false, playbackBlocked: false, metrics: [], message: '' });
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
  }

  private detach(id: string): void {
    const audio = this.audio.get(id);
    if (!audio) return;
    audio.track.detach(audio.element); audio.element.remove(); this.audio.delete(id);
  }
  private clearMedia(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    for (const id of this.audio.keys()) this.detach(id);
    this.stats.clear();
  }
  private async sampleStats(): Promise<void> {
    if (this.sampling || this.disposed || this.snapshot.state !== 'connected') return;
    this.sampling = true;
    const generation = this.generation;
    try {
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
