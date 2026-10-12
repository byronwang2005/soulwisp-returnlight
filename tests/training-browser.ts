import {worldToScreen} from '../apps/web/src/movement';
import {expect,type Page} from '@playwright/test';
import type {GameView} from '@wangxu/shared';
import {mapRoute,approachPoint} from '@wangxu/shared';
export async function browserView(page:Page):Promise<GameView>{return page.locator('canvas').evaluate(canvas=>(canvas as HTMLCanvasElement&{__soulwisp:{view:GameView}}).__soulwisp.view);}
export async function walkPoint(page:Page,point:{x:number;y:number},touch=false){
  const held=new Set<string>();let pad:string|undefined;
  const stop=async()=>{for(const key of held)await page.keyboard.up(key);held.clear();if(pad){await page.mouse.up();pad=undefined;}await page.waitForTimeout(130);};
  try{const deadline=Date.now()+22000;while(Date.now()<deadline){const view=await browserView(page),me=view.players.find(p=>p.id===view.self.id)!;const delta={x:point.x-me.x!,y:point.y-me.y!},screen=worldToScreen(delta),dx=screen.x,dy=screen.y;
    if(Math.hypot(dx,dy)<14){await stop();return;}
    if(me.down)throw new Error('Trainee was downed while following the route');
    if(touch){const key=Math.abs(dx)>Math.abs(dy)?dx>0?'→':'←':dy>0?'↓':'↑';if(pad!==key){if(pad)await page.mouse.up();const box=await page.getByRole('button',{name:`移动${key}`,exact:true}).boundingBox();if(!box)throw new Error('Movement pad unavailable');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();pad=key;}}
    else{const next=new Set<string>();if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)/2.5)next.add(dx>0?'d':'a');if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)/2.5)next.add(dy>0?'s':'w');for(const key of held)if(!next.has(key)){await page.keyboard.up(key);held.delete(key);}for(const key of next)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}}
    await page.waitForTimeout(90);
  }throw new Error(`Movement timed out toward ${JSON.stringify(point)}`);}finally{await stop();}
}
export async function walkTarget(page:Page,id:string,nodeId:string,touch=false){
  const view=await browserView(page),me=view.players.find(p=>p.id===view.self.id)!;
  const route=mapRoute({x:me.x!,y:me.y!},view.nodes,view.edges!,nodeId);
  for(const node of route)await walkPoint(page,view.nodes.find(n=>n.id===node)!,touch);
  const current=await browserView(page),target=current.objects.find(o=>o.id===id)??current.players.find(p=>p.id===id);
  if(!target||target.x===null||target.y===null)throw new Error(`Target ${id} not visible after entering ${nodeId}`);
  const own=current.players.find(p=>p.id===current.self.id)!;await walkPoint(page,approachPoint({x:own.x!,y:own.y!},target as any),touch);
}
export async function interactAt(page:Page,id:string,nodeId:string,touch=false){
  await walkTarget(page,id,nodeId,touch);
  await expect.poll(async()=>{const view=await browserView(page);return view.self.actions?.find(a=>a.targetId===id&&a.action==='interact')?.enabled;}).toBe(true);
  await expect(page.locator('.target-bar')).toHaveAttribute('data-target-id',id);
  if(touch)await page.locator('.actions button').nth(0).click();else await page.keyboard.press('e');
  await expect.poll(async()=>(await browserView(page)).self.interaction?.targetId,{intervals:[50]}).toBe(id);
  await expect.poll(async()=>!(await browserView(page)).self.interaction,{timeout:8000,intervals:[100]}).toBe(true);
}
export async function completeTraining(page:Page,{touch=false,wolf=false,screenshots=false}:{touch?:boolean;wolf?:boolean;screenshots?:boolean}={}){
  const act=async(id:string,node:string)=>interactAt(page,id,node,touch);
  let lesson=1;const next=async()=>{lesson++;await expect(page.locator('.tutorial-guide .eyebrow')).toContainText(`/ ${lesson} / 6`);};
  await act('resource-training-start','node-2');await next();
  await act('chest-training','node-3');await act('warehouse','sanctuary');await act('stash','sanctuary');await act('beacon-0','node-1');await next();
  await walkPoint(page,(await browserView(page)).nodes.find(node=>node.id==='node-1')!,touch);
  if(touch){await page.locator('.actions button').nth(2).click();await page.locator('.actions button').nth(3).click();}else{await page.keyboard.press('q');await page.keyboard.press('Shift');}
  await walkTarget(page,'guardian','node-4',touch);
  if(touch)await page.locator('.actions button').nth(2).click();else await page.keyboard.press('q');
  for(let i=0;i<3;i++){if(touch)await page.locator('.actions button').nth(1).click();else await page.keyboard.press('Space');await page.waitForTimeout(800);}
  await expect.poll(async()=>(await browserView(page)).eliteDefeated).toBe(true);
  await act('guide-1','node-4');await act('resource-training-repair','node-4');await act('beacon-1','node-4');
  if(wolf){await walkTarget(page,'altar-training','node-1',touch);await page.getByRole('button',{name:'显形 8s',exact:true}).click();await page.getByRole('button',{name:'腐化祭坛',exact:true}).click();await page.getByRole('button',{name:'灰雾',exact:true}).click();await expect.poll(async()=>(await browserView(page)).moon,{timeout:8000}).toBeGreaterThan(0);}
  await act('cleanse','sanctuary');if(screenshots)await page.screenshot({path:'.local/screenshots/scene-training-engineering.png'});await next();
  const publish=page.getByRole('button',{name:'发布至证据板',exact:true});await publish.first().click();await page.getByLabel('议会发言').fill('我亲历了点灯、救援与公共降蚀，可以核对工程记录。');await page.locator('.council-modal').getByRole('button',{name:'发送',exact:true}).click();await page.getByRole('button',{name:'进入表决',exact:true}).click();await page.getByRole('button',{name:'弃权',exact:true}).click();await page.getByRole('button',{name:'确认弃权',exact:true}).click();await next();
  await page.locator('.boon-card').first().click();await next();
  await act('resource-training-core','node-2');await act('core','node-2');await act('purify','sanctuary');await walkTarget(page,'exit','node-4',touch);
  await expect(page.getByRole('button',{name:'完成归灯训练',exact:true})).toBeEnabled({timeout:30000});
  if(screenshots)await page.screenshot({path:'.local/screenshots/scene-training-extraction.png'});
  await page.getByRole('button',{name:'完成归灯训练',exact:true}).click();await expect(page.getByRole('heading',{name:'你的第一束归灯，已点亮。',exact:true})).toBeVisible();
}
