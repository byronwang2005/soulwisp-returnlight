import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{localStorage.setItem('wangxu-quality','low');localStorage.setItem('wangxu-tutorial-step','2');});
await page.goto(process.env.WEB_TEST_URL||'http://127.0.0.1:5174');await page.getByRole('button',{name:'先体验归灯训练'}).click();await page.getByRole('heading',{name:'战斗也会留下线索'}).waitFor();await page.waitForTimeout(4000);
assert.equal(await page.locator('.tutorial-guide.compact').count(),1);
for(const name of ['移动↑','交互 / 救援','攻击 / 推挤']){const box=await page.getByRole('button',{name:new RegExp(name)}).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844,`${name} stays inside viewport`);}
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.getByLabel('选择可见目标').selectOption({label:'训练守卫'});await page.keyboard.press('q');await page.keyboard.press('Shift');await page.keyboard.press('Space');await page.waitForTimeout(100);await page.screenshot({path:'apps/web/test-output/mobile-training-combat.png'});
await page.getByRole('button',{name:'展开或收起训练指引'}).click();assert.equal(await page.locator('.tutorial-guide.compact').count(),0);await page.getByRole('button',{name:'展开或收起训练指引'}).click();
await page.setViewportSize({width:1440,height:1050});await page.waitForTimeout(1000);await page.keyboard.press('Space');await page.waitForTimeout(100);await page.screenshot({path:'apps/web/test-output/combat-clear.png'});
assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,mobile:'390x844',controlsInViewport:true,foldingGuide:true,pageErrors:errors}));await browser.close();
