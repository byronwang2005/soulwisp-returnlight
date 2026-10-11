import { Hono,type MiddlewareHandler } from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {ProfileError,presetAvatar,saveProfile} from './profiles.js';
import {profileRepository} from './profile-store.js';
import { AccountError, advanceTutorial, auth, craft, getCamp, getSession, issueGameTicket, saveLoadout, savePresets } from './accounts.js';
import { VoiceError, type VoiceService, type VoiceState } from './voice.js';
import type { CampData, CampPreset } from '@wangxu/shared';
import { pool } from './db/index.js';
import { reserveWaiting, type WaitingRoom } from './waiting-room.js';
import { LobbyVoiceError, type VoiceLobbyService } from './voice-lobby.js';

export interface ApiEngine { getVoiceState(): VoiceState }
export interface ApiOptions { getRoom: (id: string) => { engine: ApiEngine } | ApiEngine | undefined; voiceService?: VoiceService; voiceLobby?: VoiceLobbyService; lobby?: () => WaitingRoom | undefined }
type Variables = { account: { id: string; name: string } };
const origins = () => [...new Set([process.env.AUTH_BASE_URL ?? process.env.AUTH_URL ?? process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:5180',
  ...(process.env.ALLOWED_ORIGINS ?? process.env.TRUSTED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean)])];

// Hono skips stream measurement when Content-Length is present. Measure every upload.
export const actualBodyLimit=(maxSize:number):MiddlewareHandler=>async(c,next)=>{
  const headers=new Headers(c.req.raw.headers);headers.delete('content-length');
  c.req.raw=new Request(c.req.raw,{headers});
  return bodyLimit({maxSize,onError:c=>c.json({error:'REQUEST_TOO_LARGE',message:'请求数据过大'},413)})(c,next);
};

