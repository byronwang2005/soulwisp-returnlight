import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import 'dotenv/config';
import pg from 'pg';

test('四个浏览器账户：注册→入房→完整对局→制作→穿戴→刷新→下一局',async({browser})=>{
  const contexts:BrowserContext[]=[],pages:Page[]=[],errors:string[]=[],accountIds:string[]=[];
  mkdirSync('.local/screenshots',{recursive:true});
  try{
    for(let i=0;i<4;i++){
      const context=await browser.newContext({viewport:i===3?{width:390,height:844}:{width:1440,height:960}});contexts.push(context);await context.addInitScript(()=>localStorage.setItem('wangxu-quality','low'));
      const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
      await page.goto('/');await page.getByRole('button',{name:'踏入余灯集市'}).click();
      await page.getByLabel('显示昵称').fill(`归灯端测${i}`);await page.getByLabel('邮箱',{exact:true}).fill(`browser-${Date.now()}-${crypto.randomUUID()}@example.test`);await page.getByLabel('密码',{exact:true}).fill('Browser-Thread-43!');await page.getByRole('button',{name:'创建归灯者账户',exact:true}).click();
      await expect(page.getByRole('heading',{name:`欢迎归来，归灯端测${i}。`})).toBeVisible();
      const session=await page.request.get('/api/auth/get-session');accountIds.push((await session.json()).user.id);
      await page.getByRole('button',{name:'开启归灯远征'}).click();
    }
    await pages[0]!.getByRole('button',{name:'创建房间，获取邀请码',exact:true}).click();
    const invite=await pages[0]!.locator('.invite strong').innerText();expect(invite).toMatch(/^[A-F0-9]{6}$/);
    for(let i=1;i<4;i++){await pages[i]!.getByLabel('远征邀请码').fill(invite);await pages[i]!.getByRole('button',{name:'加入远征',exact:true}).click();await expect(pages[i]!.locator('.invite strong')).toHaveText(invite);}
    await expect(pages[0]!.locator('.seat strong')).toHaveCount(4);
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
    for(const page of pages)await page.getByRole('button',{name:'返回营地',exact:true}).click();
    for(let i=0;i<4;i++){
      const page=pages[i]!;await expect(page.getByRole('heading',{name:`欢迎归来，归灯端测${i}。`})).toBeVisible();
      const camp=await page.request.get('/api/camp');expect((await camp.json()).matches).toBe(1);
      await page.getByRole('button',{name:'灯屑制作',exact:true}).click();await page.locator('.recipe').filter({has:page.getByRole('heading',{name:'第一缕·絮灯饰',exact:true})}).getByRole('button',{name:'制作',exact:true}).click();
      await expect(page.locator('.recipe').filter({has:page.getByRole('heading',{name:'第一缕·絮灯饰',exact:true})}).getByRole('button',{name:'已收藏'})).toBeVisible();
      await page.getByRole('button',{name:'外观与配装',exact:true}).click();await page.getByLabel('已收藏外观').selectOption('first-thread');await page.getByRole('button',{name:'穿戴并保存',exact:true}).click();
      await expect.poll(async()=>{const r=await page.request.get('/api/camp');return (await r.json()).equipment.cosmeticId;}).toBe('first-thread');
      await page.getByLabel('配装预设名称').fill('归灯端测预设');await page.getByRole('button',{name:'保存账户预设',exact:true}).click();
      await expect.poll(async()=>{const r=await page.request.get('/api/camp');return (await r.json()).presets?.length;}).toBe(1);
      await page.reload();await expect(page.getByLabel('已收藏外观')).toHaveValue('first-thread');
      await expect(page.locator('.preset-list button').filter({hasText:'归灯端测预设'})).toBeVisible();
    }
    await pages[0]!.screenshot({path:'.local/screenshots/camp-crafted.png'});
    await pages[0]!.getByRole('button',{name:'开启归灯远征'}).click();await pages[0]!.getByRole('button',{name:'创建房间，获取邀请码',exact:true}).click();await expect(pages[0]!.getByRole('heading',{name:'灯火候你同行'})).toBeVisible();await pages[0]!.getByRole('button',{name:'离开房间'}).click();
    expect(errors).toEqual([]);
  }finally{await Promise.allSettled(contexts.map(context=>context.close()));const database=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await database.query('DELETE FROM matches WHERE id IN (SELECT match_id FROM match_rewards WHERE user_id=ANY($1::text[]))',[accountIds]);await database.query('DELETE FROM auth_user WHERE id=ANY($1::text[])',[accountIds]);}finally{await database.end();}}
});
