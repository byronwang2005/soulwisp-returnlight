import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { Room } from '@colyseus/core';
import { GameEngine, getConfig, RULES } from '@wangxu/rules';
import type { GameCommand, GameView, MapNode, PlayerView } from '@wangxu/shared';

// Run: node --import tsx scripts/measure-simulation.ts [--seconds=60]
// This measures one in-process authority and its private JSON payloads, without rendering or sockets.
const seconds=Number(process.argv.find(arg=>arg.startsWith('--seconds='))?.split('=')[1]??60);
if(!Number.isInteger(seconds)||seconds<60||seconds>120)throw new Error('--seconds must be an integer from 60 to 120');
const seed='ten-player-cpu-baseline-v1',game=new GameEngine({roomId:'cpu-baseline',invite:'LOCAL',config:getConfig(10),seed});
const ids=Array.from({length:10},(_,i)=>`baseline-${i}`);
for(const [index,id]of ids.entries())game.addPlayer({id,name:`测量同行${index+1}`});
for(const [index,id]of ids.entries()){
  const view=game.viewFor(id),self=view.players.find(p=>p.id===id)!;
  game.command(id,{type:'choose',profession:self.profession,form:index===1||index===2||index===3||index===9?1:0});
}
ids.forEach(id=>game.command(id,{type:'ready',ready:true}));
// Advance the preparation through the public clock before the measurement, so all measured ticks run active play.
game.tick(game.config.prepSeconds);
const views=new Map(ids.map(id=>[id,game.viewFor(id)]));
const bots=new Map(ids.map((id,index)=>[id,{seq:0,node:1,direction:index%2?1:-1,lastAttack:-10,lastSkill:-10,lastTransform:-100,lastInteract:-10}]));
const commands:Record<string,{attempted:number;accepted:number}>={};
const ticks:number[]=[],loops:number[]=[],intervals:number[]=[],drifts:number[]=[],viewTimes:number[]=[];
let payloadBytes=0,payloadCount=0,tickCount=0,viewFrames=0,intervalsOver50=0,intervalsOver55=0;
const rssStart=process.memoryUsage().rss;let rssPeak=rssStart;
function send(id:string,command:GameCommand){const stats=commands[command.type]??=({attempted:0,accepted:0});stats.attempted++;const ok=game.command(id,command);if(ok)stats.accepted++;return ok;}
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
function body(view:GameView){return view.players.find(p=>p.id===view.self.id)!;}
function nearby(view:GameView,self:PlayerView){return view.players.filter(p=>p.id!==self.id&&p.x!==null&&p.y!==null&&!p.sealed&&distance(self as {x:number;y:number},p as {x:number;y:number})<=RULES.interactRange);}
function act(id:string){
  const view=views.get(id)!,self=body(view),bot=bots.get(id)!;if(self.down||self.sealed||self.x===null||self.y===null)return;
  const point=self as {x:number;y:number},others=nearby(view,self),now=view.elapsed;
  for(const offer of view.self.offers??[])if(!offer.escrow)send(id,{type:'accept',from:offer.from,itemId:offer.itemId});
  if(view.self.interaction)return;
  if(view.self.faction==='wolf'&&now-bot.lastTransform>=RULES.transformationCooldown){if(send(id,{type:'transform'}))bot.lastTransform=now;}
  if(now-bot.lastSkill>=1&&view.self.skillCooldown<=0){
    let target:string|undefined;
    switch(self.profession){
      case 'warden':target=self.id;break;
      case 'scavenger':target=view.objects.find(o=>o.kind==='chest'&&distance(point,o)<=RULES.interactRange)?.id;break;
      case 'broker':target=others.find(p=>!p.down)?.id;break;
      case 'medic':target=others.find(p=>p.down)?.id;break;
      case 'engineer':target=view.objects.find(o=>['beacon','cleanse'].includes(o.kind)&&distance(point,o)<=RULES.interactRange)?.id;break;
      case 'forensic':target=view.self.evidence[0]?.id??view.evidence[0]?.id;break;
    }
    bot.lastSkill=now;
    if(send(id,{type:'skill',...(target?{targetId:target}:{})})&&(self.profession==='scavenger'||self.profession==='medic'&&target))return;
  }
  if(now-bot.lastAttack>=.75){const target=others.find(p=>!p.down&&distance(point,p as {x:number;y:number})<=RULES.attackRange);send(id,{type:'attack',...(target?{targetId:target.id}:{})});bot.lastAttack=now;}
  if(now-bot.lastInteract>=1){
    const resource=view.objects.find(o=>o.kind==='resource'&&distance(point,o)<=RULES.interactRange&&view.self.resources<4);
    if(resource){bot.lastInteract=now;if(send(id,{type:'interact',targetId:resource.id}))return;}
    const altar=view.objects.find(o=>o.kind==='altar'&&distance(point,o)<=RULES.interactRange);
    if(view.self.faction==='wolf'&&altar&&view.self.wolfBudget){bot.lastInteract=now;if(send(id,{type:'corrupt',targetId:altar.id}))return;}
  }
  let node:MapNode=view.nodes[bot.node]!;
  if(distance(point,node)<15){const count=view.nodes.length-1;bot.node=1+(bot.node-1+bot.direction+count)%count;node=view.nodes[bot.node]!;}
  const dx=node.x-self.x,dy=node.y-self.y,length=Math.max(1,Math.hypot(dx,dy));send(id,{type:'move',x:dx/length,y:dy/length,seq:++bot.seq});
}
function distribution(values:number[]){const sorted=values.slice().sort((a,b)=>a-b),at=(q:number)=>sorted[Math.max(0,Math.ceil(q*sorted.length)-1)]??0;return {samples:sorted.length,mean:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),p50:at(.5),p95:at(.95),p99:at(.99),max:at(1)};}
console.log(`Measuring ten-player authority with Colyseus fixed timestep at 20Hz for at least ${seconds}s; ten private JSON views every 100ms.`);
const scheduler=new Room();
const started=performance.now();let last=started,finished=false,first1200TicksWallSeconds:number|undefined;
await new Promise<void>(resolveDone=>{
  scheduler.clock.start();
  scheduler.setFixedTimestep(ctx=>{
    if(finished)return;
    const entered=performance.now(),interval=entered-last;last=entered;intervals.push(interval);if(interval>50)intervalsOver50++;if(interval>55)intervalsOver55++;
    tickCount++;drifts.push(entered-(started+tickCount*50));
    ids.forEach(act);const beforeTick=performance.now();game.tick(ctx.dt);ticks.push(performance.now()-beforeTick);
    if(tickCount%2===0){const beforeViews=performance.now();for(const id of ids){const view=game.viewFor(id);views.set(id,view);payloadBytes+=Buffer.byteLength(JSON.stringify(view),'utf8');payloadCount++;}viewTimes.push(performance.now()-beforeViews);viewFrames++;}
    loops.push(performance.now()-entered);rssPeak=Math.max(rssPeak,process.memoryUsage().rss);
    if(tickCount===1200)first1200TicksWallSeconds=(performance.now()-started)/1000;
    if(tickCount>=seconds*20&&performance.now()-started>=seconds*1000){finished=true;scheduler.setTimestep();scheduler.clock.stop();resolveDone();}
  },20);
});
const wallMs=performance.now()-started,cpu=cpus()[0];
const rssEnd=process.memoryUsage().rss;rssPeak=Math.max(rssPeak,rssEnd);
const report={
  schemaVersion:1,measuredAt:new Date().toISOString(),runtime:{node:process.version,platform:platform(),arch:arch(),cpu:cpu?.model??'unknown',logicalCpus:cpus().length},
  workload:{players:10,seed,ruleVersion:game.config.ruleVersion,secondsRequested:seconds,wallSeconds:wallMs/1000,simulatedSeconds:tickCount*.05,ticks:tickCount,targetHz:20,observedHz:tickCount/(wallMs/1000),viewFrames,payloads:payloadCount,phaseAtEnd:game.phase,commands},
  tickMs:distribution(ticks),completeLoopMs:distribution(loops),allTenViewsAndJsonMs:distribution(viewTimes),
  schedule:{scheduler:'@colyseus/core 0.18.18 Room.setFixedTimestep',first1200TicksWallSeconds,wallMinusSimulatedMs:wallMs-tickCount*50,intervalMs:distribution(intervals),cumulativeDriftMs:distribution(drifts),intervalsOver50Ms:intervalsOver50,intervalsOver55Ms:intervalsOver55,ticksOver50Ms:ticks.filter(t=>t>50).length,loopsOver50Ms:loops.filter(t=>t>50).length},
  memory:{rssStartBytes:rssStart,rssEndBytes:rssEnd,rssPeakBytes:rssPeak},
  payload:{averageBytes:payloadBytes/payloadCount,totalEncodedBytes:payloadBytes,uncompressedEncodedBytesPerWallSecond:payloadBytes/(wallMs/1000)},
  interpretation:'Local Node authority CPU, scheduling, memory and JSON baseline only. No browser GPU/FPS, socket delivery, database, voice, WAN latency or multi-room capacity was measured.',
};
const output=resolve('.local/verification/simulation.json');await mkdir(resolve('.local/verification'),{recursive:true});await writeFile(output,`${JSON.stringify(report,null,2)}\n`);
game.dispose();console.log(JSON.stringify({output,tickMs:report.tickMs,observedHz:report.workload.observedHz,rssPeakMiB:rssPeak/1024/1024,averagePayloadBytes:report.payload.averageBytes,intervalsOver50Ms:intervalsOver50,intervalsOver55Ms:intervalsOver55,ticksOver50Ms:report.schedule.ticksOver50Ms}));
