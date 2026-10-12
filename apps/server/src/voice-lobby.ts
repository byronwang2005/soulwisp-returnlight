import { randomUUID } from 'node:crypto';
import { AccessToken, RoomServiceClient, TrackSource, type ParticipantInfo } from 'livekit-server-sdk';
import type { VoiceLobbyInfo, VoiceLobbyTicket, VoiceLobbyCameraOwner, VoiceLobbyCameraLease, VoiceLobbyCameraCommand } from '@wangxu/shared';
import type { VoiceConfig } from './voice.js';

export class LobbyVoiceError extends Error {
  constructor(public readonly status: 403 | 409 | 503, public readonly code: string, message: string) { super(message); }
}

const CAMERA_LEASE_MS = 15_000;
interface CameraSlot extends VoiceLobbyCameraOwner { leaseId: string; expiresAt: number }

/** One public media room per application instance, independent of council epochs. */
export class VoiceLobbyService {
  private readonly client: RoomServiceClient;
  private readonly instance = randomUUID();
  private name: string | null = null;
  private epoch: string | null = null;
  private readonly issuedAccounts = new Set<string>();
  private readonly ownedNames = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private cached: { at: number; info: VoiceLobbyInfo } | null = null;
  private statusRequest: Promise<VoiceLobbyInfo> | null = null;
  private reconciled = false;
  private readonly owner: string;
  private readonly admissionTimer: NodeJS.Timeout;
  private camera: CameraSlot | null = null;
  private metadataDirty = false;

