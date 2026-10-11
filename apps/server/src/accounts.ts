import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { PROFESSION_NAMES, RECIPES, type CampData, type CampPreset, type Profession, type Settlement } from '@wangxu/shared';
import { professionForms } from '@wangxu/rules';
import { db } from './db/index.js';
import * as schema from './db/schema.js';

const secret = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters; run npm run setup.');
const authBase = process.env.AUTH_BASE_URL ?? process.env.AUTH_URL ?? process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:5180';
const trustedOrigins = [...new Set([authBase, ...(process.env.ALLOWED_ORIGINS ?? process.env.TRUSTED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean)])];
export const auth = betterAuth({
  secret, baseURL: authBase, basePath: '/api/auth',
  disabledPaths: ['/update-user'],
  database: drizzleAdapter(db, { provider: 'pg', transaction: true, schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification } }),
  trustedOrigins,
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
  rateLimit: { customRules: {
    '/sign-up/email': { window: 60, max: 12 },
    '/sign-in/email': { window: 60, max: 20 },
  } },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  user: { deleteUser: { enabled: false } },
});
export const getSession = (headers: Headers) => auth.api.getSession({ headers });

export class AccountError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 401 | 403 | 404 | 409 = 400) { super(message); }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = (values: string[]) => [...new Set(values)];
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockCamp(tx: Transaction, userId: string) {
  await tx.insert(schema.camps).values({ userId }).onConflictDoNothing();
  const [camp] = await tx.select().from(schema.camps).where(eq(schema.camps.userId, userId)).for('update');
  if (!camp) throw new AccountError('NO_ACCOUNT', '账户不存在', 404);
  return camp;
}
async function campView(tx: Transaction | typeof db, userId: string): Promise<CampData> {
  const [row] = await tx.select({ camp: schema.camps, name: schema.user.name }).from(schema.camps)
    .innerJoin(schema.user, eq(schema.user.id, schema.camps.userId)).where(eq(schema.camps.userId, userId));
  if (!row) throw new AccountError('NO_ACCOUNT', '账户不存在', 404);
  const { userId: _, updatedAt: __, ...data } = row.camp;
  return { ...data, displayName: row.name };
}
export async function getCamp(userId: string): Promise<CampData> {
  await db.insert(schema.camps).values({ userId }).onConflictDoNothing();
  return campView(db, userId);
}