export function createApi(options: ApiOptions) {
  const app = new Hono<{ Variables: Variables }>();
  app.onError((error, c) => {
    if(error instanceof ProfileError)return c.json({error:error.code,message:error.message},error.status);
    if (error instanceof LobbyVoiceError) return c.json({ error: error.code, message: error.message }, error.status);
    if (error instanceof AccountError) return c.json({ error: error.code, message: error.message }, error.status);
    if (error instanceof VoiceError) return c.json({ error: 'VOICE_UNAVAILABLE', message: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: 'BAD_JSON', message: '请求数据格式无效' }, 400);
    console.error('[api]', error);
    return c.json({ error: 'SERVER_ERROR', message: '服务暂时不可用，请重试' }, 503);
  });
  app.use('/api/auth/*',actualBodyLimit(32_768));
  app.on(['GET', 'POST'], '/api/auth/*', async c => {
    const path=c.req.path.replace(/\/+$/,'');
    if(path==='/api/auth/update-user')return c.json({error:'PROFILE_REQUIRED',message:'请通过用户设置修改资料'},403);
    if(c.req.method==='POST'&&path==='/api/auth/sign-up/email'){
      const body=await c.req.raw.clone().json();
      if(body?.image!==undefined&&!presetAvatar(body.image))throw new ProfileError('BAD_AVATAR','请选择预设头像或登录后上传图片');
    }
    return auth.handler(c.req.raw);
  });
  app.get('/api/avatars/:assetId/:version',async c=>{
    const {assetId,version}=c.req.param();
    if(!/^[a-f0-9-]{36}$/.test(assetId)||! /^[a-f0-9]{64}\.webp$/.test(version))return c.notFound();
    const avatar=await profileRepository.findAvatar(assetId,version.slice(0,-5));
    if(!avatar)return c.notFound();
    c.header('Content-Type','image/webp');c.header('X-Content-Type-Options','nosniff');
    c.header('Cache-Control','public, max-age=31536000, immutable');
    return c.body(new Uint8Array(avatar.data));
  });
  app.get('/api/health', async c => {
    await pool.query('SELECT 1');
    return c.json({ ok: true, database: 'ready', revision: process.env.RELEASE_SHA ?? null, voice: Boolean(options.voiceService) });
  });
  app.get('/api/voice/lobby', async c => {
    c.header('Cache-Control', 'no-store');
    return c.json(options.voiceLobby ? await options.voiceLobby.status() : { available: false, online: 0, capacity: 0, url: null });
  });
  app.get('/api/lobby', c => {c.header('Cache-Control','no-store');return c.json(options.lobby?.()?.coordinator.summary()??{waiting:0,game:null,countdown:null,draining:false});});
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method === 'POST') {
      const origin = c.req.header('Origin');
      if (origin && !origins().includes(origin)) return c.json({ error: 'BAD_ORIGIN', message: '请求来源无效' }, 403);
      if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return c.json({ error: 'BAD_CONTENT_TYPE', message: '请发送JSON请求' }, 400);
    }
    const session = await getSession(c.req.raw.headers);
    if (!session) return c.json({ error: 'UNAUTHORIZED', message: '请先登录营地' }, 401);
    c.set('account', { id: session.user.id, name: session.user.name });
    await next();
  });
  app.use('/api/*',async(c,next)=>{
    return actualBodyLimit(c.req.path==='/api/profile'?96*1024:32_768)(c,next);
  });
  app.post('/api/profile', async c => {
    return c.json({user:await saveProfile(profileRepository,c.get('account').id,await c.req.json())});
  });
  app.get('/api/camp', async c => c.json(await getCamp(c.get('account').id)));
  app.post('/api/lobby/join', async c => c.json(await reserveWaiting(c.get('account'))));
  app.post('/api/voice/lobby/token', async c => {
    if (!options.lobby?.()?.coordinator.isWaiting(c.get('account').id)) throw new LobbyVoiceError(403,'NOT_WAITING','请先加入等待区');
    if (!options.voiceLobby) throw new LobbyVoiceError(503, 'LOBBY_UNAVAILABLE', '语音大厅暂时离线，请稍后重试。');
    return c.json(await options.voiceLobby.issueToken(c.get('account')));
  });
  app.post('/api/craft', async c => {
    const body = await c.req.json<{ recipeId: string; requestId: string }>();
    if (typeof body.recipeId !== 'string' || typeof body.requestId !== 'string') throw new AccountError('BAD_CRAFT', '蓝图和请求编号必填');
    return c.json(await craft(c.get('account').id, body.recipeId, body.requestId));
  });
  app.post('/api/loadout', async c => {
    const body = await c.req.json<CampData['equipment']>();
    if (typeof body.cosmeticId !== 'string' || typeof body.profession !== 'string' || typeof body.form !== 'number') throw new AccountError('BAD_LOADOUT', '装备数据无效');
    return c.json(await saveLoadout(c.get('account').id, body));
  });
  app.post('/api/tutorial', async c => {
    const body = await c.req.json<{ step: number; complete: boolean; requestId: string }>();
    if (typeof body.requestId !== 'string') throw new AccountError('BAD_REQUEST_ID', '请求编号必填');
    return c.json(await advanceTutorial(c.get('account').id, body.step, body.complete, body.requestId));
  });
  app.post('/api/presets', async c => {
    const body = await c.req.json<{ presets: CampPreset[]; requestId: string }>();
    if (!body || typeof body.requestId !== 'string' || !Array.isArray(body.presets)) throw new AccountError('BAD_PRESETS', '配装预设和请求编号必填');
    return c.json(await savePresets(c.get('account').id, body.presets, body.requestId));
  });
  app.post('/api/game-ticket', c => {
    const account = c.get('account');
    return c.json({ ticket: issueGameTicket(account.id, account.name), userId: account.id });
  });
  app.post('/api/voice/token', async c => {
    const body = await c.req.json<{ roomId: string }>();
    if (typeof body.roomId !== 'string') throw new AccountError('BAD_ROOM', '议会编号必填');
    const room = options.getRoom(body.roomId);
    const engine = room && ('engine' in room ? room.engine : room);
    const state = engine?.getVoiceState();
    if (!state || state.phase !== 'DISCUSS' || !state.players.some(player => player.id === c.get('account').id)) throw new VoiceError(403, '当前不在可收听的议会中');
    if (!options.voiceService || !await options.voiceService.syncRoom(body.roomId, state)) throw new VoiceError(503, '议会语音服务暂时离线，仍可使用文字');
    return c.json(await options.voiceService.issueToken(body.roomId, c.get('account').id));
  });
  return app;
}
