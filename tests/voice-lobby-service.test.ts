import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rooms: new Set<string>(), participants: [] as { identity: string }[],
  metadata: new Map<string, string>(),
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
  vi.clearAllMocks(); fake.rooms.clear(); fake.metadata.clear(); fake.participants = [];
  fake.create.mockImplementation(async ({ name, metadata }: { name: string; metadata: string }) => { fake.rooms.add(name); fake.metadata.set(name, metadata); return {}; });
  fake.list.mockImplementation(async (names?: string[]) => [...fake.rooms].filter(name => !names || names.includes(name)).map(name => ({ name, metadata: fake.metadata.get(name) ?? '' })));
  fake.members.mockImplementation(async () => fake.participants);
  fake.remove.mockResolvedValue({});
  fake.delete.mockImplementation(async (name: string) => { fake.rooms.delete(name); });
});
describe('public voice lobby lifecycle failures', () => {
  it('closes the previous instance before admitting listeners and preserves other owners', async () => {
    const previous = new VoiceLobbyService(config);
    await previous.status(); const old = [...fake.rooms][0]!;
    fake.rooms.add('council-test');
    const foreign = 'public-lobby-foreign-epoch'; fake.rooms.add(foreign);
    fake.metadata.set(foreign, JSON.stringify({ kind: 'public-lobby', owner: 'another-app', serverInstanceId: 'foreign', epoch: 'epoch' }));
    const current = new VoiceLobbyService(config, () => false, { cleanupPreviousInstances: true });
    try {
      await current.issueToken({ id: 'user', name: '归灯者' });
      expect(fake.rooms.has(old)).toBe(false);
      expect(fake.rooms.has(foreign)).toBe(true); expect(fake.rooms.has('council-test')).toBe(true);
      expect(fake.delete).toHaveBeenCalledExactlyOnceWith(old);
      expect([...fake.rooms].filter(name => name !== foreign && name !== 'council-test')).toHaveLength(1);
    } finally { await current.dispose(); await previous.dispose(); }
  });
  it('does not create a split lobby when previous-instance deletion fails', async () => {
    const previous = new VoiceLobbyService(config); await previous.status();
    const old = [...fake.rooms][0]!;
    fake.delete.mockRejectedValueOnce(new Error('delete failed'));
    const current = new VoiceLobbyService(config, () => false, { cleanupPreviousInstances: true });
    try {
      expect(await current.status()).toMatchObject({ available: false });
      expect(fake.create).toHaveBeenCalledTimes(1); expect(fake.rooms.has(old)).toBe(true);
      await current.issueToken({ id: 'user', name: '归灯者' });
      expect(fake.rooms.has(old)).toBe(false); expect(fake.rooms.size).toBe(1);
    } finally { await current.dispose(); await previous.dispose(); }
  });
  it('migrates only correctly tagged legacy lobby names', async () => {
    const legacy = 'public-lobby-old-instance-old-epoch';
    fake.rooms.add(legacy); fake.metadata.set(legacy, JSON.stringify({ kind: 'public-lobby', serverInstanceId: 'old-instance', epoch: 'old-epoch' }));
    fake.rooms.add('unrelated'); fake.metadata.set('unrelated', fake.metadata.get(legacy)!);
    const current = new VoiceLobbyService(config, () => false, { cleanupPreviousInstances: true, cleanupLegacy: true });
    try {
      await current.status(); expect(fake.rooms.has(legacy)).toBe(false); expect(fake.rooms.has('unrelated')).toBe(true);
    } finally { await current.dispose(); }
  });
  it('coalesces public status requests without exposing identities or tokens', async () => {
    fake.participants = [{ identity: 'private-user' }];
    const service = new VoiceLobbyService(config);
    try {
      const statuses = await Promise.all([service.status(), service.status(), service.status()]);
      expect(fake.create).toHaveBeenCalledTimes(1); expect(fake.members).toHaveBeenCalledTimes(1);
      expect(statuses).toEqual(Array(3).fill({ available: true, online: 1, capacity: 0, url: config.publicUrl }));
      expect(fake.create.mock.calls[0]![0]).toMatchObject({ maxParticipants: 0 });
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
  it('admits an eleventh listener and revokes removed listeners tokens', async () => {
    fake.participants=Array.from({length:11},(_,i)=>({identity:`user-${i}`}));
    const service=new VoiceLobbyService(config);
    try { await expect(service.issueToken({id:'extra',name:'候场'})).resolves.toHaveProperty('token');await service.removeParticipant('extra');expect(fake.remove.mock.calls[0][2]).toHaveProperty('revokeTokenTs'); }
    finally { await service.dispose(); }
  });
  it('does not block text-only players when media has never issued them a ticket', async () => {
    const service=new VoiceLobbyService(config);fake.create.mockRejectedValue(new Error('offline'));
    try { expect(await service.status()).toMatchObject({available:false});await expect(service.removeParticipant('text-only')).resolves.toBeUndefined();expect(fake.remove).not.toHaveBeenCalled(); }
    finally { await service.dispose(); }
  });
  it('reports failed media removal instead of admitting a player with a live waiting track', async () => {
    const service=new VoiceLobbyService(config);
    try { await service.issueToken({id:'user',name:'曾连接语音'});fake.remove.mockRejectedValue(new Error('SFU outage'));await expect(service.removeParticipant('user')).rejects.toMatchObject({status:503}); }
    finally { await service.dispose(); }
  });
  it('removes active expedition users who rejoin with an earlier waiting token', async () => {
    vi.useFakeTimers();const service=new VoiceLobbyService(config,id=>id==='playing');
    try { await service.status();fake.participants=[{identity:'playing'},{identity:'waiting'}];await vi.advanceTimersByTimeAsync(1000);expect(fake.remove).toHaveBeenCalledExactlyOnceWith([...fake.rooms][0],'playing',expect.objectContaining({revokeTokenTs:expect.any(BigInt)})); }
    finally { await service.dispose();vi.useRealTimers(); }
  });
  it('checks waiting membership again after the SFU request', async () => {
    let waiting=true;fake.members.mockImplementationOnce(async()=>{waiting=false;return [];});
    const service=new VoiceLobbyService(config,()=>false,{canJoin:()=>waiting});
    try { await expect(service.issueToken({id:'user',name:'离厅者'})).rejects.toMatchObject({status:403,code:'NOT_WAITING'}); }
    finally { await service.dispose(); }
  });
  it('checks expedition membership again after awaiting the SFU', async () => {
    let active = false;
    fake.members.mockImplementationOnce(async () => { active = true; return []; });
    const service = new VoiceLobbyService(config, () => active);
    try { await expect(service.issueToken({ id: 'user', name: '归灯者' })).rejects.toMatchObject({ status: 403, code: 'IN_EXPEDITION' }); }
    finally { await service.dispose(); }
  });
});
