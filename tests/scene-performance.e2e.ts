import {expect,test,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {completeTraining} from './training-browser';
test.skip(process.env.NATIVE_PERF!=='1','Opt-in two-minute native GPU acceptance');
async function sample(page:Page){
  await page.evaluate(()=>{
    const state={frames:[] as number[],levels:[] as {at:number;level:string;dpr:string;calls:number}[],at:performance.now(),last:0,active:true};
    (window as any).__frameAcceptance=state;
    function frame(now:number){if(!state.active)return;if(state.last)state.frames.push(now-state.last);state.last=now;
      if(state.frames.length%60===0){const world=document.querySelector('.world') as HTMLElement,canvas=document.querySelector('canvas') as any;state.levels.push({at:now-state.at,level:world?.dataset.qualityLevel??'',dpr:world?.dataset.renderDpr??'',calls:canvas?.__soulwisp?.renderer.info.render.calls??0});}
      requestAnimationFrame(frame);
    }requestAnimationFrame(frame);
  });
}
async function report(page:Page,name:string){
  const raw=await page.evaluate(()=>{const state=(window as any).__frameAcceptance;state.active=false;const canvas=document.querySelector('canvas') as any,renderer=canvas.__soulwisp.renderer,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {durationMs:performance.now()-state.at,frames:state.frames as number[],levels:state.levels,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'};});
  const frames=[...raw.frames].sort((a,b)=>a-b),percentile=(p:number)=>frames[Math.floor((frames.length-1)*p)],result={scenario:name,durationMs:raw.durationMs,frameCount:frames.length,medianFps:1000/percentile(.5),p95FrameMs:percentile(.95),gpu:raw.gpu,samples:raw.levels};
  await mkdir('docs/verification',{recursive:true});await writeFile(`docs/verification/scene-gpu-${name}.json`,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,samples:undefined}));expect(raw.gpu).not.toMatch(/SwiftShader|llvmpipe/i);expect(raw.durationMs).toBeGreaterThanOrEqual(120000);expect(result.medianFps).toBeGreaterThanOrEqual(59);expect(result.p95FrameMs).toBeLessThanOrEqual(20);
}
test('native GPU complete tutorial at automatic DPR 2',async({browser})=>{
  test.setTimeout(360000);const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});const page=await context.newPage();
  try{await page.addInitScript(()=>localStorage.setItem('wangxu-render-mode','auto'));await page.goto('/');await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();await page.waitForTimeout(7000);await sample(page);await completeTraining(page,{screenshots:true});await report(page,'tutorial');}finally{await context.close();}
});
test('native GPU ten-player scene at automatic DPR 2',async({browser})=>{
  test.setTimeout(170000);const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});const page=await context.newPage();
  try{await page.route('**/scene-gpu-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@fs'+process.cwd()+'/tests/scene-harness.tsx"></script></body></html>'}));await page.goto('/scene-gpu-fixture');await page.waitForTimeout(7000);await sample(page);for(let i=0;i<4;i++){await page.keyboard.down(['d','s','a','w'][i]);await page.waitForTimeout(1000);await page.keyboard.up(['d','s','a','w'][i]);await page.waitForTimeout(30000);}await page.screenshot({path:'.local/screenshots/scene-ten-player-dpr2.png'});await report(page,'ten-player');}finally{await context.close();}
});
