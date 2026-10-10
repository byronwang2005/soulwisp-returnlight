import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import 'dotenv/config';
import pg from 'pg';
import {assertViewport} from './viewport-helpers';

const sizes=[{width:1440,height:900},{width:1280,height:720},{width:390,height:844},{width:320,height:568},{width:844,height:390}];
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('wangxu-quality','low'));});

test('bounded guest, authentication and training layouts with real scene music',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/audio/welcome.mp3',async route=>{await barrier;await route.continue();});
  await page.goto('/');await expect(page.locator('.app')).toHaveAttribute('data-music-scene','welcome');
  for(let click=0;click<6;click++)await page.mouse.click(700,450);
  release();await expect(page.locator('.app')).toHaveAttribute('data-music-status','playing');
  const instances=await page.evaluate(async()=>{const {sceneMusic}=await import('/src/music.ts' as string);return (sceneMusic as any).current.sound._sounds.filter((sound:any)=>!sound._paused).length;});
  expect(instances).toBe(1);await page.unroute('**/audio/welcome.mp3');
  for(const size of sizes){
    await page.setViewportSize(size);await assertViewport(page);
    await page.getByRole('button',{name:'踏入余灯集市'}).click();await expect(page.getByRole('dialog',{name:'留下你的归灯之名'})).toBeVisible();await assertViewport(page);
    await expect(page.locator('.app')).toHaveAttribute('data-music-scene','auth');
    await page.getByRole('button',{name:'关闭登录'}).click();
  }
  await expect(page.locator('.app')).toHaveAttribute('data-music-status','playing');
  await page.evaluate(()=>{Object.defineProperty(window.visualViewport!,'height',{configurable:true,get:()=>380});window.visualViewport!.dispatchEvent(new Event('resize'));});
  expect((await page.locator('.app').boundingBox())!.height).toBe(380);
  await page.evaluate(()=>{delete (window.visualViewport as any).height;window.visualViewport!.dispatchEvent(new Event('resize'));});
  // Inspect the actually decoded/playing Howler buffer, not just a successful fetch.
  const playback=await page.evaluate(async()=>{
    const {sceneMusic}=await import('/src/music.ts' as string);
    const active=(sceneMusic as any).current.sound;
    const buffer=active._sounds[0]?._node?.bufferSource?.buffer as AudioBuffer|undefined;
    return {playing:active.playing(),state:active.state(),duration:buffer?.duration,loop:active._loop};
  });
  expect(playback).toMatchObject({playing:true,state:'loaded',loop:true});expect(playback.duration).toBeGreaterThan(25);
  await page.getByRole('button',{name:'音乐与反馈设置'}).click();
  await page.getByLabel('背景音乐音量',{exact:true}).fill('0.25');
  await page.getByLabel('开启场景背景音乐',{exact:true}).uncheck();await expect(page.locator('.app')).toHaveAttribute('data-music-status','paused');
  await page.getByLabel('开启场景背景音乐',{exact:true}).check();await expect(page.locator('.app')).toHaveAttribute('data-music-status','playing');
  await page.getByRole('button',{name:'关闭反馈设置'}).click();await page.reload();
  await page.getByRole('button',{name:'音乐与反馈设置'}).click();await expect(page.getByLabel('背景音乐音量',{exact:true})).toHaveValue('0.25');await page.getByRole('button',{name:'关闭反馈设置'}).click();
  await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();await expect(page.getByRole('heading',{name:'循灯而行',exact:true})).toBeVisible();
  for(const size of sizes){await page.setViewportSize(size);await assertViewport(page);await page.getByRole('button',{name:'反馈设置',exact:true}).click();await assertViewport(page);await page.getByRole('button',{name:'关闭反馈设置'}).click();}
  await page.setViewportSize({width:390,height:844});
  mkdirSync('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/adaptive-tutorial-mobile.png'});
  const decoded=await page.evaluate(async()=>{
    const manifest=await(await fetch('/audio/manifest.json')).json();const context=new OfflineAudioContext(2,1,24000);const output=[];
    for(const track of manifest.tracks){const response=await fetch(track.file);if(!response.ok)throw new Error(`Missing music: ${track.scene}`);const buffer=await context.decodeAudioData(await response.arrayBuffer());const data=buffer.getChannelData(0);let energy=0;for(let i=0;i<data.length;i+=127)energy+=data[i]**2;output.push({scene:track.scene,duration:buffer.duration,channels:buffer.numberOfChannels,energy});}
    return output;
  });
  expect(decoded).toHaveLength(19);expect(decoded.every(track=>track.duration>25&&track.channels===2&&track.energy>1)).toBe(true);
  expect(errors).toEqual([]);writeFileSync('.local/verification/adaptive-music.json',JSON.stringify({capturedAt:new Date().toISOString(),sizes,playback,decoded,instancesAfterRepeatedLoadingGestures:instances,simulatedVisualViewportHeight:380,errors},null,2));
});

