import {expect,type Page} from '@playwright/test';

export async function assertViewport(page:Page){
  const result=await page.evaluate(()=>{
    const app=document.querySelector('.app')!.getBoundingClientRect();
    const main=document.querySelector('main')!.getBoundingClientRect();
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,bodyWidth:document.body.scrollWidth,bodyHeight:document.body.scrollHeight,scrollX,scrollY,app:{x:app.x,y:app.y,width:app.width,height:app.height},main:{x:main.x,y:main.y,right:main.right,bottom:main.bottom}};
  });
  expect(result.documentWidth).toBeLessThanOrEqual(result.width);expect(result.documentHeight).toBeLessThanOrEqual(result.height);
  expect(result.bodyWidth).toBeLessThanOrEqual(result.width);expect(result.bodyHeight).toBeLessThanOrEqual(result.height);
  expect(result.scrollX).toBe(0);expect(result.scrollY).toBe(0);expect(result.app.width).toBeLessThanOrEqual(result.width);
  expect(result.main.x).toBeGreaterThanOrEqual(0);expect(result.main.y).toBeGreaterThanOrEqual(0);expect(result.main.right).toBeLessThanOrEqual(result.width+1);expect(result.main.bottom).toBeLessThanOrEqual(result.height+1);
  const missing=await page.locator('button').evaluateAll(buttons=>buttons.filter(button=>!button.querySelector('svg.button-svg')).map(button=>button.getAttribute('aria-label')||button.textContent));
  expect(missing).toEqual([]);
  return result;
}
