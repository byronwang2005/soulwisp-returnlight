import {screenToWorld} from '../apps/web/src/movement';
import {expect,test} from '@playwright/test';

test('character follows authoritative movement, turns in all directions and retains facing at rest',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByRole('button',{name:'先体验归灯训练',exact:true}).click();
  await expect(page.getByRole('heading',{name:'循灯而行',exact:true})).toBeVisible();
  const pose=()=>page.evaluate(()=>{const canvas=document.querySelector('canvas') as HTMLCanvasElement&{__soulwisp?:{scene:{getObjectByName:(name:string)=>{position:{x:number;z:number};rotation:{y:number}}|undefined}}};const player=canvas?.__soulwisp?.scene.getObjectByName('player:trainee');return player?{x:player.position.x,z:player.position.z,yaw:player.rotation.y}:null;});
  await expect.poll(async()=>!!await pose()).toBe(true);
  for(const [key,expectedYaw,axis,sign]of [['d',Math.PI/2,'x',1],['a',-Math.PI/2,'x',-1],['s',0,'z',1],['w',Math.PI,'z',-1]] as const){
    const direction=screenToWorld({x:key==='d'?1:key==='a'?-1:0,y:key==='s'?1:key==='w'?-1:0}),yaw=Math.atan2(direction.x,direction.y);const before=(await pose())!;await page.keyboard.down(key);try{await expect.poll(async()=>{const current=await pose();return current?(current[axis]-before[axis])*sign:0;},{intervals:[50]}).toBeGreaterThan(.7);}finally{await page.keyboard.up(key);}
    await expect.poll(async()=>{const after=await pose();return after?Math.abs(Math.atan2(Math.sin(after.yaw-yaw),Math.cos(after.yaw-yaw))):10;}).toBeLessThan(.2);
    const after=(await pose())!;expect((after[axis]-before[axis])*sign).toBeGreaterThan(.5);
    await page.waitForTimeout(350);const resting=(await pose())!;expect(Math.abs(Math.atan2(Math.sin(resting.yaw-after.yaw),Math.cos(resting.yaw-after.yaw)))).toBeLessThan(.2);
  }
  const drawCalls=await page.evaluate(()=>{const canvas=document.querySelector('canvas') as HTMLCanvasElement&{__soulwisp:{renderer:{info:{render:{calls:number}}}}};return canvas.__soulwisp.renderer.info.render.calls;});
  expect(drawCalls).toBeLessThan(280);expect(errors).toEqual([]);
});
