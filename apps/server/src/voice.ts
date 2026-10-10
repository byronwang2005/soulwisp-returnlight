import { randomUUID } from 'node:crypto';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { Phase } from '@wangxu/shared';

export interface VoiceState {
  phase: Phase; chapter: number; speakerId: string | null; open?: boolean;
  players: { id: string; name: string; sealed: boolean }[];
}
interface Council { epoch: string; name: string; chapter: number; state: VoiceState; permissions: Map<string, boolean> }
export class VoiceError extends Error {
  constructor(public readonly status: 403 | 503, message: string) { super(message); }
}
export interface VoiceConfig { serverUrl: string; publicUrl: string; apiKey: string; apiSecret: string }

/** Each council is a separate SFU room; completed room names are never reused. */
export class VoiceService {
  private readonly client: RoomServiceClient;
  private readonly councils = new Map<string, Council>();
  private readonly pendingDeletes = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly timer: NodeJS.Timeout;
  private readonly instanceId = randomUUID();
  private polling = false;
  private shuttingDown = false;
  constructor(private readonly config: VoiceConfig) {
    this.client = new RoomServiceClient(config.serverUrl, config.apiKey, config.apiSecret, { requestTimeout: 2, failover: false });
    this.timer = setInterval(() => { void this.reconcile().catch(error => this.warn(error)); }, 500);
    this.timer.unref();
  }
  private warn(error: unknown) { console.warn('[voice] unavailable:', error instanceof Error ? error.message : String(error)); }
  private async serial<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(roomId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    this.locks.set(roomId, task);
    try { return await task; } finally { if (this.locks.get(roomId) === task) this.locks.delete(roomId); }
  }
  snapshot(roomId: string) {
    const council = this.councils.get(roomId);
    return { enabled: Boolean(council), epoch: council?.epoch ?? null };
  }
  async syncRoom(roomId: string, state: VoiceState): Promise<boolean> {
    if (this.shuttingDown) return false;
    return this.serial(roomId, async () => {
      if (this.shuttingDown) return false;
      let council = this.councils.get(roomId);
      if (state.phase !== 'DISCUSS') return this.closeInside(roomId);
      if (council && council.chapter !== state.chapter) {
        if (!await this.closeInside(roomId)) return false;
        council = undefined;
      }
      if (!council) {
        const epoch = randomUUID();
        const name = `council-${roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}-${epoch}`;
        try {
          await this.client.createRoom({ name, maxParticipants: state.players.length, emptyTimeout: 600, departureTimeout: 600, metadata: JSON.stringify({ gameRoomId: roomId, epoch, serverInstanceId: this.instanceId }) });
          council = { epoch, name, chapter: state.chapter, state: structuredClone(state), permissions: new Map() };
          this.councils.set(roomId, council);
        } catch (error) { this.pendingDeletes.add(name); this.warn(error); return false; }
      }
      council.state = structuredClone(state);
      try { await this.updatePermissions(council); return true; } catch (error) { this.warn(error); return false; }
    });
  }
  private allowed(council: Council, id: string) {
    const player = council.state.players.find(player => player.id === id);
    return Boolean(player && !player.sealed && council.state.phase === 'DISCUSS' && (council.state.open || council.state.speakerId === id));
  }
  private async updatePermissions(council: Council) {
    const participants = await this.client.listParticipants(council.name);
    const revoke: Promise<unknown>[] = [];
    const grant: { identity: string; publish: boolean }[] = [];
    for (const participant of participants) {
      if (!council.state.players.some(player => player.id === participant.identity)) {
        revoke.push(this.client.removeParticipant(council.name, participant.identity));
        continue;
      }
      const publish = this.allowed(council, participant.identity);
      // Re-check actual SFU permissions: a reconnect may have re-applied the token's muted grants.
      if (participant.permission?.canPublish === publish && council.permissions.get(participant.identity) === publish) continue;
      const update = () => this.client.updateParticipant(council.name, participant.identity, { permission: {
        canPublish: publish, canSubscribe: true, canPublishData: false, canPublishSources: publish ? [TrackSource.MICROPHONE] : [], canUpdateMetadata: false,
      } });
      if (!publish) revoke.push(update().then(() => { council.permissions.set(participant.identity, false); }));
      else grant.push({ identity: participant.identity, publish });
    }
    // Revoke the old turn before granting the next one, even if the SFU lists the new speaker first.
    await Promise.all(revoke);
    for (const { identity } of grant) {
      await this.client.updateParticipant(council.name, identity, { permission: {
        canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: [TrackSource.MICROPHONE], canUpdateMetadata: false,
      } });
      council.permissions.set(identity, true);
    }
  }
  async issueToken(roomId: string, userId: string): Promise<{ token: string; url: string; epoch: string }> {
    if (this.shuttingDown) throw new VoiceError(403, '议会服务正在关闭');
    const council = this.councils.get(roomId);
    const player = council?.state.players.find(player => player.id === userId);
    if (!council || council.state.phase !== 'DISCUSS' || !player) throw new VoiceError(403, '当前不在可收听的议会中');
    // Every admission starts muted. Only UpdateParticipant can grant the current speaking turn,
    // so reconnecting with a token from an earlier turn cannot revive publishing rights.
    const access = new AccessToken(this.config.apiKey, this.config.apiSecret, { identity: userId, name: player.name, ttl: 20 });
    access.addGrant({ roomJoin: true, room: council.name, canSubscribe: true, canPublish: false,
      canPublishSources: [], canPublishData: false, canUpdateOwnMetadata: false });
    const token = await access.toJwt();
    if (this.shuttingDown || this.councils.get(roomId) !== council) throw new VoiceError(403, '这一轮议会已结束');
    return { token, url: this.config.publicUrl, epoch: council.epoch };
  }
  async closeRoom(roomId: string): Promise<boolean> { return this.serial(roomId, () => this.closeInside(roomId)); }
  private async closeInside(roomId: string): Promise<boolean> {
    const council = this.councils.get(roomId);
    if (council) {
      council.state.phase = 'RESULT';
      this.councils.delete(roomId);
      this.pendingDeletes.add(council.name);
    }
    let closed = true;
    for (const name of [...this.pendingDeletes].filter(name => name.startsWith(`council-${roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}-`))) {
      try { await this.client.deleteRoom(name); this.pendingDeletes.delete(name); }
      catch (error) {
        // DeleteRoom returns not_found if a previous retry already removed the room.
        if (this.notFound(error)) this.pendingDeletes.delete(name); else { closed = false; this.warn(error); }
      }
    }
    return closed;
  }
  private notFound(error: unknown) { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'not_found'); }
  private async reconcile() {
    if (this.polling || this.shuttingDown) return;
    this.polling = true;
    try {
      for (const [roomId, council] of this.councils) await this.serial(roomId, () => this.updatePermissions(council)).catch(error => this.warn(error));
      for (const name of [...this.pendingDeletes]) {
        try { await this.client.deleteRoom(name); this.pendingDeletes.delete(name); }
        catch (error) { if (this.notFound(error)) this.pendingDeletes.delete(name); }
      }
    } finally { this.polling = false; }
  }
  async dispose() {
    this.shuttingDown = true;
    clearInterval(this.timer);
    // A creation already in flight may not yet be visible in councils.
    await Promise.allSettled([...this.locks.values()]);
    for (const roomId of [...this.councils.keys()]) await this.closeRoom(roomId);
    // closeInside removes council state before trying DeleteRoom. Retry those
    // exact names; do not scan or delete rooms belonging to another instance.
    for (let attempt = 0; attempt < 3 && this.pendingDeletes.size; attempt++) {
      for (const name of [...this.pendingDeletes]) {
        try { await this.client.deleteRoom(name); this.pendingDeletes.delete(name); }
        catch (error) { if (this.notFound(error)) this.pendingDeletes.delete(name); else this.warn(error); }
      }
      if (this.pendingDeletes.size && attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (this.pendingDeletes.size) console.warn('[voice] shutdown cleanup incomplete:', [...this.pendingDeletes].join(', '));
  }
  async shutdown() { await this.dispose(); }
}
export function createVoiceService(): VoiceService | undefined {
  const config = getVoiceConfig();
  return config ? new VoiceService(config) : undefined;
}
export function getVoiceConfig(): VoiceConfig | undefined {
  const apiKey = process.env.LIVEKIT_API_KEY, apiSecret = process.env.LIVEKIT_API_SECRET;
  const publicUrl = process.env.LIVEKIT_PUBLIC_URL ?? process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !publicUrl) return undefined;
  const serverUrl = process.env.LIVEKIT_SERVER_URL ?? process.env.LIVEKIT_URL ?? publicUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  return { apiKey, apiSecret, publicUrl, serverUrl };
}
