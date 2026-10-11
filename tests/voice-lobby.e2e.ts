import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { RoomServiceClient } from 'livekit-server-sdk';
import pg from 'pg';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
const admin = new RoomServiceClient(process.env.LIVEKIT_URL ?? 'http://127.0.0.1:7880', process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { requestTimeout: 2 });
let startedServer: ChildProcess | undefined;
const accountIds: string[] = [], contexts: BrowserContext[] = [];
test.beforeAll(async () => {
  try { await admin.listRooms(); } catch {
    startedServer = spawn(path.resolve('.local/bin/livekit-server'), ['--config', path.resolve('.local/livekit.yaml')], { stdio: 'ignore' });
    await expect.poll(async () => { try { await admin.listRooms(); return true; } catch { return false; } }, { timeout: 15_000 }).toBe(true);
  }
});
test.afterEach(async () => { await Promise.allSettled(contexts.splice(0).map(context => context.close())); });
test.afterAll(async () => {
  await Promise.allSettled(contexts.map(context => context.close()));
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try { if (accountIds.length) await database.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [accountIds]); }
  finally { await database.end(); startedServer?.kill('SIGTERM'); }
});
async function register(page: Page, name: string) {
  await page.goto('/');
  const result = await page.request.post('/api/auth/sign-up/email', { headers: { Origin: new URL(page.url()).origin }, data: { name, email: `voice-${randomUUID()}@example.net`, password: `Test-voice-${randomUUID()}` } });
  expect(result.status()).toBe(200);
  const data = await result.json(); accountIds.push(data.user.id);
  await expect.poll(async () => (await (await page.request.get('/api/voice/lobby')).json()).available).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '加入语音大厅', exact: false })).toBeVisible();
  return data.user.id as string;
}

