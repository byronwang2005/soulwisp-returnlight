import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import type { ParticipantInfo } from 'livekit-server-sdk';
const fake = vi.hoisted(() => ({ participants: [] as ParticipantInfo[], metadata: '',
  list: vi.fn(), create: vi.fn(), members: vi.fn(), update: vi.fn(), metadataUpdate: vi.fn(), remove: vi.fn(), delete: vi.fn() }));
vi.mock('livekit-server-sdk', async importOriginal => ({ ...await importOriginal<typeof import('livekit-server-sdk')>(),
  RoomServiceClient: class {
    listRooms = fake.list; createRoom = fake.create; listParticipants = fake.members; updateParticipant = fake.update;
    updateRoomMetadata = fake.metadataUpdate; removeParticipant = fake.remove; deleteRoom = fake.delete;
  },
}));
import { TrackSource } from 'livekit-server-sdk';
import { VoiceLobbyService } from '../apps/server/src/voice-lobby.js';
const config = { serverUrl: 'http://test.invalid', publicUrl: 'wss://test.invalid', apiKey: 'unit-test-key', apiSecret: 'unit-test-secret-not-a-real-credential' };
const services: VoiceLobbyService[] = [];
const participant = (identity: string, sid = `sid-${identity}`) => ({ identity, sid, tracks: [], permission: { canPublish: true, canSubscribe: true, canPublishSources: [TrackSource.MICROPHONE] } } as unknown as ParticipantInfo);
async function setup(canJoin?: (id: string) => boolean) {
  const service = new VoiceLobbyService(config, () => false, { canJoin }); services.push(service);
  const ticket = await service.issueToken({ id: 'a', name: '甲' });
  fake.participants = [participant('a'), participant('b')];
  return { service, epoch: ticket.epoch, ticket };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000); vi.resetAllMocks(); fake.participants = []; fake.metadata = '';
  fake.list.mockResolvedValue([{}]); fake.create.mockResolvedValue({}); fake.members.mockImplementation(async () => fake.participants);
  fake.update.mockImplementation(async (_room: string, identity: string, { permission }: { permission: ParticipantInfo['permission'] }) => {
    const value = fake.participants.find(member => member.identity === identity)!;
    value.permission = permission;
    value.tracks = value.tracks.filter(track => permission!.canPublishSources.includes(track.source));
    return value;
  });
  fake.metadataUpdate.mockImplementation(async (_room: string, metadata: string) => { fake.metadata = metadata; return {}; });
  fake.remove.mockImplementation(async (_room: string, identity: string) => { fake.participants = fake.participants.filter(value => value.identity !== identity); });
  fake.delete.mockResolvedValue({});
});
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.dispose())); vi.useRealTimers(); });

