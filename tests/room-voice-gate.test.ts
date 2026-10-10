import 'dotenv/config';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine, getConfig } from '@wangxu/rules';
import { ExpeditionRoom, setVoiceService } from '../apps/server/src/rooms.js';
import type { VoiceService } from '../apps/server/src/voice.js';
import { pool } from '../apps/server/src/db/index.js';

// These tests isolate the game phase barrier. Actual SFU/token/media permissions
// are exercised separately in voice.integration.test.ts against self-hosted LiveKit.
function council(closeRoom: () => Promise<boolean>) {
  const room = new ExpeditionRoom();
  room.roomId = 'voice-barrier-test';
  room.engine = new GameEngine({ roomId: room.roomId, invite: 'BARRIER', config: getConfig(4), seed: 1 });
  for (let index = 0; index < 4; index++) room.engine.addPlayer({ id: `barrier-${index}`, name: `守灯者${index}` });
  room.engine.phase = 'DISCUSS'; room.engine.chapter = 1; room.engine.remaining = .05;
  setVoiceService({ closeRoom, snapshot: () => ({ enabled: false, epoch: null }), syncRoom: async () => true } as unknown as VoiceService);
  return { room, step: () => (room as unknown as { step(): void }).step() };
}
async function promises() { for (let count = 0; count < 6; count++) await Promise.resolve(); }
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await pool.end(); });

describe('council close confirmation phase barrier', () => {
  it('waits for close confirmation even when creation has not exposed an epoch', async () => {
    let confirm!: (value: boolean) => void;
    const close = vi.fn(() => new Promise<boolean>(resolve => { confirm = resolve; }));
    const { room, step } = council(close);
    step();
    expect(close).toHaveBeenCalledOnce();
    expect(room.engine.phase).toBe('DISCUSS');
    expect(room.allowsVoiceAdmission()).toBe(false);
    step();
    expect(close).toHaveBeenCalledOnce();
    confirm(true); await promises(); step();
    expect(room.engine.phase).toBe('VOTE');
  });

  it('invalidates after five seconds of failed close confirmation', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const close = vi.fn(async () => false);
    const { room, step } = council(close);
    step(); await promises();
    expect(room.engine.phase).toBe('DISCUSS');
    expect(room.engine.result).toBeNull();
    now = 6001; step(); await promises();
    expect(room.engine.phase).toBe('RESULT');
    expect(room.engine.result?.winner).toBe('invalid');
    expect(room.engine.result?.reason).toContain('议会语音未能安全关闭');
  });
});