/** Camp row lock serializes spending; the request key and its payload share the same transaction. */
async function mutateCamp(userId: string, operation: string, payload: unknown, requestId: string | undefined,
  apply: (tx: Transaction, camp: typeof schema.camps.$inferSelect) => Promise<void>): Promise<CampData> {
  if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128)) throw new AccountError('BAD_REQUEST_ID', '请求编号须为1–128个字符');
  return db.transaction(async tx => {
    const camp = await lockCamp(tx, userId);
    const payloadHash = hash(payload);
    if (requestId !== undefined) {
      const [previous] = await tx.select().from(schema.campRequests).where(and(eq(schema.campRequests.userId, userId), eq(schema.campRequests.requestId, requestId)));
      if (previous) {
        if (previous.operation !== operation || previous.payloadHash !== payloadHash) throw new AccountError('REQUEST_REUSED', '同一请求编号不能用于另一操作', 409);
        return campView(tx, userId);
      }
    }
    await apply(tx, camp);
    if (requestId !== undefined) await tx.insert(schema.campRequests).values({ userId, requestId, operation, payloadHash });
    return campView(tx, userId);
  });
}
export async function craft(userId: string, recipeId: string, requestId: string): Promise<CampData> {
  const recipe = RECIPES.find(candidate => candidate.id === recipeId);
  if (!recipe) throw new AccountError('NO_RECIPE', '未找到这份蓝图', 404);
  return mutateCamp(userId, 'craft', { recipeId }, requestId, async (tx, camp) => {
    const owned = recipe.kind === 'research' ? camp.research.includes(recipe.grants) : camp.cosmetics.includes(recipe.grants);
    if (owned) return;
    if (camp.fragments < recipe.fragments || camp.secrets < recipe.secrets) throw new AccountError('INSUFFICIENT_MATERIALS', '营地材料不足', 409);
    await tx.update(schema.camps).set({
      fragments: camp.fragments - recipe.fragments, secrets: camp.secrets - recipe.secrets,
      research: recipe.kind === 'research' ? unique([...camp.research, recipe.grants]) : camp.research,
      cosmetics: recipe.kind === 'research' ? unique([...camp.cosmetics, `silver-${recipe.profession}`]) : unique([...camp.cosmetics, recipe.grants]),
      updatedAt: new Date(),
    }).where(eq(schema.camps.userId, userId));
  });
}
export async function saveLoadout(userId: string, equipment: CampData['equipment']): Promise<CampData> {
  if (!Object.hasOwn(PROFESSION_NAMES, equipment.profession) || !professionForms(equipment.profession).includes(equipment.form)) throw new AccountError('BAD_LOADOUT', '职业或技能形态无效');
  return mutateCamp(userId, 'loadout', equipment, undefined, async (tx, camp) => {
    if (!camp.cosmetics.includes(equipment.cosmeticId) || equipment.cosmeticId === 'camp-lantern') throw new AccountError('COSMETIC_NOT_OWNED', '尚未获得这个可穿戴外观', 403);
    const professionCosmetic = /^(?:outfit|silver)-(.+)$/.exec(equipment.cosmeticId)?.[1];
    if (professionCosmetic && professionCosmetic !== equipment.profession) throw new AccountError('COSMETIC_PROFESSION', '此外观属于另一职业');
    // Both skill forms are available to every standard-match player, regardless of research ownership.
    await tx.update(schema.camps).set({ equipment: { cosmeticId: equipment.cosmeticId, profession: equipment.profession, form: equipment.form }, updatedAt: new Date() }).where(eq(schema.camps.userId, userId));
  });
}
export async function savePresets(userId: string, presets: CampPreset[], requestId: string): Promise<CampData> {
  if (!Array.isArray(presets) || presets.length > 5) throw new AccountError('BAD_PRESETS', '最多保存五套配装预设');
  const normalized = presets.map(preset => {
    if (!preset || typeof preset.name !== 'string' || typeof preset.cosmeticId !== 'string' || typeof preset.profession !== 'string' || typeof preset.form !== 'number') throw new AccountError('BAD_PRESETS', '配装预设数据无效');
    const name = preset.name.trim();
    if ([...name].length < 1 || [...name].length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw new AccountError('BAD_PRESET_NAME', '预设名称须为1–24个字符');
    if (!Object.hasOwn(PROFESSION_NAMES, preset.profession) || !professionForms(preset.profession).includes(preset.form)) throw new AccountError('BAD_LOADOUT', '职业或技能形态无效');
    return { name, cosmeticId: preset.cosmeticId, profession: preset.profession, form: preset.form };
  });
  return mutateCamp(userId, 'presets', { presets: normalized }, requestId, async (tx, camp) => {
    for (const preset of normalized) {
      if (!camp.cosmetics.includes(preset.cosmeticId) || preset.cosmeticId === 'camp-lantern') throw new AccountError('COSMETIC_NOT_OWNED', '尚未获得这个可穿戴外观', 403);
      const professionCosmetic = /^(?:outfit|silver)-(.+)$/.exec(preset.cosmeticId)?.[1];
      if (professionCosmetic && professionCosmetic !== preset.profession) throw new AccountError('COSMETIC_PROFESSION', '此外观属于另一职业');
    }
    await tx.update(schema.camps).set({ presets: normalized, updatedAt: new Date() }).where(eq(schema.camps.userId, userId));
  });
}
export const TUTORIAL_STEPS = 6;
export async function advanceTutorial(userId: string, step: number, complete: boolean, requestId: string): Promise<CampData> {
  if (!Number.isInteger(step) || step < 0 || step > TUTORIAL_STEPS || typeof complete !== 'boolean') throw new AccountError('BAD_TUTORIAL', '教程步骤无效');
  return mutateCamp(userId, 'tutorial', { step, complete }, requestId, async (tx, camp) => {
    if (step > camp.tutorialStep + 1 || (complete && step !== TUTORIAL_STEPS)) throw new AccountError('TUTORIAL_ORDER', '请按顺序完成教程');
    await tx.update(schema.camps).set({ tutorialStep: Math.max(camp.tutorialStep, step), tutorialCompleted: camp.tutorialCompleted || complete,
      cosmetics: complete ? unique([...camp.cosmetics, 'tutorial-lantern']) : camp.cosmetics, updatedAt: new Date() }).where(eq(schema.camps.userId, userId));
  });
}

export interface GameTicket { userId: string; name: string; expiresAt: number; nonce: string }
export function issueGameTicket(userId: string, name: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, name, expiresAt: Date.now() + 60_000, nonce: randomUUID() } satisfies GameTicket)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret!).update(payload).digest('base64url')}`;
}
export function verifyGameTicket(ticket: string): GameTicket {
  if (typeof ticket !== 'string' || ticket.length > 4096) throw new AccountError('BAD_TICKET', '远征票据无效', 401);
  const [payload, signature, extra] = ticket.split('.');
  if (!payload || !signature || extra) throw new AccountError('BAD_TICKET', '远征票据无效', 401);
  const expected = createHmac('sha256', secret!).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new AccountError('BAD_TICKET', '远征票据无效', 401);
  let parsed: GameTicket;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GameTicket; } catch { throw new AccountError('BAD_TICKET', '远征票据无效', 401); }
  if (typeof parsed.userId !== 'string' || typeof parsed.name !== 'string' || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now() || parsed.expiresAt > Date.now() + 60_000) throw new AccountError('EXPIRED_TICKET', '远征票据已过期', 401);
  return parsed;
}

export type Reward = { fragments: number; secrets: number };
export async function settleMatch(settlement: Settlement): Promise<Record<string, Reward>> {
  if (!settlement.matchId || !['human', 'wolf', 'invalid'].includes(settlement.winner) || settlement.players.length < 1 || new Set(settlement.players.map(player => player.id)).size !== settlement.players.length) throw new AccountError('BAD_SETTLEMENT', '结算数据无效');
  for (const player of settlement.players) if (![player.storedValue, player.carriedValue].every(value => Number.isSafeInteger(value) && value >= 0)) throw new AccountError('BAD_SETTLEMENT', '物资价值无效');
  if (settlement.mapSeed !== undefined && (!Number.isInteger(settlement.mapSeed) || settlement.mapSeed < 0 || settlement.mapSeed > 0xffffffff)) throw new AccountError('BAD_SETTLEMENT', '地图种子须为有效uint32');
  const lootIds = settlement.players.flatMap(player => player.lootIds ?? []);
  if (settlement.winner !== 'invalid' && (lootIds.some(id => typeof id !== 'string' || !id) || new Set(lootIds).size !== lootIds.length)) throw new AccountError('DUPLICATE_LOOT', '同一件物资不能由多个席位重复持有');
  const payloadHash = hash(settlement);
  return db.transaction(async tx => {
    const inserted = await tx.insert(schema.matches).values({ id: settlement.matchId, ruleVersion: settlement.ruleVersion, winner: settlement.winner,
      reason: settlement.reason, payloadHash, events: settlement.events, mapSeed: settlement.mapSeed ?? null, playerCount: settlement.players.length }).onConflictDoNothing().returning({ id: schema.matches.id });
    if (!inserted.length) {
      const [previous] = await tx.select().from(schema.matches).where(eq(schema.matches.id, settlement.matchId));
      if (previous?.payloadHash !== payloadHash) throw new AccountError('SETTLEMENT_CONFLICT', '同一远征的结算内容不一致', 409);
      const rewards = await tx.select().from(schema.matchRewards).where(eq(schema.matchRewards.matchId, settlement.matchId));
      return Object.fromEntries(rewards.map(reward => [reward.userId, { fragments: reward.fragments, secrets: reward.secrets }]));
    }
    const result: Record<string, Reward> = {};
    // Stable lock order also prevents deadlocks if the same account joins successive rooms.
    for (const player of [...settlement.players].sort((a, b) => a.id.localeCompare(b.id))) {
      await lockCamp(tx, player.id);
      const won = settlement.winner === player.faction;
      const valid = settlement.winner !== 'invalid';
      const privateValue = won ? Math.min(10, player.storedValue + player.carriedValue) : Math.floor(Math.min(10, player.storedValue) * .25);
      const reward = { fragments: valid ? 10 + (won ? 20 : 0) + privateValue : 0, secrets: valid ? 1 + (won ? 1 : 0) : 0 };
      if (valid) {
        for (const lootId of unique(player.lootIds ?? [])) await tx.insert(schema.redeemedLoot).values({ lootId, matchId: settlement.matchId, userId: player.id });
        await tx.update(schema.camps).set({ fragments: sql`${schema.camps.fragments} + ${reward.fragments}`, secrets: sql`${schema.camps.secrets} + ${reward.secrets}`,
          matches: sql`${schema.camps.matches} + 1`, wins: sql`${schema.camps.wins} + ${won ? 1 : 0}`, updatedAt: new Date() }).where(eq(schema.camps.userId, player.id));
      }
      await tx.insert(schema.matchRewards).values({ matchId: settlement.matchId, userId: player.id, ...reward, won: valid && won });
      result[player.id] = reward;
    }
    return result;
  });
}
