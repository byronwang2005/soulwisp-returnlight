import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {assertViewport} from './viewport-helpers';

test('paired Chinese and Latin typography, semantic SVG states and navigation markers stay consistent',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const fonts:string[]=[];page.on('request',request=>{if(request.url().includes('.woff'))fonts.push(request.url());});
  await page.addInitScript(()=>localStorage.setItem('wangxu-quality','low'));
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  const design=await page.evaluate(()=>({bodyFont:getComputedStyle(document.body).fontFamily,headingFont:getComputedStyle(document.querySelector('h1')!).fontFamily,paper:getComputedStyle(document.documentElement).color,ink:getComputedStyle(document.body).backgroundColor,loaded:document.fonts.check('600 32px "Noto Serif SC Variable"','灯火之下'),bodyLoaded:document.fonts.check('14px "Noto Sans SC Variable"','归灯训练'),latinHeadingLoaded:document.fonts.check('600 32px "Source Serif 4 Variable"','Soulwisp'),latinBodyLoaded:document.fonts.check('14px "Source Sans 3 Variable"','Returnlight')}));
  expect(design.bodyFont).toContain('Source Sans 3 Variable');expect(design.headingFont).toContain('Source Serif 4 Variable');expect(design.loaded&&design.bodyLoaded&&design.latinHeadingLoaded&&design.latinBodyLoaded).toBe(true);
  const contrast=(front:string,back:string)=>{const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=luminance(front),b=luminance(back);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  expect(contrast(design.paper,design.ink)).toBeGreaterThan(7);
  const mutedContrast=contrast('rgb(170,167,148)','rgb(48,49,39)');expect(mutedContrast).toBeGreaterThan(4.5);
  const primaryContrast=contrast('rgb(33,25,15)','rgb(187,144,87)');expect(primaryContrast).toBeGreaterThan(4.5);
  const button=page.getByRole('button',{name:'先体验归灯训练',exact:true});
  const path=button.locator('svg path');const original=await path.getAttribute('d');await button.hover();
  await page.waitForTimeout(300);expect(await path.getAttribute('d')).toBe(original);
  await expect(button.locator('svg')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, -1)');await page.mouse.move(1,1);await expect(button).toHaveAttribute('data-icon-active','false');
  await button.focus();await expect(button).toHaveAttribute('data-icon-active','true');await page.locator('.brand').focus();
  const navigation=page.getByRole('navigation',{name:'主导航'});
  for(const name of ['余灯集市','远征大厅','归灯训练']){
    const nav= navigation.getByRole('button',{name,exact:true});const glyph=await nav.locator('svg path').getAttribute('d');
    await nav.hover();await page.waitForTimeout(220);expect(await nav.locator('svg path').getAttribute('d')).toBe(glyph);
    expect(await nav.evaluate(el=>getComputedStyle(el,'::after').content)).toBe('none');
  }
  const campNav=navigation.getByRole('button',{name:'余灯集市',exact:true});expect(await campNav.getAttribute('aria-current')).toBe('page');
  const campGlyph=await campNav.locator('svg path').getAttribute('d');
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
  await page.screenshot({path:'.local/screenshots/bronze-training-mobile.png'});
  const navTraining=navigation.getByRole('button',{name:'归灯训练',exact:true});await expect(navTraining).toHaveAttribute('aria-current','page');
  expect(await navigation.locator('[data-icon-kind="camp"] svg path').getAttribute('d')).toBe(campGlyph);
  const guideButton=page.getByRole('button',{name:'展开或收起训练指引',exact:true});const guidePath=guideButton.locator('svg path');const beforeExpand=await guidePath.getAttribute('d');
  await guideButton.click();await expect.poll(()=>guidePath.getAttribute('d')).not.toBe(beforeExpand);await expect(guideButton).toHaveAttribute('data-icon-state','expanded');
  expect(errors).toEqual([]);
  expect(fonts.length).toBeGreaterThan(0);expect(fonts.every(url=>new URL(url).origin===new URL(page.url()).origin)).toBe(true);
  mkdirSync('.local/verification',{recursive:true});writeFileSync('.local/verification/bronze-design.json',JSON.stringify({capturedAt:new Date().toISOString(),design,primaryContrast,mutedContrast,counts,fontFilesRequested:new Set(fonts).size,errors},null,2));
});
