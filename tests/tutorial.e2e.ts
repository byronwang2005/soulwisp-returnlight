import 'dotenv/config';
import pg from 'pg';
import {expect,test} from '@playwright/test';
import {browserView,completeTraining,interactAt} from './training-browser';
for(const mode of ['desktop','mobile','wolf'] as const)test(`six-region lessons through ${mode} movement and action controls`,async({browser})=>{
  test.setTimeout(360000);const context=await browser.newContext({viewport:mode==='mobile'?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:mode==='mobile'?2:1,hasTouch:mode==='mobile'});const page=await context.newPage(),errors:string[]=[];let accountId:string|undefined;
  try{page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(wolf=>{localStorage.setItem('wangxu-render-mode','low');localStorage.setItem('wangxu-tutorial-step','0');if(wolf)localStorage.setItem('wangxu-wolf-tutorial','0');},mode==='wolf');await page.goto('/');
    if(mode==='wolf'){
      const response=await page.request.post('/api/auth/sign-up/email',{headers:{Origin:new URL(page.url()).origin},data:{email:`training-${crypto.randomUUID()}@example.test`,name:'教程验收',password:'Training-Local-24!'}});expect(response.ok()).toBe(true);accountId=(await response.json()).user.id;
      await page.reload();await page.getByRole('button',{name:'蚀月者练习',exact:true}).click();
    }else await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();
    await expect.poll(async()=>!!(await browserView(page))).toBe(true);expect(await page.getByLabel('选择可见目标').count()).toBe(0);
    await completeTraining(page,{touch:mode==='mobile',wolf:mode==='wolf'});expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await context.close();if(accountId){const database=new pg.Pool({connectionString:process.env.DATABASE_URL});await database.query('DELETE FROM auth_user WHERE id=$1',[accountId]);await database.end();}}
});
test('leave and resume reconstructs the current physical lesson',async({page})=>{
  test.setTimeout(90000);await page.addInitScript(()=>localStorage.setItem('wangxu-render-mode','low'));await page.goto('/');await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();await expect.poll(async()=>page.locator('canvas').evaluate(canvas=>!!(canvas as any).__soulwisp?.view)).toBe(true);await interactAt(page,'resource-training-start','node-2');await page.getByRole('button',{name:'下一课 →',exact:true}).click();await page.getByRole('button',{name:'保存并离开',exact:true}).click();await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();await expect(page.getByRole('heading',{name:'点亮共同的归途',exact:true})).toBeVisible();await expect.poll(async()=>page.locator('canvas').evaluate(canvas=>!!(canvas as any).__soulwisp?.view)).toBe(true);expect((await browserView(page)).self.resources).toBe(4);
});
