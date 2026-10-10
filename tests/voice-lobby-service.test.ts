import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rooms: new Set<string>(), participants: [] as { identity: string }[],
  create: vi.fn(), list: vi.fn(), members: vi.fn(), remove: vi.fn(), delete: vi.fn() }));
vi.mock('livekit-server-sdk', async importOriginal => ({ ...await importOriginal<typeof import('livekit-server-sdk')>(),
  RoomServiceClient: class {
    createRoom = fake.create; listRooms = fake.list; listParticipants = fake.members;
    removeParticipant = fake.remove; deleteRoom = fake.delete;
  },
}));
import { VoiceLobbyService } from '../apps/server/src/voice-lobby.js';
const config = { serverUrl: 'http://test.invalid', publicUrl: 'wss://test.invalid', apiKey: 'unit-test-key', apiSecret: 'unit-test-secret-not-a-real-credential' };
beforeEach(() => {
  vi.clearAllMocks(); fake.rooms.clear(); fake.participants = [];
  fake.create.mockImplementation(async ({ name }: { name: string }) => { fake.rooms.add(name); return {}; });
  fake.list.mockImplementation(async (names: string[]) => [...fake.rooms].filter(name => names.includes(name)).map(name => ({ name })));
  fake.members.mockImplementation(async () => fake.participants);
  fake.remove.mockResolvedValue({});
  fake.delete.mockImplementation(async (name: string) => { fake.rooms.delete(name); });
});
describe('public voice lobby lifecycle failures', () => {
  it('coalesces public status requests without exposing identities or tokens', async () => {
    fake.participants = [{ identity: 'private-user' }];
    const service = new VoiceLobbyService(config);
    try {
      const statuses = await Promise.all([service.status(), service.status(), service.status()]);
      expect(fake.create).toHaveBeenCalledTimes(1); expect(fake.members).toHaveBeenCalledTimes(1);
      expect(statuses).toEqual(Array(3).fill({ available: true, online: 1, capacity: 10, url: config.publicUrl }));
      expect(fake.create.mock.calls[0]![0]).toMatchObject({ maxParticipants: 10 });
    } finally { await service.dispose(); }
  });
  it('tracks a creation that succeeded upstream but lost its response', async () => {
    fake.create.mockImplementationOnce(async ({ name }: { name: string }) => { fake.rooms.add(name); throw new Error('lost response'); });
    const service = new VoiceLobbyService(config);
    expect(await service.status()).toMatchObject({ available: false, url: null });
    const ticket = await service.issueToken({ id: 'user', name: '归灯者' });
    expect(ticket.epoch).toBeTruthy(); expect(fake.create).toHaveBeenCalledTimes(1);
    await service.dispose(); expect(fake.rooms.size).toBe(0);
  });
  it('waits for an in-flight creation and refuses its ticket when shutdown begins', async () => {
    let created!: () => void, release!: () => void;
    const creating = new Promise<void>(resolve => { created = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    fake.create.mockImplementationOnce(async ({ name }: { name: string }) => { created(); await barrier; fake.rooms.add(name); return {}; });
    const service = new VoiceLobbyService(config);
    const admission = service.issueToken({ id: 'user', name: '归灯者' });
    const rejection = expect(admission).rejects.toMatchObject({ status: 503 });
    await creating; const shutdown = service.dispose(); release();
    await rejection; await shutdown;
    expect(fake.rooms.size).toBe(0); expect(await service.status()).toMatchObject({ available: false });
  });
  it('retries only owned names and can finish cleanup after a deletion outage', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new VoiceLobbyService(config);
    try {
      await service.status(); const own = [...fake.rooms][0]!; fake.rooms.add('foreign-lobby');
      fake.delete.mockRejectedValue(new Error('SFU outage'));
      await service.dispose(); expect(fake.delete).toHaveBeenCalledTimes(3); expect(fake.rooms.has(own)).toBe(true);
      expect(warning).toHaveBeenCalledWith('[voice-lobby] shutdown cleanup incomplete');
      fake.delete.mockImplementation(async (name: string) => { fake.rooms.delete(name); });
      await service.dispose(); expect(fake.rooms).toEqual(new Set(['foreign-lobby']));
      expect(fake.delete.mock.calls.every(([name]) => name === own)).toBe(true);
    } finally { warning.mockRestore(); }
  });
  it('checks expedition membership again after awaiting the SFU', async () => {
    let active = false;
    fake.members.mockImplementationOnce(async () => { active = true; return []; });
    const service = new VoiceLobbyService(config, () => active);
    try { await expect(service.issueToken({ id: 'user', name: '归灯者' })).rejects.toMatchObject({ status: 403, code: 'IN_EXPEDITION' }); }
    finally { await service.dispose(); }
  });
});