test('public homepage, two real microphones, responsive layout and navigation cleanup', async ({ browser }) => {
  const errors: string[] = [];
  const first = await browser.newContext({ permissions: ['microphone'] }), second = await browser.newContext({ permissions: ['microphone'] });
  contexts.push(first, second);
  const a = await first.newPage(), b = await second.newPage();
  a.on('pageerror', error => errors.push(error.message)); b.on('pageerror', error => errors.push(error.message));
  await a.goto('/');
  await expect(a.getByRole('button', { name: '打开灯下语音大厅' })).toBeVisible();
  await expect(a.getByRole('button', { name: '登录并加入', exact: true })).toBeVisible();
  expect((await a.request.post('/api/voice/lobby/token', { data: {} })).status()).toBe(401);
  const publicInfo = await (await a.request.get('/api/voice/lobby')).json();
  expect(publicInfo).toMatchObject({ available: true, capacity: 10 }); expect(publicInfo.token).toBeUndefined();
  const ids = await Promise.all([register(a, '灯卫语音测试'), register(b, '斥候语音测试')]);
  await Promise.all([a, b].map(page => page.getByRole('button', { name: '加入语音大厅' }).click()));
  await Promise.all([a, b].map(page => expect(page.getByRole('button', { name: '开启麦克风', exact: true })).toBeVisible()));
  await expect(a.locator('.voice-lobby-members li')).toHaveCount(2);
  await expect(a.locator('.app')).toHaveAttribute('data-music-ducked','true');
  await expect.poll(async()=>a.evaluate(async()=>{const {sceneMusic}=await import('/src/music.ts' as string);return (sceneMusic as any).current?.sound.volume()??1;})).toBeLessThan(.09);
  let roomName = '';
  await expect.poll(async () => {
    for (const room of (await admin.listRooms()).filter(room => room.name.startsWith('public-lobby-'))) {
      const participants = await admin.listParticipants(room.name);
      if (ids.every(id => participants.some(participant => participant.identity === id))) { roomName = room.name; return true; }
    }
    return false;
  }).toBe(true);
  expect((await admin.listParticipants(roomName)).every(participant => participant.tracks.length === 0)).toBe(true);
  await Promise.all([a, b].map(page => page.getByRole('button', { name: '开启麦克风', exact: true }).click()));
  await Promise.all([a, b].map(page => expect(page.locator('audio[data-voice="lobby"]')).toHaveCount(1)));
  await expect.poll(async () => (await admin.listParticipants(roomName)).every(participant => participant.tracks.length === 1)).toBe(true);
  await expect(a.getByRole('button', { name: '静音麦克风', exact: true })).toBeVisible();
  const sid = (await admin.listParticipants(roomName)).find(participant => participant.identity === ids[0])!.tracks[0]!.sid;
  await expect(a.getByRole('button',{name:'静音麦克风',exact:true})).toHaveAttribute('data-icon-state','on');
  await a.getByRole('button', { name: '静音麦克风', exact: true }).click();
  await expect(a.getByRole('button',{name:'开启麦克风',exact:true})).toHaveAttribute('data-icon-state','off');
  await a.getByRole('button', { name: '开启麦克风', exact: true }).click();
  expect((await admin.listParticipants(roomName)).find(participant => participant.identity === ids[0])!.tracks[0]!.sid).toBe(sid);
  await expect(a.getByRole('button',{name:'关闭收听',exact:true})).toHaveAttribute('data-icon-state','on');
  await a.getByRole('button', { name: '关闭收听', exact: true }).click();
  await expect(a.getByRole('button',{name:'开启收听',exact:true})).toHaveAttribute('data-icon-state','off');
  expect(await a.locator('audio[data-voice="lobby"]').evaluate(element => (element as HTMLAudioElement).muted)).toBe(true);
  await a.getByRole('button', { name: '开启收听', exact: true }).click();
  expect(await a.locator('audio[data-voice="lobby"]').evaluate(element => (element as HTMLAudioElement).muted)).toBe(false);
  await expect(a.locator('.voice-diagnostics')).toBeVisible({ timeout: 10_000 });
  const renderedFrames = await a.locator('.camp-world canvas').evaluate(async canvas => {
    const renderer = (canvas as HTMLCanvasElement & { __soulwisp: { renderer: { info: { render: { frame: number } } } } }).__soulwisp.renderer;
    const before = renderer.info.render.frame;
    await new Promise(resolve => setTimeout(resolve, 350));
    return renderer.info.render.frame - before;
  });
  expect(renderedFrames).toBeLessThanOrEqual(2);
  await a.getByRole('button', { name: '收起语音大厅', exact: true }).click();
  await expect(a.locator('audio[data-voice="lobby"]')).toHaveCount(1);
  await expect(a.locator('audio[data-voice="lobby"]')).toHaveJSProperty('muted', false);
  await expect.poll(async () => (await admin.listParticipants(roomName)).length).toBe(2);
  await a.getByRole('button', { name: '快捷静音麦克风', exact: true }).click();
  await a.getByRole('button', { name: '快捷开启麦克风', exact: true }).click();
  expect((await admin.listParticipants(roomName)).find(participant => participant.identity === ids[0])!.tracks[0]!.sid).toBe(sid);
  mkdirSync('.local/screenshots', { recursive: true });
  await a.screenshot({ path: '.local/screenshots/voice-lobby-desktop.png', fullPage: true });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.getByRole('button', { name: '打开灯下语音大厅' }).click();
  await expect(a.locator('.voice-lobby-members')).toHaveCSS('grid-template-columns', /\d.*px \d.*px/);
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.screenshot({ path: '.local/screenshots/voice-lobby-mobile-panel.png', fullPage: true });
  await a.getByRole('button', { name: '收起语音大厅', exact: true }).click();
  await a.screenshot({ path: '.local/screenshots/voice-lobby-mobile.png', fullPage: true });
  await a.getByRole('button', { name: '远征大厅', exact: true }).click();
  await expect(a.locator('audio[data-voice="lobby"]')).toHaveCount(0);
  await expect(b.locator('audio[data-voice="lobby"]')).toHaveCount(0);
  await expect.poll(async () => (await admin.listParticipants(roomName)).length).toBe(1);
  await a.getByRole('button', { name: '创建房间，获取邀请码', exact: true }).click();
  await expect(a.getByRole('heading', { name: '灯火候你同行', exact: true })).toBeVisible();
  expect((await a.request.post('/api/voice/lobby/token', { data: {} })).status()).toBe(403);
  await a.getByRole('button', { name: '离开房间', exact: true }).click();
  await expect(a.getByRole('button', { name: '加入语音大厅' })).toBeVisible();
  await a.getByRole('button', { name: '加入语音大厅' }).click();
  await expect(a.getByRole('button', { name: '开启麦克风', exact: true })).toBeVisible();
  await a.getByRole('button', { name: '收起语音大厅', exact: true }).click();
  await a.getByRole('button', { name: '归灯训练', exact: true }).click();
  await expect(a.locator('audio[data-voice="lobby"]')).toHaveCount(0);
  await b.getByRole('button', { name: '收起语音大厅', exact: true }).click();
  await b.getByRole('button', { name: '退出', exact: true }).click();
  await expect(b.getByRole('button', { name: '登录并加入', exact: true })).toBeVisible();
  await expect.poll(async () => (await admin.listParticipants(roomName)).length).toBe(0);
  expect(errors).toEqual([]);
});

