import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {assertViewport} from './viewport-helpers';
import 'dotenv/config';
import pg from 'pg';

test('四个浏览器账户：注册→入房→完整对局→制作→穿戴→刷新→下一局',async({browser})=>{
  test.setTimeout(240_000);
  const contexts:BrowserContext[]=[],pages:Page[]=[],errors:string[]=[],accountIds:string[]=[];
  mkdirSync('.local/screenshots',{recursive:true});
  try{
    for(let i=0;i<4;i++){
      const context=await browser.newContext({viewport:i===3?{width:390,height:844}:{width:1440,height:960}});contexts.push(context);await context.addInitScript(()=>{localStorage.setItem('wangxu-quality','low');const scope=window as Window&{phaseLayouts?:Record<string,unknown>};scope.phaseLayouts=JSON.parse(sessionStorage.getItem('test-phase-layouts')||'{}');setInterval(()=>{const phase=document.querySelector('.phase-chip strong')?.textContent;const app=document.querySelector('.app');if(!phase||!app)return;const main=document.querySelector('main')!.getBoundingClientRect();const game=document.querySelector('.game-screen')!.getBoundingClientRect();scope.phaseLayouts![phase]={phase,music:app.getAttribute('data-music-scene'),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollX,scrollY,gameHeight:game.height,mainHeight:main.height};sessionStorage.setItem('test-phase-layouts',JSON.stringify(scope.phaseLayouts));},250);});
      const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
      await page.goto('/');await page.getByRole('button',{name:'踏入余灯集市'}).click();
      await page.getByLabel('显示昵称').fill(`归灯端测${i}`);await page.getByLabel('邮箱',{exact:true}).fill(`browser-${Date.now()}-${crypto.randomUUID()}@example.test`);await page.getByLabel('密码',{exact:true}).fill('Browser-Thread-43!');await page.getByRole('button',{name:'创建归灯者账户',exact:true}).click();
      await expect(page.getByRole('heading',{name:`欢迎归来，归灯端测${i}。`})).toBeVisible();
      const session=await page.request.get('/api/auth/get-session');accountIds.push((await session.json()).user.id);
      await assertViewport(page);await page.getByRole('button',{name:'开启归灯远征'}).click();
    }
    for(const page of pages){await page.locator('.room-page').getByRole('button',{name:'加入等待区',exact:true}).click();await page.getByRole('button',{name:'打开灯下等待区'}).click();}
    await expect(pages[0]!.getByRole('list',{name:'等待区成员'}).locator('li')).toHaveCount(4);
    await Promise.all(pages.map(page=>page.getByRole('button',{name:'准备出征',exact:true}).click()));
    await expect(pages[0]!.getByRole('heading',{name:'准备穿过旧城'})).toBeVisible();
    await pages[0]!.bringToFront();await expect(pages[0]!.locator('.phase-chip strong')).toHaveText('石城探索');
    const actorPosition=async()=>pages[0]!.locator('.mini-map circle[fill="#f1c774"]').evaluate(el=>({x:Number(el.getAttribute('cx')),y:Number(el.getAttribute('cy'))}));
    const beforeMove=await actorPosition();
    await pages[0]!.keyboard.down('w');await pages[0]!.waitForTimeout(200);await pages[0]!.keyboard.up('w');
    await expect.poll(async()=>Math.abs((await actorPosition()).y-beforeMove.y)).toBeGreaterThan(5);
    await pages[0]!.reload();await expect(pages[0]!.locator('.phase-chip strong')).toHaveText('石城探索');
    const restored=await actorPosition();
    await pages[0]!.keyboard.down('s');await pages[0]!.waitForTimeout(200);await pages[0]!.keyboard.up('s');
    await expect.poll(async()=>Math.abs((await actorPosition()).y-restored.y)).toBeGreaterThan(5);
    await pages[0]!.screenshot({path:'.local/screenshots/four-player-desktop.png'});
    await pages[3]!.screenshot({path:'.local/screenshots/four-player-mobile.png'});
    expect(await pages[3]!.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(pages[0]!.getByRole('heading',{name:'月蚀吞没旧城'})).toBeVisible({timeout:105_000});
    await pages[0]!.waitForTimeout(350);
    const phaseLayouts=await Promise.all(pages.map(page=>page.evaluate(()=>Object.values((window as Window&{phaseLayouts?:Record<string,any>}).phaseLayouts??{}))));
    for(const phases of phaseLayouts){expect(new Set(phases.map(item=>item.phase))).toEqual(new Set(['出征准备','石城探索','证据议会','封印表决','余灯祝福','归灯终钟','远征归档']));for(const item of phases){expect(item.scrollWidth).toBeLessThanOrEqual(item.width);expect(item.scrollHeight).toBeLessThanOrEqual(item.height);expect(item.scrollX).toBe(0);expect(item.scrollY).toBe(0);expect(item.gameHeight).toBeLessThanOrEqual(item.mainHeight+1);expect(item.music).toMatch(/^(prep|explore|discuss|vote|draft|extract|victory|defeat)$/);}}
    mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/adaptive-game-phases.json',JSON.stringify({capturedAt:new Date().toISOString(),phaseLayouts},null,2));
    for(const page of pages){await assertViewport(page);await page.getByRole('button',{name:'返回等待区',exact:true}).click();await expect(page.locator('.game-screen')).toHaveCount(0);await page.getByRole('button',{name:'余灯集市',exact:true}).click();}
    for(let i=0;i<4;i++){
      const page=pages[i]!;await expect(page.getByRole('heading',{name:`欢迎归来，归灯端测${i}。`})).toBeVisible();
      const camp=await page.request.get('/api/camp');expect((await camp.json()).matches).toBe(1);
      await page.getByRole('button',{name:'灯屑制作',exact:true}).click();await page.locator('.recipe').filter({has:page.getByRole('heading',{name:'第一缕·絮灯饰',exact:true})}).getByRole('button',{name:'制作',exact:true}).click();
      await expect(page.locator('.recipe').filter({has:page.getByRole('heading',{name:'第一缕·絮灯饰',exact:true})}).getByRole('button',{name:'已收藏'})).toBeVisible();
      await page.getByRole('button',{name:'外观与职业偏好',exact:true}).click();await page.getByLabel('已收藏外观').selectOption('first-thread');await page.getByRole('button',{name:'穿戴并保存',exact:true}).click();
      await expect.poll(async()=>{const r=await page.request.get('/api/camp');return (await r.json()).equipment.cosmeticId;}).toBe('first-thread');
      await page.getByLabel('配装预设名称').fill('归灯端测预设');await page.getByRole('button',{name:'保存账户预设',exact:true}).click();
      await expect.poll(async()=>{const r=await page.request.get('/api/camp');return (await r.json()).presets?.length;}).toBe(1);
      await page.reload();await expect(page.getByLabel('已收藏外观')).toHaveValue('first-thread');
      await expect(page.locator('.preset-list button').filter({hasText:'归灯端测预设'})).toBeVisible();
    }
    await pages[0]!.screenshot({path:'.local/screenshots/camp-crafted.png'});
    await pages[0]!.getByRole('button',{name:'打开灯下等待区'}).click();await expect(pages[0]!.getByRole('list',{name:'等待区成员'}).locator('li')).toHaveCount(4);await pages[0]!.getByRole('button',{name:'离开等待区'}).click();
    expect(errors).toEqual([]);
  }finally{await Promise.allSettled(contexts.map(context=>context.close()));const database=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await database.query('DELETE FROM matches WHERE id IN (SELECT match_id FROM match_rewards WHERE user_id=ANY($1::text[]))',[accountIds]);await database.query('DELETE FROM auth_user WHERE id=ANY($1::text[])',[accountIds]);}finally{await database.end();}}
});
