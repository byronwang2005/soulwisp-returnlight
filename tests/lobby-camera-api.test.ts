import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceLobbyService } from '../apps/server/src/voice-lobby';
const fake = vi.hoisted(() => ({ session: vi.fn(), camera: vi.fn() }));
vi.mock('../apps/server/src/accounts', () => ({ AccountError: class extends Error {}, getSession: fake.session, auth: { handler: vi.fn() },
  advanceTutorial: vi.fn(), craft: vi.fn(), getCamp: vi.fn(), issueGameTicket: vi.fn(), saveLoadout: vi.fn(), savePresets: vi.fn() }));
vi.mock('../apps/server/src/db/index', () => ({ pool: { query: vi.fn() } }));
vi.mock('../apps/server/src/profile-store', () => ({ profileRepository: {} }));
vi.mock('../apps/server/src/waiting-room', () => ({ reserveWaiting: vi.fn() }));
import { createApi } from '../apps/server/src/api';
import { LobbyVoiceError } from '../apps/server/src/voice-lobby';
const command = { action: 'acquire', epoch: 'epoch', participantSid: 'sid-a' };
const lease = { id: 'lease', epoch: 'epoch', participantSid: 'sid-a' };
const app = () => createApi({ getRoom: () => undefined, voiceLobby: { cameraCommand: fake.camera } as unknown as VoiceLobbyService });
const post = (body: unknown, headers: Record<string, string> = {}) => app().request('/api/voice/lobby/camera', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); fake.session.mockResolvedValue({ user: { id: 'a', name: '甲' } }); fake.camera.mockResolvedValue(lease); });

describe('camera HTTP admission boundary without services', () => {
  it('uses the signed-in identity and returns a lease without accepting an identity override', async () => {
    const response = await post({ ...command, id: 'b' });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ lease });
    expect(fake.camera).toHaveBeenCalledWith({ id: 'a', name: '甲' }, expect.objectContaining(command));
    fake.camera.mockResolvedValue(null);
    expect(await (await post({ ...command, action: 'release', leaseId: lease.id })).json()).toEqual({ lease: null });
  });
  it('requires an authenticated same-origin JSON request', async () => {
    fake.session.mockResolvedValue(null); expect((await post(command)).status).toBe(401);
    expect((await post(command, { Origin: 'https://other.example.test' })).status).toBe(403);
    expect((await post(command, { 'Content-Type': 'text/plain' })).status).toBe(400);
    expect(fake.camera).not.toHaveBeenCalled();
  });
  it('rejects malformed commands before reaching the media service', async () => {
    for (const body of [null, {}, { ...command, action: 'steal' }, { ...command, participantSid: '' }, { ...command, epoch: 'x'.repeat(65) },
      { ...command, action: 'renew' }, { ...command, action: 'release', leaseId: 42 }]) {
      const response = await post(body); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: 'BAD_CAMERA_COMMAND' });
    }
    expect(fake.camera).not.toHaveBeenCalled();
  });
  it('preserves authoritative membership and camera contention errors', async () => {
    fake.camera.mockRejectedValueOnce(new LobbyVoiceError(403, 'NOT_WAITING', '请先加入等待区'));
    expect((await post(command)).status).toBe(403);
    fake.camera.mockRejectedValueOnce(new LobbyVoiceError(409, 'CAMERA_BUSY', '乙正在共享'));
    const response = await post(command); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'CAMERA_BUSY', message: '乙正在共享' });
  });
});
