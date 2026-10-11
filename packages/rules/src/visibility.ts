import type {Vec2,VisionView} from '@wangxu/shared';
import {RULES} from './content.js';
export function effectiveVision(observer:{boons:string[];relics:string[]}){return RULES.visionRadius*(observer.boons.includes('watcher')?1.15:1)*(observer.relics.includes('lantern')?1.1:1);}
// Convex clipping transmits only the visible boundary, never a hidden fog center.
export function visibilityView(observer:Vec2&{boons:string[];relics:string[]},fogs:(Vec2&{until:number})[],elapsed:number,matchKey:string):VisionView {
 const radius=effectiveVision(observer),circle=(p:Vec2,r:number)=>Array.from({length:128},(_,i)=>({x:p.x+Math.cos(i*Math.PI/64)*r,y:p.y+Math.sin(i*Math.PI/64)*r}));
 const bounds=circle(observer,radius),occluded:Vec2[][]=[];
 for(const fog of fogs){if(fog.until<=elapsed||Math.hypot(fog.x-observer.x,fog.y-observer.y)<=RULES.fogRadius||Math.hypot(fog.x-observer.x,fog.y-observer.y)>=radius+RULES.fogRadius)continue;
  let polygon=circle(fog,RULES.fogRadius);
  for(let i=0;i<bounds.length&&polygon.length;i++){const a=bounds[i],b=bounds[(i+1)%bounds.length],side=(p:Vec2)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x),next:Vec2[]=[];
   for(let j=0;j<polygon.length;j++){const p=polygon[j],q=polygon[(j+1)%polygon.length],sp=side(p),sq=side(q);if(sp>=0)next.push(p);if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);next.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}polygon=next;
  }if(polygon.length>=3)occluded.push(polygon);
 }
 return {matchKey,radius,bonuses:[...(observer.boons.includes('watcher')?['回望 +15%']:[]),...(observer.relics.includes('lantern')?['旧巡灯 +10%']:[])],occluded};
}