test('camp, crafting, research, room browser and ten-seat lobby fit; scrollbar visibility does not move content',async({page})=>{
  let id:string|undefined;
  try{
    await page.goto('/');const result=await page.request.post('/api/auth/sign-up/email',{headers:{Origin:new URL(page.url()).origin},data:{name:'视口验收',email:`viewport-${randomUUID()}@example.test`,password:`Viewport-${randomUUID()}`}});expect(result.status()).toBe(200);id=(await result.json()).user.id;await page.reload();
    await expect(page.getByRole('heading',{name:'欢迎归来，视口验收。'})).toBeVisible();
    for(const size of sizes){
      await page.setViewportSize(size);await assertViewport(page);
      await page.getByRole('button',{name:'灯屑制作',exact:true}).click();await expect(page.locator('.app')).toHaveAttribute('data-music-scene','craft');await assertViewport(page);
      const gutter=await page.locator('.workshop-content').evaluate(panel=>{
        const measure=()=>{const rect=panel.firstElementChild!.getBoundingClientRect();return {x:rect.x,width:rect.width,clientWidth:panel.clientWidth};};
        const before=measure();panel.classList.add('scrollbars-hidden');const hidden=measure();panel.classList.remove('scrollbars-hidden');const previous=panel.style.overflowY;panel.style.overflowY='scroll';const overflowing=measure();panel.style.overflowY=previous;return {before,hidden,overflowing};
      });
      expect(gutter.hidden).toEqual(gutter.before);expect(gutter.overflowing).toEqual(gutter.before);
      await page.getByRole('button',{name:'秘闻研究',exact:true}).click();await expect(page.locator('.app')).toHaveAttribute('data-music-scene','research');
      await page.getByRole('button',{name:'外观与配装',exact:true}).click();await expect(page.locator('.app')).toHaveAttribute('data-music-scene','camp');
    }
    await page.getByRole('button',{name:'开启归灯远征'}).click();await expect(page.locator('.app')).toHaveAttribute('data-music-scene','rooms');
    for(const size of sizes){await page.setViewportSize(size);await assertViewport(page);}
    await page.locator('.capacity-buttons').getByRole('button',{name:'10',exact:true}).click();await page.getByRole('button',{name:'创建房间，获取邀请码',exact:true}).click();await expect(page.locator('.seat')).toHaveCount(10);await expect(page.locator('.app')).toHaveAttribute('data-music-scene','lobby');
    for(const size of sizes){await page.setViewportSize(size);await assertViewport(page);await page.getByRole('button',{name:'准备出征',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'准备出征',exact:true})).toBeInViewport();await assertViewport(page);}
    await page.getByRole('button',{name:'离开房间',exact:true}).click();
  }finally{const database=new pg.Pool({connectionString:process.env.DATABASE_URL});try{if(id)await database.query('DELETE FROM auth_user WHERE id=$1',[id]);}finally{await database.end();}}
});

test('resumed council and blessing training keeps the guide beside or above interactive panels',async({page})=>{
  for(const size of sizes){
    await page.setViewportSize(size);
    for(const step of [3,4]){
      await page.goto('/');await page.evaluate(value=>localStorage.setItem('wangxu-tutorial-step',String(value)),step);
      await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();
      const modal=page.locator(step===3?'.council-modal':'.center-modal');await expect(modal).toBeVisible();
      if(await page.getByRole('button',{name:'展开或收起训练指引'}).getAttribute('aria-expanded')==='false')await page.getByRole('button',{name:'展开或收起训练指引'}).click();
      const [guide,dialog]=await Promise.all([page.locator('.tutorial-guide').boundingBox(),modal.boundingBox()]);
      expect(guide).not.toBeNull();expect(dialog).not.toBeNull();
      expect(guide!.x+guide!.width<=dialog!.x+1||dialog!.x+dialog!.width<=guide!.x+1||guide!.y+guide!.height<=dialog!.y+1).toBe(true);
      await assertViewport(page);
      if(step===4){await modal.locator('.boon-card').last().click();await expect(page.getByRole('button',{name:'下一课 →',exact:true})).toBeEnabled();}
      else{await modal.getByRole('textbox',{name:'议会发言'}).fill('先核对公开工程记录。');await modal.getByRole('button',{name:'发送',exact:true}).click();await expect(modal.locator('.chat-log')).toContainText('先核对公开工程记录。');}
      await assertViewport(page);
    }
  }
});
