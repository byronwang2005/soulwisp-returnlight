import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {assertViewport} from './viewport-helpers';

test('antique typography, bronze contrast and CCC SVG morphs survive responsive navigation',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const fonts:string[]=[];page.on('request',request=>{if(request.url().includes('.woff'))fonts.push(request.url());});
  await page.addInitScript(()=>localStorage.setItem('wangxu-quality','low'));
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  const design=await page.evaluate(()=>({bodyFont:getComputedStyle(document.body).fontFamily,headingFont:getComputedStyle(document.querySelector('h1')!).fontFamily,paper:getComputedStyle(document.documentElement).color,ink:getComputedStyle(document.body).backgroundColor,loaded:document.fonts.check('32px "Ma Shan Zheng"','灯火之下'),bodyLoaded:document.fonts.check('14px "Noto Serif SC Variable"','归灯训练')}));
  expect(design.bodyFont).toContain('Noto Serif SC Variable');expect(design.headingFont).toContain('Ma Shan Zheng');expect(design.loaded&&design.bodyLoaded).toBe(true);
  const contrast=(front:string,back:string)=>{const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=luminance(front),b=luminance(back);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  expect(contrast(design.paper,design.ink)).toBeGreaterThan(7);
  const mutedContrast=contrast('rgb(170,167,148)','rgb(48,49,39)');expect(mutedContrast).toBeGreaterThan(4.5);
  const primaryContrast=contrast('rgb(33,25,15)','rgb(187,144,87)');expect(primaryContrast).toBeGreaterThan(4.5);
  const button=page.getByRole('button',{name:'先体验归灯训练',exact:true});
  const path=button.locator('svg path');const original=await path.getAttribute('d');await button.hover();
  await expect.poll(()=>path.getAttribute('d')).not.toBe(original);await page.mouse.move(1,1);await expect(button).toHaveAttribute('data-icon-active','false');
  await button.focus();await expect(button).toHaveAttribute('data-icon-active','true');await page.locator('.brand').focus();
  const counts=[];
  for(const size of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await page.setViewportSize(size);await assertViewport(page);
    const missing=await page.locator('button').evaluateAll(buttons=>buttons.filter(button=>!button.querySelector('svg.button-svg')).map(button=>button.textContent));expect(missing).toEqual([]);
    counts.push({size,buttons:await page.locator('button').count()});
    if(size.width===1440||size.width===390)await page.screenshot({path:`.local/screenshots/bronze-welcome-${size.width}.png`});
  }
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();await page.evaluate(()=>document.fonts.ready);await assertViewport(page);
  expect(await page.locator('.auth-modal button').count()).toBe(await page.locator('.auth-modal button svg.button-svg').count());
  await page.screenshot({path:'.local/screenshots/bronze-auth-mobile.png'});await page.getByRole('button',{name:'关闭登录',exact:true}).click();
  await page.getByRole('button',{name:'音乐与反馈设置',exact:true}).click();await page.getByLabel('减少动态效果', {exact:true}).check();
  await expect(page.locator('button').first()).toHaveAttribute('data-icon-motion','always');await page.getByRole('button',{name:'关闭反馈设置',exact:true}).click();
  await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();await expect(page.getByRole('heading',{name:'循灯而行',exact:true})).toBeVisible();await page.evaluate(()=>document.fonts.ready);await assertViewport(page);
  expect(await page.locator('button').count()).toBe(await page.locator('button svg.button-svg').count());
  await page.screenshot({path:'.local/screenshots/bronze-training-mobile.png'});expect(errors).toEqual([]);
  expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(url=>url.startsWith('http://127.0.0.1:5175/'))).toBe(true);
  mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/bronze-design.json',JSON.stringify({capturedAt:new Date().toISOString(),design,primaryContrast,mutedContrast,counts,fontFilesRequested:new Set(fonts).size,errors},null,2));
});