test('duplicate page takeover stops the old session and permission denial remains listen-only', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
  const a = await context.newPage(); await register(a, '同账户语音');
  await a.getByRole('button', { name: '加入语音大厅' }).click();
  await expect(a.getByRole('button', { name: '开启麦克风', exact: true })).toBeVisible();
  const b = await context.newPage(); await b.goto('/');
  await b.getByRole('button', { name: '加入语音大厅' }).click();
  await expect(a.locator('.voice-lobby-message')).toBeVisible();
  await expect(a.getByRole('dialog',{name:'灯下语音大厅',exact:true}).getByRole('button', { name: '加入语音大厅' })).toBeVisible();
  await b.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denied microphone', 'NotAllowedError'); }; });
  await b.getByRole('button', { name: '开启麦克风', exact: true }).click();
  await expect(b.locator('.voice-lobby-message')).toBeVisible();
  await expect(b.getByRole('button', { name: '关闭收听', exact: true })).toBeVisible();
  await b.getByRole('button', { name: '离开大厅', exact: true }).click();
});

test('cancels a delayed token without reconnecting and immediately releases a late microphone', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
  const page = await context.newPage(); await register(page, '取消语音测试');
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/voice/lobby/token', async route => { await barrier; await route.continue(); });
  await page.getByRole('button', { name: '加入语音大厅' }).click();
  await page.getByRole('dialog',{name:'灯下语音大厅',exact:true}).getByRole('button', { name: '取消连接', exact: true }).click();
  release(); await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('button', { name: '加入语音大厅' })).toBeVisible();
  // Exercise the shipped controller directly for a permission prompt resolved after unmount.
  const result = await page.evaluate(async () => {
    const module = await import('/src/lobby-voice.ts' as string);
    const connection = new module.LobbyVoiceConnection(); await connection.initialize(); await connection.join();
    const states: string[] = [];
    const unsubscribe = connection.subscribe(() => { states.push(connection.getSnapshot().state); });
    const recovered = new Promise<void>(resolve => connection.room.once('reconnected', resolve));
    await connection.room.simulateScenario('signal-reconnect'); await recovered;
    unsubscribe();
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let media: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia = async constraints => { await wait; media = await original(constraints); return media; };
    const pending = connection.toggleMic(); connection.dispose(); release(); await pending;
    navigator.mediaDevices.getUserMedia = original;
    return { tracks: (media as MediaStream | null)?.getTracks().map(track => track.readyState), audioElements: document.querySelectorAll('audio[data-voice="lobby"]').length, reconnectStates: states };
  });
  expect(result.tracks?.every((state: string) => state === 'ended')).toBe(true); expect(result.audioElements).toBe(0);
  expect(result.reconnectStates).toContain('reconnecting'); expect(result.reconnectStates.at(-1)).toBe('connected');
  mkdirSync('.local/verification', { recursive: true });
  writeFileSync('.local/verification/voice-lobby-ui.json', JSON.stringify({ capturedAt: new Date().toISOString(), runtime: process.version, cancelledJoinAndLateMicrophone: result }, null, 2));
});