  constructor(private readonly config: VoiceConfig, private readonly inExpedition: (id: string) => boolean = () => false,
    private readonly options: { cleanupPreviousInstances?: boolean; cleanupLegacy?: boolean; canJoin?: (id:string)=>boolean } = {}) {
    this.client = new RoomServiceClient(config.serverUrl, config.apiKey, config.apiSecret, { requestTimeout: 2, failover: false });
    this.owner = `soulwisp-returnlight:${config.publicUrl}`;
    this.admissionTimer=setInterval(()=>{void this.serial(async()=>{
      if(this.stopping||!this.name)return;
      await this.reconcileParticipants();
    }).catch(()=>{});},1000);this.admissionTimer.unref();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work);
    this.queue = task;
    return task;
  }

  private unavailable(): LobbyVoiceError { return new LobbyVoiceError(503, 'LOBBY_UNAVAILABLE', '语音大厅暂时离线，请稍后重试。'); }

  private canJoin(id: string): boolean { return !this.inExpedition(id) && (!this.options.canJoin || this.options.canJoin(id)); }

  private roomMetadata(): string {
    const camera: VoiceLobbyCameraOwner | null = this.camera && { id: this.camera.id, name: this.camera.name, participantSid: this.camera.participantSid };
    return JSON.stringify({ kind: 'public-lobby', owner: this.owner, serverInstanceId: this.instance, epoch: this.epoch, camera });
  }

  private async flushMetadata(): Promise<void> {
    if (!this.metadataDirty || !this.name) return;
    await this.client.updateRoomMetadata(this.name, this.roomMetadata());
    this.metadataDirty = false;
  }

  private async setCameraPermission(participant: ParticipantInfo, enabled: boolean): Promise<ParticipantInfo> {
    return this.client.updateParticipant(this.name!, participant.identity, { permission: {
      canPublish: true, canSubscribe: true, canPublishSources: enabled ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [TrackSource.MICROPHONE],
      canPublishData: false, canUpdateMetadata: false,
    } });
  }

  private async clearCamera(participants: ParticipantInfo[]): Promise<void> {
    // Revocation removes existing camera tracks at the SFU before the next grant.
    // Keep the slot occupied if any revocation fails or its response is lost.
    for (const participant of participants) {
      if (participant.identity === this.camera?.id || this.hasCameraPermission(participant) || participant.tracks?.some(track => track.source === TrackSource.CAMERA)) {
        await this.setCameraPermission(participant, false);
      }
    }
    this.camera = null; this.metadataDirty = true;
    await this.flushMetadata();
  }

  private hasCameraPermission(participant: ParticipantInfo): boolean {
    const permission = participant.permission;
    return Boolean(permission?.canPublish && (!permission.canPublishSources.length || permission.canPublishSources.includes(TrackSource.CAMERA)));
  }

  private async reconcileParticipants(): Promise<ParticipantInfo[]> {
    if (!this.name) return [];
    const participants = await this.client.listParticipants(this.name);
    const admitted: ParticipantInfo[] = [];
    for (const participant of participants) {
      if (!this.canJoin(participant.identity)) await this.client.removeParticipant(this.name, participant.identity, { revokeTokenTs: BigInt(Math.floor(Date.now()/1000)+1) });
      else admitted.push(participant);
    }
    if (this.camera && (this.camera.expiresAt <= Date.now() || !admitted.some(participant => participant.identity === this.camera!.id && participant.sid === this.camera!.participantSid))) {
      await this.clearCamera(admitted);
    }
    // Refreshed self-hosted tokens can carry old grants. Never adopt their camera rights.
    for (const participant of admitted) {
      const ownsSlot = participant.identity === this.camera?.id && participant.sid === this.camera.participantSid;
      if (!ownsSlot && (this.hasCameraPermission(participant) || participant.tracks?.some(track => track.source === TrackSource.CAMERA))) await this.setCameraPermission(participant, false);
    }
    await this.flushMetadata();
    return admitted;
  }

  async cameraCommand(account: { id: string; name: string }, command: VoiceLobbyCameraCommand): Promise<VoiceLobbyCameraLease | null> {
    return this.serial(async () => {
      if (this.stopping || !this.name) throw this.unavailable();
      // Delayed requests from an old room/page must never release a new owner's slot.
      if (command.action === 'release' && (command.epoch !== this.epoch || this.camera?.leaseId !== command.leaseId || this.camera.id !== account.id || this.camera.participantSid !== command.participantSid)) return null;
      if (command.epoch !== this.epoch) throw new LobbyVoiceError(409, 'CAMERA_SESSION_CHANGED', '大厅已重启，请重新连接语音。');
      const participants = await this.reconcileParticipants();
      if (command.action === 'release') { await this.clearCamera(participants); return null; }
      const participant = participants.find(value => value.identity === account.id && value.sid === command.participantSid);
      if (!participant || !this.canJoin(account.id)) throw new LobbyVoiceError(403, 'NOT_WAITING', '请先连接等待区语音。');
      if (command.action === 'renew') {
        if (!this.camera || this.camera.id !== account.id || this.camera.participantSid !== command.participantSid || this.camera.leaseId !== command.leaseId) throw new LobbyVoiceError(409, 'CAMERA_LEASE_LOST', '摄像头共享已结束，请重新开启。');
        this.camera.expiresAt = Date.now() + CAMERA_LEASE_MS;
      } else {
        if (this.camera) throw new LobbyVoiceError(409, 'CAMERA_BUSY', `${this.camera.name}正在共享摄像头。`);
        this.camera = { id: account.id, name: account.name, participantSid: participant.sid, leaseId: randomUUID(), expiresAt: Date.now() + CAMERA_LEASE_MS };
        this.metadataDirty = true;
      }
      // Always grant via the server; admission tickets remain microphone-only.
      const updated = await this.setCameraPermission(participant, true);
      if (updated.sid !== command.participantSid || !this.canJoin(account.id)) {
        await this.clearCamera(await this.client.listParticipants(this.name));
        throw new LobbyVoiceError(409, 'CAMERA_SESSION_CHANGED', '语音连接已变化，请重新开启摄像头。');
      }
      await this.flushMetadata();
      return { id: this.camera!.leaseId, epoch: this.epoch!, participantSid: command.participantSid };
    });
  }

  private async ensureRoom(): Promise<string> {
    if (this.stopping) throw this.unavailable();
    // Production has one authoritative app process. Reconcile after crashes as
    // well as graceful restarts, before creating a room or issuing any ticket.
    if (!this.reconciled && this.options.cleanupPreviousInstances) {
      for (const room of await this.client.listRooms()) {
        let metadata: { kind?: string; owner?: string; serverInstanceId?: string; epoch?: string };
        try { metadata = JSON.parse(room.metadata || '{}'); } catch { continue; }
        if (!metadata || metadata.kind !== 'public-lobby' || !metadata.serverInstanceId || !metadata.epoch ||
          room.name !== `public-lobby-${metadata.serverInstanceId}-${metadata.epoch}`) continue;
        if (metadata.owner !== this.owner && !(this.options.cleanupLegacy && metadata.owner === undefined)) continue;
        try { await this.client.deleteRoom(room.name); }
        catch (error) { if (!isNotFound(error)) throw error; }
      }
      // A failed deletion must be retried; creating another room would split listeners.
      this.reconciled = true;
    }
    if (this.name && (await this.client.listRooms([this.name])).length) return this.name;
    const epoch = randomUUID();
    const name = `public-lobby-${this.instance}-${epoch}`;
    // Remember the exact name before creation, so a timed-out creation can still be cleaned up.
    this.name = name;this.issuedAccounts.clear();this.camera = null;this.metadataDirty = false;
    this.epoch = epoch;
    this.ownedNames.add(name);
    await this.client.createRoom({ name, maxParticipants: 0, emptyTimeout: 600, departureTimeout: 600,
      metadata: this.roomMetadata() });
    if (this.stopping) throw this.unavailable();
    return name;
  }

  async status(): Promise<VoiceLobbyInfo> {
    if (this.stopping) return { available: false, online: 0, capacity: 0, url: null };
    if (this.cached && Date.now() - this.cached.at < 3000) return this.cached.info;
    if (this.statusRequest) return this.statusRequest;
    const request = this.serial(async () => {
      try {
        const name = await this.ensureRoom();
        const participants = await this.client.listParticipants(name);
        const info: VoiceLobbyInfo = { available: true, online: participants.length, capacity: 0, url: this.config.publicUrl };
        this.cached = { at: Date.now(), info };
        return info;
      } catch {
        const info: VoiceLobbyInfo = { available: false, online: 0, capacity: 0, url: null };
        this.cached = { at: Date.now(), info };
        return info;
      }
    });
    this.statusRequest = request;
    try { return await request; } finally { if (this.statusRequest === request) this.statusRequest = null; }
  }

  async issueToken(account: { id: string; name: string }): Promise<VoiceLobbyTicket> {
    return this.serial(async () => {
      if (this.stopping) throw this.unavailable();
      if(this.options.canJoin&&!this.options.canJoin(account.id))throw new LobbyVoiceError(403,'NOT_WAITING','请先加入等待区');
      if (this.inExpedition(account.id)) throw new LobbyVoiceError(403, 'IN_EXPEDITION', '请先离开远征，再加入语音大厅。');
      try {
        const name = await this.ensureRoom();
        await this.client.listParticipants(name);
        if(this.options.canJoin&&!this.options.canJoin(account.id))throw new LobbyVoiceError(403,'NOT_WAITING','请先加入等待区');
        if (this.inExpedition(account.id)) throw new LobbyVoiceError(403, 'IN_EXPEDITION', '请先离开远征，再加入语音大厅。');
        const access = new AccessToken(this.config.apiKey, this.config.apiSecret, { identity: account.id, name: account.name, ttl: 20 });
        access.addGrant({ roomJoin: true, room: name, canSubscribe: true, canPublish: true,
          canPublishSources: [TrackSource.MICROPHONE], canPublishData: false, canUpdateOwnMetadata: false });
        const token = await access.toJwt();
        if (this.stopping) throw this.unavailable();
        if(this.inExpedition(account.id)||this.options.canJoin&&!this.options.canJoin(account.id))throw new LobbyVoiceError(403,'NOT_WAITING','请先加入等待区');
        this.issuedAccounts.add(account.id);this.cached = null;
        return { token, url: this.config.publicUrl, epoch: this.epoch! };
      } catch (error) {
        if (error instanceof LobbyVoiceError) throw error;
        throw this.unavailable();
      }
    });
  }

  async removeParticipant(id: string): Promise<void> {
    await this.serial(async () => {
      if (!this.name||!this.issuedAccounts.has(id)) return;
      try { await this.client.removeParticipant(this.name, id, { revokeTokenTs: BigInt(Math.floor(Date.now()/1000)+1) }); } catch (error) {
        if (!isNotFound(error)) throw this.unavailable();
      }
      if (this.camera?.id === id) await this.clearCamera(await this.client.listParticipants(this.name));
      this.cached = null;
    });
  }

  async dispose(): Promise<void> {
    this.stopping = true;clearInterval(this.admissionTimer);
    await this.queue.catch(() => {});
    for (let attempt = 0; attempt < 3 && this.ownedNames.size; attempt++) {
      for (const name of [...this.ownedNames]) {
        try { await this.client.deleteRoom(name); this.ownedNames.delete(name); }
        catch (error) { if (isNotFound(error)) this.ownedNames.delete(name); }
      }
    }
    if (this.ownedNames.size) console.warn('[voice-lobby] shutdown cleanup incomplete');
    else { this.name = null; this.epoch = null; }
  }
}

function isNotFound(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'not_found'); }
