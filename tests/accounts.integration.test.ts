import 'dotenv/config';
import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { Settlement } from '@wangxu/shared';
import { advanceTutorial, craft, getCamp, issueGameTicket, saveLoadout, savePresets, settleMatch, verifyGameTicket } from '../apps/server/src/accounts.js';
import { createApi } from '../apps/server/src/api.js';
import { db, pool, migrateDatabase } from '../apps/server/src/db/index.js';
import { camps, matches, user } from '../apps/server/src/db/schema.js';

const runId = randomUUID();
const origin = process.env.AUTH_BASE_URL ?? 'http://localhost:5173';
const accounts: { id: string; cookie: string; email: string }[] = [];
const matchIds: string[] = [];
const api = createApi({ getRoom: () => undefined });
function request(path: string, body?: unknown, cookie?: string) {
  return api.request(new Request(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
function settlement(winner: Settlement['winner'] = 'wolf'): Settlement {
  const matchId = `accounts-test-${runId}-${randomUUID()}`;
  matchIds.push(matchId);
  return { matchId, ruleVersion: 'integration', mapSeed: 0xffffffff, winner, reason: '集成验证', events: [], players: accounts.slice(0, 4).map((account, index) => ({
    id: account.id, faction: index === 0 ? 'wolf' : 'human', sealed: index === 2, profession: 'warden',
    storedValue: index === 0 ? 3 : index === 2 ? 6 : 0, carriedValue: index === 0 ? 20 : 9,
    lootIds: [`${matchId}-loot-${index}`],
  })) };
}

describe('persistent PostgreSQL accounts and transactions', () => {
  beforeAll(async () => {
    // This suite deliberately requires a real database; npm run setup creates the isolated local cluster.
    await pool.query('SELECT 1');
    await migrateDatabase();
    for (let index = 0; index < 5; index++) {
      const email = `accounts-${runId}-${index}@example.net`;
      const response = await request('/api/auth/sign-up/email', { name: `归灯测试者${index}`, email, password: `Test-only-${runId}` });
      const body = await response.json() as { user?: { id: string }; message?: string };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.user?.id).toBeTruthy();
      accounts.push({ id: body.user!.id, email, cookie: response.headers.get('set-cookie')!.split(';')[0]! });
    }
  }, 30_000);
  afterAll(async () => {
    try {
      if (matchIds.length) await db.delete(matches).where(inArray(matches.id, matchIds));
      if (accounts.length) await db.delete(user).where(inArray(user.id, accounts.map(account => account.id)));
    } finally { await pool.end(); }
  });

  it('persists a Chinese display name, zero materials, and a password-backed session', async () => {
    const camp = await getCamp(accounts[0]!.id);
    expect(camp).toMatchObject({ displayName: '归灯测试者0', fragments: 0, secrets: 0, cosmetics: ['base'], research: [], matches: 0, wins: 0 });
    const response = await request('/api/auth/sign-in/email', { email: accounts[0]!.email, password: `Test-only-${runId}` });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const persistent = await request('/api/camp', undefined, cookie);
    expect(persistent.status).toBe(200);
    expect(await persistent.json()).toEqual(camp);
    const wrong = await request('/api/auth/sign-in/email', { email: accounts[0]!.email, password: 'incorrect-password' });
    expect(wrong.status).toBe(401);
    expect((await request('/api/camp')).status).toBe(401);
    expect((await request('/api/health')).status).toBe(200);
  });

  it('settles a wolf win atomically, including sealed humans, and survives simultaneous retries', async () => {
    const match = settlement();
    const before = await Promise.all(match.players.map(player => getCamp(player.id)));
    const [first, retry] = await Promise.all([settleMatch(match), settleMatch(match)]);
    expect(first).toEqual(retry);
    expect(first[accounts[0]!.id]).toEqual({ fragments: 40, secrets: 2 });
    expect(first[accounts[1]!.id]).toEqual({ fragments: 10, secrets: 1 });
    expect(first[accounts[2]!.id]).toEqual({ fragments: 11, secrets: 1 });
    for (let index = 0; index < match.players.length; index++) {
      const camp = await getCamp(match.players[index]!.id), reward = first[match.players[index]!.id]!;
      expect(camp.fragments).toBe(before[index]!.fragments + reward.fragments);
      expect(camp.secrets).toBe(before[index]!.secrets + reward.secrets);
      expect(camp.matches).toBe(before[index]!.matches + 1);
      expect(camp.wins).toBe(before[index]!.wins + (index === 0 ? 1 : 0));
    }
    await expect(settleMatch({ ...match, reason: 'changed after commit' })).rejects.toMatchObject({ code: 'SETTLEMENT_CONFLICT' });
    expect((await pool.query('SELECT map_seed, player_count FROM matches WHERE id=$1', [match.matchId])).rows[0]).toEqual({ map_seed: '4294967295', player_count: 4 });
    await expect(settleMatch({ ...match, mapSeed: 42 })).rejects.toMatchObject({ code: 'SETTLEMENT_CONFLICT' });
  });

  it('stores map seed zero and rejects values outside uint32 before creating a settlement', async () => {
    const zero = { ...settlement('human'), mapSeed: 0 };
    await settleMatch(zero);
    expect((await pool.query('SELECT map_seed, player_count FROM matches WHERE id=$1', [zero.matchId])).rows[0]).toEqual({ map_seed: '0', player_count: 4 });
    for (const mapSeed of [-1, 0x100000000, 1.5, Number.NaN]) {
      const invalid = { ...settlement(), mapSeed };
      await expect(settleMatch(invalid)).rejects.toMatchObject({ code: 'BAD_SETTLEMENT' });
      expect((await pool.query('SELECT 1 FROM matches WHERE id=$1', [invalid.matchId])).rowCount).toBe(0);
    }
  });

  it('grants no currency, progress, or loot redemption for an invalid match', async () => {
    const match = settlement('invalid');
    const before = await Promise.all(match.players.map(player => getCamp(player.id)));
    const reward = await settleMatch(match);
    expect(Object.values(reward)).toEqual(Array(4).fill({ fragments: 0, secrets: 0 }));
    expect(await Promise.all(match.players.map(player => getCamp(player.id)))).toEqual(before);
    expect((await pool.query('SELECT 1 FROM redeemed_loot WHERE match_id=$1', [match.matchId])).rowCount).toBe(0);
  });

  it('rolls back the whole match when one physical loot ID is redeemed twice', async () => {
    const good = settlement('human');
    await settleMatch(good);
    const duplicate = settlement('wolf');
    duplicate.players[1]!.lootIds = good.players[1]!.lootIds;
    const before = await Promise.all(duplicate.players.map(player => getCamp(player.id)));
    await expect(settleMatch(duplicate)).rejects.toThrow();
    expect(await Promise.all(duplicate.players.map(player => getCamp(player.id)))).toEqual(before);
    expect((await pool.query('SELECT 1 FROM matches WHERE id=$1', [duplicate.matchId])).rowCount).toBe(0);
  });

  it('serializes concurrent spending and makes retried requests charge once', async () => {
    const id = accounts[4]!.id;
    await getCamp(id);
    await db.update(camps).set({ fragments: 40, secrets: 0 }).where(eq(camps.userId, id));
    const attempts = await Promise.allSettled([craft(id, 'outfit-warden', `${runId}-outfit-a`), craft(id, 'outfit-scout', `${runId}-outfit-b`)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getCamp(id)).fragments).toBe(0);
    await db.update(camps).set({ fragments: 20 }).where(eq(camps.userId, id));
    const requestId = `${runId}-first-thread`;
    await Promise.all([craft(id, 'first-thread', requestId), craft(id, 'first-thread', requestId)]);
    expect((await getCamp(id)).fragments).toBe(10);
    await expect(craft(id, 'camp-lantern', requestId)).rejects.toMatchObject({ code: 'REQUEST_REUSED' });
    await craft(id, 'first-thread', `${runId}-already-owned`);
    expect((await getCamp(id)).fragments).toBe(10);
  });

  it('charges research and unlocks its skin, while free standard forms remain available', async () => {
    const id = accounts[3]!.id;
    const trial = await saveLoadout(id, { cosmeticId: 'base', profession: 'warden', form: 1 });
    expect(trial.equipment.form).toBe(1);
    expect(trial.research).toEqual([]);
    await db.update(camps).set({ fragments: 60, secrets: 6 }).where(eq(camps.userId, id));
    const researched = await craft(id, 'research-warden', `${runId}-research`);
    expect(researched.fragments).toBe(0);
    expect(researched.secrets).toBe(0);
    expect(researched.research).toContain('research-warden');
    expect(researched.cosmetics).toContain('silver-warden');
    expect((await saveLoadout(id, { cosmeticId: 'silver-warden', profession: 'warden', form: 1 })).equipment.cosmeticId).toBe('silver-warden');
    await expect(saveLoadout(id, { cosmeticId: 'silver-scout', profession: 'scout', form: 0 })).rejects.toMatchObject({ code: 'COSMETIC_NOT_OWNED' });
  });

  it('persists up to five account presets through the API and refreshed camp reads', async () => {
    const account = accounts[3]!, before = await getCamp(account.id);
    const presets = [{ name: '  夜行拾光  ', cosmeticId: 'silver-warden', profession: 'warden' as const, form: 1 },
      { name: '轻装归途', cosmeticId: 'base', profession: 'scout' as const, form: 0 }];
    const requestId = `${runId}-presets`;
    const response = await request('/api/presets', { presets, requestId }, account.cookie);
    expect(response.status).toBe(200);
    const expected = presets.map(preset => ({ ...preset, name: preset.name.trim() }));
    expect((await response.json()).presets).toEqual(expected);
    const refreshed = await request('/api/camp', undefined, account.cookie);
    expect((await refreshed.json()).presets).toEqual(expected);
    expect((await pool.query('SELECT presets FROM camps WHERE user_id=$1', [account.id])).rows[0].presets).toEqual(expected);
    const retry = await savePresets(account.id, presets, requestId);
    expect(retry.presets).toEqual(expected); expect(retry.fragments).toBe(before.fragments); expect(retry.secrets).toBe(before.secrets);
    await expect(savePresets(account.id, [], requestId)).rejects.toMatchObject({ code: 'REQUEST_REUSED' });
    expect((await savePresets(account.id, [], `${runId}-remove-presets`)).presets).toEqual([]);
  });

  it('rejects malformed preset names, count, unavailable cosmetics and incompatible skills without changing storage', async () => {
    const id = accounts[3]!.id, valid = { name: '归灯', cosmeticId: 'base', profession: 'warden' as const, form: 0 };
    await savePresets(id, [valid], `${runId}-valid-preset`);
    const before = await getCamp(id);
    for (const presets of [Array(6).fill(valid), [{ ...valid, name: ' ' }], [{ ...valid, name: '絮'.repeat(25) }], [{ ...valid, name: '换\n装' }],
      [{ ...valid, cosmeticId: 'unowned' }], [{ ...valid, form: 99 }], [{ ...valid, cosmeticId: 'silver-warden', profession: 'scout' as const }]]) {
      await expect(savePresets(id, presets, randomUUID())).rejects.toThrow();
      expect(await getCamp(id)).toEqual(before);
    }
  });

  it('completes six ordered tutorial stages once, without minting money', async () => {
    const id = accounts[4]!.id;
    const before = await getCamp(id);
    await expect(advanceTutorial(id, 6, true, `${runId}-skip-tutorial`)).rejects.toMatchObject({ code: 'TUTORIAL_ORDER' });
    for (let step = 1; step <= 6; step++) await advanceTutorial(id, step, step === 6, `${runId}-tutorial-${step}`);
    const camp = await advanceTutorial(id, 6, true, `${runId}-tutorial-again`);
    expect(camp.tutorialCompleted).toBe(true);
    expect(camp.tutorialStep).toBe(6);
    expect(camp.cosmetics.filter(cosmetic => cosmetic === 'tutorial-lantern')).toHaveLength(1);
    expect(camp.fragments).toBe(before.fragments);
    expect(camp.secrets).toBe(before.secrets);
  });

  it('rejects forged/expired tickets and gates voice by actual room membership and phase', async () => {
    const ticket = issueGameTicket(accounts[0]!.id, '归灯测试者0');
    expect(verifyGameTicket(ticket).userId).toBe(accounts[0]!.id);
    expect(() => verifyGameTicket(`${ticket.slice(0, -5)}wrong`)).toThrow();
    const payload = Buffer.from(JSON.stringify({ userId: accounts[0]!.id, name: '归灯测试者0', expiresAt: Date.now() - 1, nonce: runId })).toString('base64url');
    const signature = createHmac('sha256', process.env.AUTH_SECRET!).update(payload).digest('base64url');
    expect(() => verifyGameTicket(`${payload}.${signature}`)).toThrow('过期');
    expect((await request('/api/game-ticket', {}, accounts[0]!.cookie)).status).toBe(200);
    const voiceApi = createApi({ getRoom: () => ({ getVoiceState: () => ({ phase: 'EXPLORE', chapter: 1, speakerId: null, players: [{ id: accounts[0]!.id, name: '归灯测试者0', sealed: false }] }) }) });
    const denied = await voiceApi.request(new Request(`${origin}/api/voice/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: accounts[0]!.cookie }, body: JSON.stringify({ roomId: 'fake' }) }));
    expect(denied.status).toBe(403);
  });
});