test('retries an offline lobby and unlocks audio after browser playback rejection', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['microphone'] }); contexts.push(context);
  const page = await context.newPage(); await register(page, '声音解锁测试');
  await page.route('**/api/voice/lobby', route => route.fulfill({ json: { available: false, online: 0, capacity: 10, url: null } }));
  await page.reload(); await page.getByRole('button', { name: '打开灯下语音大厅' }).click();
  await expect(page.getByText('大厅暂时离线', { exact: true })).toBeVisible();
  await page.unroute('**/api/voice/lobby'); await page.getByRole('dialog',{name:'灯下语音大厅',exact:true}).getByRole('button', { name: '重试连接', exact: true }).click();
  await expect(page.getByRole('dialog',{name:'灯下语音大厅',exact:true}).getByRole('button', { name: '加入语音大厅' })).toBeVisible();
  await page.evaluate(() => {
    const scope = window as Window & { testBlockAudio?: boolean };
    scope.testBlockAudio = true;
    const resume = AudioContext.prototype.resume, play = HTMLMediaElement.prototype.play;
    const state = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state')!.get!;
    Object.defineProperty(AudioContext.prototype, 'state', { configurable: true, get() { return scope.testBlockAudio ? 'suspended' : state.call(this); } });
    AudioContext.prototype.resume = function () { return scope.testBlockAudio ? Promise.reject(new DOMException('Test blocked playback', 'NotAllowedError')) : resume.call(this); };
    HTMLMediaElement.prototype.play = function () { return scope.testBlockAudio ? Promise.reject(new DOMException('Test blocked playback', 'NotAllowedError')) : play.call(this); };
  });
  await page.getByRole('dialog',{name:'灯下语音大厅',exact:true}).getByRole('button', { name: '加入语音大厅' }).click();
  await expect(page.getByRole('button', { name: '点击启用声音', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as Window & { testBlockAudio?: boolean }).testBlockAudio = false; });
  await page.getByRole('button', { name: '点击启用声音', exact: true }).click();
  await expect(page.getByRole('button', { name: '点击启用声音', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '离开大厅', exact: true }).click();
});


test('compact homepage keeps its height, focus and login usable across viewports', async ({ page }) => {
  await page.goto('/');
  mkdirSync('.local/screenshots', { recursive: true });
  for (const size of [{width:1280,height:720},{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
    await page.setViewportSize(size);
    await expect.poll(()=>page.evaluate(()=>parseInt(document.documentElement.style.getPropertyValue('--viewport-height')))).toBe(size.height);
    const strip = page.locator('.voice-lobby');
    const before = await page.locator('.screen-content').boundingBox();
    const stripBox = await strip.boundingBox();
    expect(stripBox!.height + 8).toBe(size.width <= 700 || size.height <= 520 ? 56 : 64);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = await page.getByRole('button', { name: '先体验归灯训练', exact: true }).boundingBox();
    const footer = await page.locator('footer').boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(footer!.y);
    await page.getByRole('button', { name: '打开灯下语音大厅' }).click();
    const panel = page.getByRole('dialog', { name: '灯下语音大厅', exact:true });
    await expect(panel).toBeVisible();
    expect(await page.locator('.screen-content').boundingBox()).toEqual(before);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    await panel.getByRole('button', {name:'收起语音大厅'}).press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.id)).toBe('voice-lobby-dialog');
    await panel.getByRole('button', {name:'收起语音大厅'}).press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(page.getByRole('button',{name:'打开灯下语音大厅'})).toBeFocused();
    expect(await page.locator('.screen-content').boundingBox()).toEqual(before);
    await page.screenshot({path:`.local/screenshots/voice-home-${size.width}x${size.height}.png`});
  }
  await page.getByRole('button', { name: '打开灯下语音大厅' }).click();
  await page.getByRole('dialog', {name:'灯下语音大厅',exact:true}).getByRole('button', {name:'登录并加入',exact:true}).click();
  await expect(page.getByRole('dialog', {name:'灯下语音大厅',exact:true})).not.toBeVisible();
  const login=page.getByRole('dialog', {name:'欢迎回到灯火之下',exact:true});
  await expect(login).toBeVisible();
  await expect(login.getByLabel('邮箱',{exact:true})).toBeFocused();
});