describe('authoritative single camera slot', () => {
  it('keeps admission microphone-only and admits exactly one concurrent camera request', async () => {
    const { service, epoch, ticket } = await setup();
    expect(decodeJwt(ticket.token).video).toMatchObject({ canPublishSources: ['microphone'] });
    const results = await Promise.allSettled(['a', 'b'].map(id => service.cameraCommand({ id, name: id }, { action: 'acquire', epoch, participantSid: `sid-${id}` })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'CAMERA_BUSY' } });
    expect(fake.participants.filter(value => value.permission?.canPublishSources.includes(TrackSource.CAMERA))).toHaveLength(1);
    expect(JSON.parse(fake.metadata)).toMatchObject({ kind: 'public-lobby', epoch, camera: { id: 'a', participantSid: 'sid-a' } });
    expect(fake.metadata).not.toContain('leaseId');
    expect(await service.status()).not.toHaveProperty('camera');
  });

  it('revokes the old camera before granting the next one and ignores a delayed old release', async () => {
    const { service, epoch } = await setup();
    const lease = (await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' }))!;
    const release = { action: 'release' as const, epoch, participantSid: 'sid-a', leaseId: lease.id };
    await service.cameraCommand({ id: 'a', name: '甲' }, release);
    const next = (await service.cameraCommand({ id: 'b', name: '乙' }, { action: 'acquire', epoch, participantSid: 'sid-b' }))!;
    await service.cameraCommand({ id: 'a', name: '甲' }, release);
    expect(JSON.parse(fake.metadata).camera.id).toBe('b');
    expect(next.id).not.toBe(lease.id);
    const calls = fake.update.mock.calls;
    const revokeIndex = calls.findIndex(call => call[1] === 'a' && !call[2].permission.canPublishSources.includes(TrackSource.CAMERA));
    const nextIndex = calls.findIndex(call => call[1] === 'b' && call[2].permission.canPublishSources.includes(TrackSource.CAMERA));
    expect(revokeIndex).toBeLessThan(nextIndex);
  });

  it('fails closed when camera revocation fails and retries without granting a second publisher', async () => {
    const { service, epoch } = await setup();
    const lease = (await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' }))!;
    fake.update.mockRejectedValueOnce(new Error('SFU timeout'));
    await expect(service.cameraCommand({ id: 'a', name: '甲' }, { action: 'release', epoch, participantSid: 'sid-a', leaseId: lease.id })).rejects.toThrow('SFU timeout');
    await expect(service.cameraCommand({ id: 'b', name: '乙' }, { action: 'acquire', epoch, participantSid: 'sid-b' })).rejects.toMatchObject({ code: 'CAMERA_BUSY' });
    await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'release', epoch, participantSid: 'sid-a', leaseId: lease.id });
    await expect(service.cameraCommand({ id: 'b', name: '乙' }, { action: 'acquire', epoch, participantSid: 'sid-b' })).resolves.toBeTruthy();
  });

  it('expires an abandoned reservation, but retains a renewed lease', async () => {
    const { service, epoch } = await setup();
    const lease = (await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' }))!;
    await vi.advanceTimersByTimeAsync(10_000);
    await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'renew', epoch, participantSid: 'sid-a', leaseId: lease.id });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(JSON.parse(fake.metadata).camera.id).toBe('a');
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.parse(fake.metadata).camera).toBeNull();
    expect(fake.participants[0].permission?.canPublishSources).toEqual([TrackSource.MICROPHONE]);
    await expect(service.cameraCommand({ id: 'b', name: '乙' }, { action: 'acquire', epoch, participantSid: 'sid-b' })).resolves.toBeTruthy();
  });

  it('reclaims disconnects and removes camera grants carried by a replacement session', async () => {
    const { service, epoch } = await setup();
    const lease = (await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' }))!;
    fake.participants[0] = { ...participant('a', 'replacement'), permission: { ...fake.participants[0].permission!, canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA] } } as ParticipantInfo;
    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(fake.metadata).camera).toBeNull();
    expect(fake.participants[0].permission?.canPublishSources).toEqual([TrackSource.MICROPHONE]);
    await expect(service.cameraCommand({ id: 'a', name: '甲' }, { action: 'renew', epoch, participantSid: 'sid-a', leaseId: lease.id })).rejects.toMatchObject({ code: 'NOT_WAITING' });
    await expect(service.cameraCommand({ id: 'b', name: '乙' }, { action: 'acquire', epoch, participantSid: 'sid-b' })).resolves.toBeTruthy();
  });

  it('reclaims the slot on expedition transfer and rejects grants if membership changes in flight', async () => {
    let waiting = true;
    const { service, epoch } = await setup(id => id !== 'a' || waiting);
    const update = fake.update.getMockImplementation()!;
    fake.update.mockImplementationOnce(async (...args: Parameters<typeof update>) => { const result = await update(...args); waiting = false; return result; });
    await expect(service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' })).rejects.toMatchObject({ code: 'CAMERA_SESSION_CHANGED' });
    expect(JSON.parse(fake.metadata).camera).toBeNull();
    expect(fake.participants[0].permission?.canPublishSources).toEqual([TrackSource.MICROPHONE]);
    waiting = true;
    await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' });
    waiting = false; await vi.advanceTimersByTimeAsync(1000);
    expect(fake.participants.some(member => member.identity === 'a')).toBe(false);
    expect(JSON.parse(fake.metadata).camera).toBeNull();
  });

  it('rejects stale epochs, impersonated participant sessions and forged renewals', async () => {
    const { service, epoch } = await setup();
    await expect(service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch: 'old', participantSid: 'sid-a' })).rejects.toMatchObject({ code: 'CAMERA_SESSION_CHANGED' });
    await expect(service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-b' })).rejects.toMatchObject({ code: 'NOT_WAITING' });
    const lease = (await service.cameraCommand({ id: 'a', name: '甲' }, { action: 'acquire', epoch, participantSid: 'sid-a' }))!;
    await expect(service.cameraCommand({ id: 'a', name: '甲' }, { action: 'renew', epoch, participantSid: 'sid-a', leaseId: 'forged' })).rejects.toMatchObject({ code: 'CAMERA_LEASE_LOST' });
    await service.removeParticipant('a');
    expect(JSON.parse(fake.metadata).camera).toBeNull();
    expect(lease.id).toBeTruthy();
  });
});
