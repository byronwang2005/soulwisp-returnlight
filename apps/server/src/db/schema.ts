import { bigint, boolean, check, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CampData, CampPreset, Evidence, Settlement } from '@wangxu/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// The property names are Better Auth's model fields; SQL names can remain snake_case.
export const user = pgTable('auth_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});
export const session = pgTable('auth_session', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), ipAddress: text('ip_address'), userAgent: text('user_agent'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});
export const account = pgTable('auth_account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'), password: text('password'), createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [uniqueIndex('auth_account_provider_identity').on(table.providerId, table.accountId)]);
export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
});

export const camps = pgTable('camps', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  fragments: integer('fragments').notNull().default(0), secrets: integer('secrets').notNull().default(0),
  cosmetics: text('cosmetics').array().notNull().default(sql`ARRAY['base']::text[]`),
  research: text('research').array().notNull().default(sql`ARRAY[]::text[]`),
  equipment: jsonb('equipment').$type<CampData['equipment']>().notNull().default({ cosmeticId: 'base', profession: 'warden', form: 0 }),
  presets: jsonb('presets').$type<CampPreset[]>().notNull().default([]),
  tutorialStep: integer('tutorial_step').notNull().default(0), tutorialCompleted: boolean('tutorial_completed').notNull().default(false),
  matches: integer('matches').notNull().default(0), wins: integer('wins').notNull().default(0), updatedAt: updatedAt(),
}, table => [check('camp_nonnegative', sql`${table.fragments} >= 0 AND ${table.secrets} >= 0 AND ${table.matches} >= 0 AND ${table.wins} >= 0`), check('camp_presets_array_limit', sql`jsonb_typeof(${table.presets}) = 'array' AND jsonb_array_length(${table.presets}) <= 5`)]);
export const campRequests = pgTable('camp_requests', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(), operation: text('operation').notNull(), payloadHash: text('payload_hash').notNull(), createdAt: createdAt(),
}, table => [primaryKey({ columns: [table.userId, table.requestId] })]);
export const matches = pgTable('matches', {
  id: text('id').primaryKey(), ruleVersion: text('rule_version').notNull(), winner: text('winner').$type<Settlement['winner']>().notNull(),
  reason: text('reason').notNull(), payloadHash: text('payload_hash').notNull(),
  mapSeed: bigint('map_seed', {mode:'number'}), playerCount: integer('player_count'),
  events: jsonb('events').$type<Evidence[]>().notNull(), createdAt: createdAt(),
});
export const matchRewards = pgTable('match_rewards', {
  matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  fragments: integer('fragments').notNull(), secrets: integer('secrets').notNull(), won: boolean('won').notNull(),
}, table => [primaryKey({ columns: [table.matchId, table.userId] })]);
export const redeemedLoot = pgTable('redeemed_loot', {
  lootId: text('loot_id').primaryKey(), matchId: text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), createdAt: createdAt(),
});