test('ten-member and failure snapshots keep the strip fixed and all panel actions reachable', async ({page}) => {
  await register(page, '面板布局测试');
  // Render server/controller-shaped snapshots without opening ten media devices.
  await page.evaluate(async () => {
    const {LobbyVoiceConnection} = await import('/src/lobby-voice.ts' as string);
    LobbyVoiceConnection.prototype.initialize = async function () {
      (window as any).__voiceLayout = this;
      this.snapshot = {...this.getSnapshot(),state:'connected',info:{available:true,online:10,capacity:10,url:null},members:Array.from({length:10},(_,i)=>({id:String(i),name:i===0?'这是一位昵称很长的归灯同行者':'同行者'+i,self:i===0,muted:i%2===0,speaking:i%2!==0})),metrics:Array.from({length:9},(_,i)=>({trackId:String(i),peerId:String(i+1),roundTripMs:42,lossPercent:0,jitterMs:3,bufferMs:8,protocol:'udp',relay:false,relayProtocol:null}))};
      this.listeners.forEach((listener:any)=>listener());
    };
  });
  await page.getByRole('button',{name:'归灯训练',exact:true}).click();
  await page.getByRole('button',{name:'余灯集市',exact:true}).click();
  await expect(page.locator('.voice-lobby-count')).toHaveAttribute('aria-label','10人，最多10人');
  for (const size of [{width:1280,height:720},{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
    await page.setViewportSize(size);
    await expect.poll(()=>page.evaluate(()=>parseInt(document.documentElement.style.getPropertyValue('--viewport-height')))).toBe(size.height);
    const before=await page.locator('.screen-content').boundingBox();
    await page.getByRole('button',{name:'打开灯下语音大厅'}).click();
    const panel=page.getByRole('dialog',{name:'灯下语音大厅',exact:true});
    await expect(panel.locator('.voice-lobby-members li')).toHaveCount(10);
    expect(await page.locator('.screen-content').boundingBox()).toEqual(before);
    expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    await panel.getByText('连接诊断',{exact:true}).click();
    await expect(panel.locator('.voice-diagnostics-scroll')).toHaveCSS('overflow-x','auto');
    await expect(panel.locator('tbody tr')).toHaveCount(9);
    await panel.locator('.voice-lobby-body').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await page.screenshot({path:`.local/screenshots/voice-ten-panel-${size.width}x${size.height}.png`});
    await panel.getByText('连接诊断',{exact:true}).click();
    const leave=await panel.getByRole('button',{name:'离开大厅'}).boundingBox();
    expect(leave!.y+leave!.height).toBeLessThanOrEqual(size.height);
    for(const mode of ['reconnecting','blocked','error','joining','offline']) {
      await page.evaluate(mode=>{
        const connection=(window as any).__voiceLayout;
        connection.snapshot={...connection.snapshot,state:mode==='joining'?'joining':mode==='offline'?'idle':mode==='reconnecting'?'reconnecting':'connected',playbackBlocked:mode==='blocked',message:mode==='error'?'无法打开麦克风，请检查浏览器权限和音频设备。你仍可收听。':mode==='reconnecting'?'连接暂时中断，正在恢复…':'',info:{...connection.snapshot.info,available:mode!=='offline'}};
        connection.listeners.forEach((listener:any)=>listener());
      },mode);
      expect(await page.locator('.screen-content').boundingBox()).toEqual(before);
      expect(await page.locator('.voice-lobby').evaluate(e=>e.getBoundingClientRect().height+8)).toBe(size.width<=700||size.height<=520?56:64);
      const actions=await panel.locator('.voice-lobby-controls button').evaluateAll(buttons=>buttons.map(e=>({height:e.getBoundingClientRect().height,bottom:e.getBoundingClientRect().bottom})));
      expect(actions.every(e=>e.height>=44&&e.bottom<=size.height)).toBe(true);
      if(mode==='blocked')await expect(panel.getByRole('button',{name:'点击启用声音'})).toBeVisible();
      if(mode==='error')await expect(panel.locator('.voice-lobby-message')).toHaveText(/无法打开麦克风/);
    }
    await page.evaluate(()=>{const c=(window as any).__voiceLayout;c.snapshot={...c.snapshot,state:'connected',playbackBlocked:false,message:'',info:{...c.snapshot.info,available:true}};c.listeners.forEach((listener:any)=>listener());});
    await panel.getByRole('button',{name:'收起语音大厅'}).click();
    expect(await page.locator('.screen-content').boundingBox()).toEqual(before);
  }
});
