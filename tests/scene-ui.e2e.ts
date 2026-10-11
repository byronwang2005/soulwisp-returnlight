import {expect,test} from '@playwright/test';
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}])test(`training header and character life fit ${viewport.width} × ${viewport.height}`,async({page})=>{
 await page.setViewportSize(viewport);await page.addInitScript(()=>{localStorage.setItem('wangxu-tutorial-step','2');localStorage.setItem('wangxu-render-mode','high');});await page.goto('/');await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();await expect(page.getByRole('heading',{name:'战斗也会留下线索'})).toBeVisible();
 expect(await page.locator('.health').count()).toBe(0);
 const header=await page.locator('.tutorial-guide .section-head').evaluate(element=>{const box=element.getBoundingClientRect();return [...element.querySelectorAll('button,.eyebrow')].map(e=>{const r=e.getBoundingClientRect();return {inside:r.left>=box.left&&r.right<=box.right+1,nowrap:getComputedStyle(e).whiteSpace==='nowrap',height:r.height};});});
 expect(header.every(e=>e.inside&&e.nowrap)).toBe(true);
 await expect.poll(()=>page.locator('canvas').evaluate(canvas=>!!(canvas as any).__soulwisp?.scene.getObjectByName('character-life'))).toBe(true);
 await expect.poll(()=>page.locator('canvas').evaluate(canvas=>!!(canvas as any).__soulwisp?.scene.getObjectByName('outside-city-landscape'))).toBe(true);
 await page.waitForTimeout(3000);await page.screenshot({path:`.local/screenshots/scene-ui-${viewport.width}x${viewport.height}.png`});
});
