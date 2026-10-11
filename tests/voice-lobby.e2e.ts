import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
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
  await expect(page.getByRole('button', { name: '加入等待区', exact: true })).toBeVisible();
  return data.user.id as string;
}

test('one waiting area preserves two microphones across camp navigation and cleans up on exit',async({browser})=>{
  const errors:string[]=[],first=await browser.newContext({permissions:['microphone']}),second=await browser.newContext({permissions:['microphone']});contexts.push(first,second);
  const a=await first.newPage(),b=await second.newPage();a.on('pageerror',error=>errors.push(error.message));b.on('pageerror',error=>errors.push(error.message));
  const ids=[await register(a,'等待区甲'),await register(b,'等待区乙')];
  for(const page of [a,b]){await page.locator('.voice-strip-actions').getByRole('button',{name:'加入等待区',exact:true}).click();await expect(page.getByRole('button',{name:'开启麦克风',exact:true})).toBeVisible();}
  await expect(a.getByRole('list',{name:'等待区成员'}).locator('li')).toHaveCount(2);
  let roomName='';await expect.poll(async()=>{for(const room of await admin.listRooms()){if(!room.name.startsWith('public-lobby-'))continue;const members=await admin.listParticipants(room.name);if(ids.every(id=>members.some(member=>member.identity===id))){roomName=room.name;return true;}}return false;}).toBe(true);
  expect((await admin.listParticipants(roomName)).every(member=>member.tracks.length===0)).toBe(true);
  for(const page of [a,b])await page.getByRole('button',{name:'开启麦克风',exact:true}).click();await expect(a.locator('audio[data-voice="lobby"]')).toHaveCount(1);
  await a.getByRole('button',{name:'收起语音大厅',exact:true}).click();await a.getByRole('button',{name:'远征大厅',exact:true}).click();await expect(a.locator('audio[data-voice="lobby"]')).toHaveCount(1);
  await a.getByRole('button',{name:'打开灯下等待区'}).click();await a.setViewportSize({width:390,height:844});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  mkdirSync('.local/screenshots',{recursive:true});await a.screenshot({path:'.local/screenshots/waiting-lobby-mobile.png',fullPage:true});
  await a.getByRole('button',{name:'离开等待区',exact:true}).click();await expect(a.locator('audio[data-voice="lobby"]')).toHaveCount(0);await expect.poll(async()=>(await admin.listParticipants(roomName)).length).toBe(1);
  await b.getByRole('button',{name:'收起语音大厅',exact:true}).click();await b.getByRole('button',{name:'归灯训练',exact:true}).click();await expect.poll(async()=>(await admin.listParticipants(roomName)).length).toBe(0);expect(errors).toEqual([]);
});

test('duplicate control is rejected and microphone denial leaves the waiting membership usable',async({browser})=>{
  const context=await browser.newContext({permissions:['microphone']});contexts.push(context);const a=await context.newPage();await register(a,'唯一控制成员');
  await a.locator('.voice-strip-actions').getByRole('button',{name:'加入等待区',exact:true}).click();await expect(a.getByRole('list',{name:'等待区成员'}).locator('li')).toHaveCount(1);
  const b=await context.newPage();await b.goto('/');await b.locator('.voice-strip-actions').getByRole('button',{name:'加入等待区',exact:true}).click();await expect(b.locator('.toast')).toContainText('此账户已在大厅');
  await expect(a.getByRole('list',{name:'等待区成员'}).locator('li')).toHaveCount(1);
  await a.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});await a.getByRole('button',{name:'开启麦克风',exact:true}).click();await expect(a.locator('.voice-lobby-message')).toContainText('仍可收听');
  await a.getByRole('button',{name:'准备出征',exact:true}).click();await expect(a.getByRole('list',{name:'等待区成员'})).toContainText('已准备');
});

test('leaving during a delayed media ticket cancels the connection without changing queue ownership',async({browser})=>{
  const context=await browser.newContext({permissions:['microphone']});contexts.push(context);const page=await context.newPage();await register(page,'取消等待连接');
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/voice/lobby/token',async route=>{await barrier;await route.continue();});
  await page.locator('.voice-strip-actions').getByRole('button',{name:'加入等待区',exact:true}).click();await expect(page.getByRole('button',{name:'离开等待区',exact:true})).toBeVisible();await page.getByRole('button',{name:'离开等待区',exact:true}).click();release();await page.unrouteAll({behavior:'wait'});
  await expect(page.locator('.voice-strip-actions').getByRole('button',{name:'加入等待区',exact:true})).toBeVisible();await expect(page.locator('audio[data-voice="lobby"]')).toHaveCount(0);
});

test('voice failure does not prevent membership or readiness',async({browser})=>{
  const context=await browser.newContext();contexts.push(context);const page=await context.newPage();await register(page,'语音离线候选');
  await page.route('**/api/voice/lobby/token',route=>route.fulfill({status:503,json:{error:'LOBBY_UNAVAILABLE',message:'语音大厅暂时离线'}}));
  await page.locator('.voice-strip-actions').getByRole('button',{name:'加入等待区',exact:true}).click();await expect(page.getByRole('list',{name:'等待区成员'}).locator('li')).toHaveCount(1);
  await page.getByRole('button',{name:'准备出征',exact:true}).click();await expect(page.getByRole('list',{name:'等待区成员'})).toContainText('已准备');await expect(page.locator('.voice-lobby-message')).toContainText('离线');
});
