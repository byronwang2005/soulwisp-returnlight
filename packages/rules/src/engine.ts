import type { Evidence, Faction, FeedbackEvent, GameCommand, GameConfig, GameResult, GameView, Phase, Profession, RelicItem, Settlement, SelfView } from '@wangxu/shared';
import { getLayout, seedNumber, type LayoutObject } from './config.js';
import { BOONS, RELICS, RULES, professionForms } from './content.js';

interface Player {
 id:string;name:string;slot:number;profession:Profession;form:number;cosmetic:string;ready:boolean;connected:boolean;disconnectedAt:number|null;
 faction:Faction|null;sealed:boolean;down:boolean;hp:number;x:number;y:number;shield:number;shieldUntil:number;transformUntil:number;
 moveX:number;moveY:number;seq:number;skillAt:number;attackAt:number;dodgeAt:number;transformAt:number;staggerUntil:number;pushImmuneUntil:number;downUntil:number;
 resources:number;supplies:number;loot:RelicItem[];relics:string[];boons:string[];evidence:Evidence[];ghostVote:boolean;ghostMessageChapter:number;lastSay:number;
 interaction:{targetId:string;kind:string;elapsed:number;duration:number}|null;draftOptions:string[];voted:boolean;stashUsed:boolean;stored:RelicItem[];carryingCore:boolean;ghostLightChapter:number;region:string;routeUntil:number;feedback:FeedbackEvent[];collisionAt:number;
}
export interface EngineOptions {roomId:string;invite:string;config:GameConfig;seed?:number|string;clock?:()=>number;onSettlement?:(settlement:Settlement)=>void|Promise<void>;}
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export class GameEngine {
 readonly roomId:string;readonly invite:string;readonly mapSeed:number;readonly config:GameConfig;readonly layout:ReturnType<typeof getLayout>;readonly players=new Map<string,Player>();
 objects:LayoutObject[];phase:Phase='LOBBY';chapter=0;remaining=0;elapsed=0;moon=0;sharedResources=0;beaconsLit=0;eliteDefeated=false;corePurified=false;holdProgress=0;removalCount=0;result:GameResult|null=null;
 private randomState:number;private deterministic=false;private clock:()=>number;private onSettlement:EngineOptions['onSettlement'];private matchSerial=0;private wolfBudget=0;private corruptions=0;private corrupted=new Set<string>();private retry=new Map<string,number>();private corruptAt=0;private cleansed=false;private finishCount=0;private chapterFinished=false;
 private voteSet=new Set<string>();private votes=new Map<string,string|null>();private publicEvidence:Evidence[]=[];private events:Evidence[]=[];private messages:GameView['messages']=[];private fogs:{x:number;y:number;until:number}[]=[];private monitored:string|null=null;private offers=new Map<string,{to:string;itemId:string;until:number;confirmed?:boolean;deliverAt?:number}>();private winnerPending:Faction|null=null;private pendingReason='';private aiAt=0;private coreHolder:string|null=null;
 private playElapsed=0;private escortHold=new Map<string,number>();private eventMeta=new Map<string,{region:string;action:string;at:number}>();private released=new Set<string>();private droppedItems=new Map<string,RelicItem>();private guideUntil=new Map<string,number>();private wardGrants=new Map<string,Set<string>>();private repairUntil=new Map<string,number>();private monitoredChapter=0;private feedbackSerial=new Map<string,number>();private objectPublicIds=new Map<string,string>();
 settlementError:unknown=null;
 constructor(options:EngineOptions){this.roomId=options.roomId;this.invite=options.invite;this.config={...options.config,professions:options.config.professions.slice()};if(!Number.isInteger(this.config.players)||this.config.players<4||this.config.players>10||this.config.professions.length!==this.config.players||this.config.humans+this.config.wolves!==this.config.players)throw new Error('非法人数配置');this.deterministic=options.seed!==undefined;this.randomState=seedNumber(options.seed??globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!)||1;this.mapSeed=this.randomState;this.layout=getLayout(this.config,this.mapSeed);this.objects=this.layout.objects.map(o=>({...o}));this.clock=options.clock??Date.now;this.onSettlement=options.onSettlement;}
 private random(){if(!this.deterministic)return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!/4294967296;let t=this.randomState+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
 addPlayer(input:{id:string;name:string;cosmetic?:string}) {
  if(typeof input.id!=='string'||!input.id||input.id.length>100||typeof input.name!=='string'||!input.name.trim())throw new Error('非法玩家信息');
  if(this.players.has(input.id)){this.reconnect(input.id);return;}
  if(this.phase!=='LOBBY'||this.players.size>=this.config.players)throw new Error('房间已满或已经开始');
  const occupied=new Set([...this.players.values()].map(p=>p.slot));const slot=this.config.professions.findIndex((_,i)=>!occupied.has(i));
  this.players.set(input.id,{id:input.id,name:input.name.trim().replace(/[\u0000-\u001f]/g,'').slice(0,32),cosmetic:input.cosmetic??'base',slot,profession:this.config.professions[slot]!,form:0,ready:false,connected:true,disconnectedAt:null,faction:null,sealed:false,down:false,hp:RULES.maxHp,x:500+slot*9,y:350,shield:0,shieldUntil:0,transformUntil:0,moveX:0,moveY:0,seq:-1,skillAt:0,attackAt:0,dodgeAt:0,transformAt:0,staggerUntil:0,pushImmuneUntil:0,downUntil:0,resources:0,supplies:0,loot:[],relics:[],boons:[],evidence:[],ghostVote:true,ghostMessageChapter:-1,lastSay:-100,interaction:null,draftOptions:[],voted:false,stashUsed:false,stored:[],carryingCore:false,ghostLightChapter:-1,region:'sanctuary',routeUntil:0,feedback:[],collisionAt:0});
 }
 removePlayer(id:string){if(this.phase==='LOBBY'||this.phase==='RESULT'&&!!this.result)return this.players.delete(id);this.disconnect(id);return false;}
 disconnect(id:string){const p=this.players.get(id);if(!p||!p.connected)return;p.connected=false;p.disconnectedAt=this.clock();p.moveX=p.moveY=0;this.interrupt(p);}
 reconnect(id:string){const p=this.players.get(id);if(!p)throw new Error('远征席位已失效');if(!this.result&&p.disconnectedAt!==null&&this.clock()-p.disconnectedAt>=RULES.reconnectMilliseconds){if(this.phase==='LOBBY')this.players.delete(id);else this.settle('invalid','玩家超过60秒未恢复连接');throw new Error('重连窗口已结束');}p.connected=true;p.disconnectedAt=null;this.maybeSettlePending();}
 invalidate(reason:string){if(!this.result)this.settle('invalid',reason);}
 dispose(){for(const p of this.players.values()){p.moveX=p.moveY=0;p.interaction=null;}this.offers.clear();}
 private regionAt(point:{x:number;y:number}){return this.layout.nodes.reduce((a,b)=>distance(point,a)<distance(point,b)?a:b);}
 private canSee(observer:Player,point:{x:number;y:number}){const vision=RULES.visionRadius*(observer.boons.includes('watcher')?1.15:1)*(observer.relics.includes('lantern')?1.1:1);return !observer.sealed&&distance(observer,point)<=vision&&!this.fogs.some(f=>f.until>this.playElapsed&&distance(point,f)<RULES.fogRadius&&distance(observer,f)>RULES.fogRadius);}
 private giveEvidence(p:Player,e:Evidence){if(!p.evidence.some(old=>old.id===e.id))p.evidence.push({...e});}
 private addEvidence(text:string,source:Evidence['source']='system',author?:string,publicly=false,action='interaction',publicText?:string) {
  const actor=author?this.players.get(author):undefined;
  const e:Evidence={id:globalThis.crypto.randomUUID(),source,text,chapter:this.chapter,at:this.elapsed,...(author?{author}:{})};
  this.events.push(e);if(actor)this.eventMeta.set(e.id,{region:this.regionAt(actor).id,action,at:this.playElapsed});
  if(publicly){const {author:_author,...publicRecord}=e;this.publicEvidence.push({...publicRecord,text:publicText??text});}
  if(source==='system'&&actor)for(const p of this.players.values())if(p.connected&&this.canSee(p,actor))this.giveEvidence(p,e);
  return e;
 }
 private syncRelics(p:Player){p.relics=[...new Set(p.loot.filter(item=>RELICS.some(r=>r.id===item.contentId)).map(item=>item.contentId))].slice(0,3);}
 private dropItem(item:RelicItem,p:Player){this.droppedItems.set(item.id,{...item});const data:LayoutObject={id:item.id,kind:'chest',name:item.name,x:p.x,y:p.y,active:true,progress:0,amount:item.value};const old=this.objects.find(o=>o.id===item.id);if(old)Object.assign(old,data);else this.objects.push(data);}
 private lockedItem(id:string,itemId:string){return this.offers.get(id)?.confirmed&&this.offers.get(id)?.itemId===itemId;}
 private transfer(from:Player,to:Player,itemId:string){
  if(itemId==='core'){if(!from.carryingCore||this.slots(to)>2)return false;from.carryingCore=false;to.carryingCore=true;this.coreHolder=to.id;}
  else if(itemId==='resources'){const n=from.resources;if(!n||to.resources+n>4||this.slots(to)-Math.ceil(to.resources/2)+Math.ceil((to.resources+n)/2)>4)return false;to.resources+=n;from.resources=0;}
  else{if(this.slots(to)>=4)return false;const i=from.loot.findIndex(x=>x.id===itemId);if(i<0)return false;to.loot.push(from.loot.splice(i,1)[0]!);this.syncRelics(from);this.syncRelics(to);}
  const e=this.addEvidence(`${from.name}与${to.name}双方确认了物品交接。`,'system',from.id,false,'trade');this.giveEvidence(from,e);this.giveEvidence(to,e);this.feedback(from,'complete',from,to.id);this.feedback(to,'pickup',to,from.id);return true;
 }

 private feedback(p:Player,kind:FeedbackEvent['kind'],point:{x:number;y:number}=p,targetId?:string,power=.5){const id=(this.feedbackSerial.get(p.id)??0)+1;this.feedbackSerial.set(p.id,id);p.feedback.push({id,kind,x:point.x,y:point.y,...(targetId?{targetId}:{}),power:Math.max(0,Math.min(1,power)),at:this.elapsed});p.feedback=p.feedback.slice(-16);}
 private publicObjectId(o:LayoutObject){if(!o.owner&&!o.id.startsWith('guide-'))return o.id;let id=this.objectPublicIds.get(o.id);if(!id){id=globalThis.crypto.randomUUID();this.objectPublicIds.set(o.id,id);}return id;}
 private isPlaying(){return this.phase==='EXPLORE'||this.phase==='EXTRACT';}
 private able(p:Player){return p.connected&&!p.sealed&&!p.down&&this.playElapsed>=p.staggerUntil;}
 private walkable(x:number,y:number){if(!finite(x)||!finite(y))return false;return this.layout.nodes.some(n=>Math.hypot(x-n.x,y-n.y)<=n.radius)||this.layout.edges.some(([aid,bid])=>{const a=this.layout.nodes.find(n=>n.id===aid)!,b=this.layout.nodes.find(n=>n.id===bid)!;const dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<=35;});}
 command(id:string,cmd:GameCommand):boolean {const p=this.players.get(id);if(!p||!cmd||typeof cmd.type!=='string'||!p.connected)return false;
  if(cmd.type==='choose'){if(this.phase!=='LOBBY'||!professionForms(cmd.profession).includes(cmd.form))return false;const slots=this.config.professions.map((prof,i)=>prof===cmd.profession?i:-1).filter(i=>i>=0);const slot=slots.find(i=>i===p.slot||![...this.players.values()].some(other=>other.id!==id&&other.slot===i));if(slot===undefined)return false;p.slot=slot;p.profession=cmd.profession;p.form=cmd.form;if(cmd.cosmetic)p.cosmetic=cmd.cosmetic;p.ready=false;return true;}
  if(cmd.type==='ready'){if(this.phase!=='LOBBY'||typeof cmd.ready!=='boolean')return false;p.ready=cmd.ready;if(this.players.size===this.config.players&&[...this.players.values()].every(x=>x.ready&&x.connected)){this.phase='PREP';this.remaining=this.config.prepSeconds;}return true;}
  if(cmd.type==='restart'){if(this.phase!=='RESULT'||!this.result||id!==[...this.players.keys()][0])return false;this.reset();return true;}
  if(cmd.type==='say'){if(this.phase!=='DISCUSS'&&this.phase!=='LOBBY')return false;if(typeof cmd.text!=='string'||this.clock()/1000-p.lastSay<RULES.sayCooldown)return false;if(p.sealed&&p.ghostMessageChapter===this.chapter)return false;const text=cmd.text.trim().slice(0,p.sealed?RULES.ghostMessageLimit:RULES.messageLimit);if(!text)return false;p.lastSay=this.clock()/1000;if(p.sealed)p.ghostMessageChapter=this.chapter;this.messages.push({id:globalThis.crypto.randomUUID(),author:id,text,at:this.elapsed});this.messages=this.messages.slice(-80);return true;}
  if(cmd.type==='publish'){if(this.phase!=='DISCUSS')return false;const e=p.evidence.find(e=>e.id===cmd.evidenceId);if(!e||this.publicEvidence.some(x=>x.id===e.id))return false;this.publicEvidence.push({...e});return true;}
  if(cmd.type==='vote'){if(this.phase!=='VOTE'||!this.voteSet.has(id)||p.voted)return false;if(cmd.targetId!==null&&!this.players.has(cmd.targetId))return false;if(cmd.targetId&&this.players.get(cmd.targetId)!.sealed)return false;this.votes.set(id,cmd.targetId);p.voted=true;if(p.sealed)p.ghostVote=false;return true;}
  if(cmd.type==='draft'){if(this.phase!=='DRAFT'||p.sealed||!p.draftOptions.includes(cmd.boonId))return false;p.boons.push(cmd.boonId);p.draftOptions=[];return true;}
  if(cmd.type==='skill'&&p.sealed&&this.isPlaying()){if(p.ghostLightChapter===this.chapter)return false;const target=this.objects.find(o=>o.id===(cmd.targetId??'exit')&&['beacon','exit'].includes(o.kind));if(!target)return false;p.ghostLightChapter=this.chapter;const id=`guide-${p.id}-${this.chapter}`;this.objects.push({id,kind:'bridge',name:'回响引路灯',x:target.x,y:target.y,active:true,progress:0});this.guideUntil.set(id,this.playElapsed+3);this.feedback(p,'cast',target,target.id);return true;}
  if(!this.isPlaying()||!this.able(p))return false;
  if(cmd.type==='move'){if(!finite(cmd.x)||!finite(cmd.y)||!Number.isSafeInteger(cmd.seq)||cmd.seq<0||cmd.seq<=p.seq||Math.abs(cmd.x)>1||Math.abs(cmd.y)>1)return false;p.seq=cmd.seq;const length=Math.max(1,Math.hypot(cmd.x,cmd.y));p.moveX=Math.max(-1,Math.min(1,cmd.x/length));p.moveY=Math.max(-1,Math.min(1,cmd.y/length));if(Math.abs(p.moveX)+Math.abs(p.moveY)>.01)this.interrupt(p);return true;}
  if(cmd.type==='cancel'){this.interrupt(p);return true;}
  if(cmd.type==='dodge'){if(this.playElapsed<p.dodgeAt||!finite(cmd.x)||!finite(cmd.y)||Math.abs(cmd.x)>1||Math.abs(cmd.y)>1)return false;const l=Math.hypot(cmd.x,cmd.y);if(l<.01)return false;const x=p.x+cmd.x/l*RULES.dodgeDistance,y=p.y+cmd.y/l*RULES.dodgeDistance;if(!this.walkable(x,y)||!Array.from({length:8},(_,i)=>this.walkable(p.x+(x-p.x)*(i+1)/8,p.y+(y-p.y)*(i+1)/8)).every(Boolean))return false;this.interrupt(p);p.x=x;p.y=y;p.dodgeAt=this.playElapsed+RULES.dodgeCooldown;this.feedback(p,'dodge');return true;}
  if(cmd.type==='attack')return this.attack(p,cmd.targetId);
  if(cmd.type==='skill'){const success=this.skill(p,cmd);if(success)this.feedback(p,'cast');return !!success;}
  if(cmd.type==='transform'){if(p.faction!=='wolf'||this.playElapsed<p.transformAt)return false;p.transformUntil=this.playElapsed+RULES.transformationSeconds;p.transformAt=this.playElapsed+RULES.transformationCooldown;this.addEvidence(`${p.name}显现了蚀月轮廓。`,'system',id);this.feedback(p,'cast');return true;}
  if(cmd.type==='fog'){if(p.faction!=='wolf'||this.wolfBudget<1||!finite(cmd.x)||!finite(cmd.y)||distance(p,{x:cmd.x,y:cmd.y})>RULES.interactRange)return false;this.wolfBudget--;this.fogs.push({x:cmd.x,y:cmd.y,until:this.playElapsed+RULES.fogSeconds});this.addEvidence('区域内出现了遮蔽目击的灰雾。','system',id);return true;}
  if(cmd.type==='corrupt'){const o=this.objects.find(o=>o.id===cmd.targetId);if(p.faction!=='wolf'||!o||o.kind!=='altar'||!o.active||this.wolfBudget<1||this.corruptions>=RULES.corruptionTeamCap||this.corrupted.has(o.id)||this.playElapsed<this.corruptAt||this.playElapsed<(this.retry.get(`${id}:${o.id}`)??0)||distance(p,o)>RULES.interactRange)return false;if(!this.channel(p,o.id,'corrupt',RULES.corruptionChannel))return false;if(this.phase==='EXTRACT')this.addEvidence('归灯门附近装置启动腐化，方向警报已亮起。','system',undefined,true);else this.addEvidence('附近暗祭坛启动了腐化读条。','system',p.id,false,'corruption-start');return true;}
  if(cmd.type==='finish'){const target=this.players.get(cmd.targetId);if(p.faction!=='wolf'||this.chapter<2||this.config.wolfFinisherGameCap===0||this.finishCount>=this.config.wolfFinisherGameCap||this.chapterFinished||this.wolfBudget<2||this.removalCount>=this.config.permanentRemovalCap||p.transformUntil<=this.playElapsed||!target?.down||target.sealed||distance(p,target)>RULES.interactRange)return false;return this.channel(p,target.id,'finish',RULES.channelFinish);}
  if(cmd.type==='interact')return this.interact(p,cmd.targetId);
  if(cmd.type==='drop'){
   if(this.lockedItem(id,cmd.itemId))return false;
   if(cmd.itemId==='core'&&p.carryingCore){this.dropCore(p);return true;}
   if(cmd.itemId==='resources'&&p.resources){this.objects.push({id:globalThis.crypto.randomUUID(),kind:'resource',name:'掉落的工程亡絮',x:p.x,y:p.y,active:true,progress:0,amount:p.resources,guaranteed:true,chapter:this.chapter});p.resources=0;return true;}
   const idx=p.loot.findIndex(x=>x.id===cmd.itemId);if(idx<0)return false;const item=p.loot.splice(idx,1)[0]!;this.dropItem(item,p);this.syncRelics(p);return true;
  }
  if(cmd.type==='offer'){
   const to=this.players.get(cmd.to);const owns=cmd.itemId==='core'?p.carryingCore:cmd.itemId==='resources'?p.resources>0:p.loot.some(x=>x.id===cmd.itemId);
   if(!to||to.id===id||!this.able(to)||distance(p,to)>RULES.interactRange||!owns||this.offers.get(id)?.confirmed)return false;
   this.offers.set(id,{to:to.id,itemId:cmd.itemId,until:this.playElapsed+(p.profession==='broker'&&p.form===1?30:10)});
   const e=this.addEvidence(`${p.name}提出交接物品，等待${to.name}确认。`,'system',id,false,'offer');this.giveEvidence(p,e);this.giveEvidence(to,e);return true;
  }
  if(cmd.type==='accept'){
   const offer=this.offers.get(cmd.from),from=this.players.get(cmd.from);
   if(!offer||offer.confirmed||offer.to!==id||offer.itemId!==cmd.itemId||offer.until<this.playElapsed||!from||!this.able(from)||distance(p,from)>RULES.interactRange)return false;
   if(from.profession==='broker'&&from.form===1){offer.confirmed=true;offer.deliverAt=this.playElapsed+3;return true;}
   if(!this.transfer(from,p,cmd.itemId))return false;this.offers.delete(from.id);return true;
  }
  return false;
 }
 private channel(p:Player,targetId:string,kind:string,duration:number){if(p.interaction)return false;p.moveX=p.moveY=0;const engineering=['beacon','purify','cleanse'].includes(kind);const speed=engineering?Math.max(.75,(p.boons.includes('engineer')?.85:1)*(p.relics.includes('spool')?.9:1)*(this.playElapsed<(this.repairUntil.get(targetId)??0)?.85:1)):1;p.interaction={targetId,kind,elapsed:0,duration:duration*speed};return true;}
 private slots(p:Player){return p.loot.length+(p.carryingCore?2:0)+Math.ceil(p.resources/2)+Math.ceil(p.supplies/2);}
 private funds(p:Player){return this.sharedResources+(this.lockedItem(p.id,'resources')?0:p.resources);}
 private interact(p:Player,targetId:string){if(targetId===p.id&&p.supplies>0&&p.hp<100){p.supplies--;p.hp=Math.min(100,p.hp+30);this.feedback(p,'complete',p,p.id,.3);return true;}if(targetId==='core'&&p.carryingCore){const station=this.objects.find(o=>o.id==='purify')!;if(!this.corePurified&&distance(p,station)<=RULES.interactRange&&this.funds(p)>=2)return this.channel(p,station.id,'purify',RULES.channelPurify);return false;}const other=this.players.get(targetId);if(other?.down&&!other.sealed&&distance(p,other)<=RULES.interactRange)return this.channel(p,targetId,'rescue',p.profession==='medic'?2:RULES.channelRescue*(p.boons.includes('rescuer')?.85:1));const o=this.objects.find(x=>x.id===targetId&&x.active);if(!o||distance(p,o)>RULES.interactRange)return false;
  if(o.kind==='resource'&&(o.amount??0)>0&&p.resources<RULES.resourceCapacity&&(4-this.slots(p)+Math.ceil(p.resources/2))*2>p.resources)return this.channel(p,o.id,'resource',RULES.channelResource);
  if(o.kind==='beacon'&&o.progress<1&&this.funds(p)>=2)return this.channel(p,o.id,'beacon',RULES.channelBeacon);
  if(o.id==='warehouse'&&!this.lockedItem(p.id,'resources'))return this.channel(p,o.id,'deposit',RULES.channelDeposit);
  if(o.id==='stash'&&!p.stashUsed&&p.loot.length)return this.channel(p,o.id,'stash',RULES.channelDeposit);
  if(o.id==='purify'&&p.carryingCore&&!this.corePurified&&this.funds(p)>=2)return this.channel(p,o.id,'purify',RULES.channelPurify);
  if(o.kind==='cleanse'&&o.id!=='purify'&&this.moon>0&&!this.cleansed&&this.funds(p)>=2)return this.channel(p,o.id,'cleanse',RULES.channelCleanse);
  if(o.kind==='core'&&!this.coreHolder&&this.chapter>=2&&this.slots(p)<=2)return this.channel(p,o.id,'core',RULES.channelCore);
  if(o.kind==='core'&&p.carryingCore&&!this.corePurified&&this.funds(p)>=2)return this.channel(p,o.id,'purify',RULES.channelPurify);
  if(o.kind==='chest'&&this.slots(p)<4)return this.channel(p,o.id,'chest',p.profession==='scavenger'?(p.form===0?3:2):RULES.channelChest);
  return false;
 }
 private consume(p:Player,n:number){if(this.funds(p)<n)return false;const shared=Math.min(n,this.sharedResources);this.sharedResources-=shared;p.resources-=n-shared;return true;}
 private complete(p:Player){const action=p.interaction;if(!action)return;p.interaction=null;const o=this.objects.find(x=>x.id===action.targetId),target=this.players.get(action.targetId);if(target&&distance(p,target)>RULES.interactRange||o&&distance(p,o)>RULES.interactRange)return;
  switch(action.kind){
   case 'resource':{if(!o?.active)return;const capacity=(4-this.slots(p)+Math.ceil(p.resources/2))*2-p.resources;const take=Math.min(o.amount??0,4-p.resources,Math.max(0,capacity));if(!take)return;p.resources+=take;o.amount=(o.amount??0)-take;if(!o.amount)o.active=false;this.addEvidence(`${p.name}采集了工程亡絮。`,'system',p.id);break;}
   case 'deposit':{if(this.lockedItem(p.id,'resources'))return;const count=p.resources;this.sharedResources+=count;p.resources=0;this.addEvidence(`${p.name}向收絮匣交付${count}份亡絮。`,'system',p.id,true,'deposit',`收絮匣收到${count}份工程亡絮。`);break;}
   case 'stash':{if(p.stashUsed||p.loot.some(item=>this.lockedItem(p.id,item.id)))return;p.stored.push(...p.loot.splice(0,2));this.syncRelics(p);p.stashUsed=true;this.addEvidence(`${p.name}完成了一次旧城珍藏寄存。`,'system',p.id);break;}
   case 'beacon':{if(!o?.active||o.progress>=1||!this.consume(p,2))return;o.progress=1;this.beaconsLit++;this.addEvidence(`${o.name}已由${p.name}点亮。`,'system',p.id,true,'beacon',`${o.name}已点亮。`);break;}
   case 'core':{if(this.coreHolder||!o?.active||this.slots(p)>2)return;this.coreHolder=p.id;p.carryingCore=true;o.active=false;this.addEvidence(`${p.name}取得了归灯芯。`,'system',p.id);break;}
   case 'purify':{if(!p.carryingCore||this.corePurified||!this.consume(p,2))return;this.corePurified=true;this.addEvidence('归灯芯已完成净化。','system',p.id,true);break;}
   case 'cleanse':{if(this.cleansed||this.moon<=0||!this.consume(p,2))return;this.moon--;this.cleansed=true;this.addEvidence('归灯厅完成一次降蚀。','system',p.id,true);break;}
   case 'corrupt':{if(!o?.active||this.wolfBudget<1||this.corrupted.has(o.id)||this.corruptions>=RULES.corruptionTeamCap||this.playElapsed<this.corruptAt)return;this.wolfBudget--;this.moon++;this.corruptions++;this.corrupted.add(o.id);this.corruptAt=this.playElapsed+RULES.corruptionCooldown;this.addEvidence('一处祭坛完成了腐化；区域痕迹可供调查。','system',p.id,false,'corruption');break;}
   case 'rescue':{if(!target?.down||target.sealed)return;target.down=false;target.hp=50;target.downUntil=0;target.staggerUntil=0;this.feedback(target,'rescue',target,target.id,.6);this.addEvidence(`${p.name}扶起了${target.name}。`,'system',p.id);break;}
   case 'finish':{if(!target?.down||target.sealed||this.wolfBudget<2||this.chapterFinished||this.finishCount>=this.config.wolfFinisherGameCap||this.removalCount>=this.config.permanentRemovalCap||p.transformUntil<=this.playElapsed)return;this.wolfBudget-=2;this.chapterFinished=true;this.finishCount++;this.seal(target);this.addEvidence(`${target.name}被显露的蚀月轮廓终结。`,'system',p.id);break;}
   case 'chest':{
    if(!o?.active||this.slots(p)>=4)return;
    const dropped=this.droppedItems.get(o.id);
    if(dropped){p.loot.push({...dropped});this.droppedItems.delete(o.id);o.active=false;o.amount=0;}
    else if(o.id.startsWith('chest-')){
     const count=Math.min(o.amount??0,p.profession==='scavenger'&&p.form===0?2:1,4-this.slots(p));
     for(let i=0;i<count;i++){
      const part=o.amount??0;const relic=part===2?RELICS[Math.floor(this.random()*RELICS.length)]:undefined;
      const item:RelicItem={id:`${this.roomId}:${this.matchSerial}:${o.id}:${part}`,contentId:relic?.id??'treasure',name:relic?.name??'旧城珍藏',value:relic?4:3};
      p.loot.push(item);o.amount=part-1;
     }
     o.progress=(2-(o.amount??0))/2;if(!o.amount)o.active=false;const extraSlots=Math.ceil((p.supplies+count)/2)-Math.ceil(p.supplies/2);if(this.slots(p)+extraSlots<=4)p.supplies+=count;
    }else return;
    this.syncRelics(p);this.addEvidence(`${p.name}开启了储藏点。`,'system',p.id,false,'chest');break;
   }
  }
  this.feedback(p,['resource','core','chest'].includes(action.kind)?'pickup':action.kind==='rescue'?'rescue':'complete',p,action.targetId);
 }
 private interrupt(p:Player){if(p.interaction?.kind==='corrupt')this.retry.set(`${p.id}:${p.interaction.targetId}`,this.playElapsed+10);p.interaction=null;}
 private dropCore(p:Player){if(!p.carryingCore)return;p.carryingCore=false;this.coreHolder=null;const core=this.objects.find(o=>o.id==='core')!;core.active=true;core.x=p.x;core.y=p.y;}
 private down(p:Player){if(p.down||p.sealed)return;this.offers.delete(p.id);for(const [from,offer]of this.offers)if(offer.to===p.id)this.offers.delete(from);p.down=true;p.hp=0;p.downUntil=this.playElapsed+20;this.feedback(p,'down',p,p.id,1);p.moveX=p.moveY=0;this.interrupt(p);this.dropCore(p);if(p.resources){this.objects.push({id:globalThis.crypto.randomUUID(),name:'掉落的亡絮',kind:'resource',x:p.x,y:p.y,active:true,progress:0,amount:p.resources,guaranteed:true,chapter:this.chapter});p.resources=0;}for(const item of p.loot)this.dropItem(item,p);p.loot=[];p.relics=[];}
 private damage(p:Player,n:number){if(p.shield>0){const blocked=Math.min(n,p.shield);p.shield-=blocked;n-=blocked;if(blocked)this.feedback(p,'block',p,undefined,blocked/30);}p.hp-=n;if(n)this.feedback(p,'hurt',p,undefined,n/30);this.interrupt(p);if(p.hp<=0)this.down(p);}
 private attack(p:Player,targetId?:string){if(this.playElapsed<p.attackAt)return false;const visible=this.objects.filter(o=>o.active&&o.kind==='elite'&&distance(p,o)<=RULES.attackRange);const object=targetId?visible.find(o=>o.id===targetId):visible[0];const target=targetId?this.players.get(targetId):undefined;if(object){p.attackAt=this.playElapsed+RULES.attackCooldown;object.hp=Math.max(0,(object.hp??0)-RULES.normalDamage);this.feedback(p,'hit',object,object.id,.75);if(object.hp===0){object.active=false;this.eliteDefeated=true;this.addEvidence('守门精英已被击败。','system',p.id,true);}return true;}if(!target||target.id===p.id||target.sealed||target.down||!this.canSee(p,target)||distance(p,target)>RULES.attackRange)return false;p.attackAt=this.playElapsed+RULES.attackCooldown;this.feedback(p,'hit',target,target.id,p.transformUntil>this.playElapsed?.9:.6);this.interrupt(target);if(p.transformUntil>this.playElapsed||target.transformUntil>this.playElapsed)this.damage(target,p.transformUntil>this.playElapsed?RULES.wolfDamage:RULES.normalDamage);else if(this.playElapsed>=target.pushImmuneUntil){const dx=target.x-p.x,dy=target.y-p.y,l=Math.max(1,Math.hypot(dx,dy)),mult=target.boons.includes('steadfast')?.85:1,x=target.x+dx/l*24*mult,y=target.y+dy/l*24*mult;if(this.walkable(x,y)){target.x=x;target.y=y;}target.staggerUntil=this.playElapsed+.35;target.pushImmuneUntil=this.playElapsed+1.5;this.feedback(target,'push',target,undefined,.5);}return true;}
 private skill(p:Player,cmd:Extract<GameCommand,{type:'skill'}>) {
  if(this.playElapsed<p.skillAt)return false;
  if(cmd.x!==undefined&&!finite(cmd.x)||cmd.y!==undefined&&!finite(cmd.y))return false;
  const target=this.players.get(cmd.targetId??p.id);
  switch(p.profession){
   case 'warden':{
    if(p.form===0){if(!target||target.sealed||target.down||!this.canSee(p,target)||distance(p,target)>120)return false;const buff=(target.boons.includes('guardian')?1.15:1)*(target.relics.includes('buckler')?1.1:1);target.shield=Math.max(target.shield,RULES.wardSingle*buff);target.shieldUntil=this.playElapsed+RULES.wardSeconds;}
    else{const center={x:cmd.x??p.x,y:cmd.y??p.y};if(distance(center,p)>78||!this.walkable(center.x,center.y))return false;const id=`ward-${p.id}`;const existing=this.objects.find(o=>o.id===id);const area:LayoutObject={id,kind:'bridge',name:'定点薄盾',x:center.x,y:center.y,active:true,progress:0,owner:p.id};if(existing)Object.assign(existing,area);else this.objects.push(area);this.guideUntil.set(id,this.playElapsed+RULES.wardSeconds);this.wardGrants.set(id,new Set());}
    p.skillAt=this.playElapsed+RULES.wardCooldown;return true;
   }
   case 'scout':{
    const node=this.regionAt(p),regions=new Set([node.id]);
    if(p.form===1)for(const [a,b]of this.layout.edges){if(a===node.id)regions.add(b);if(b===node.id)regions.add(a);}
    let found=0;
    for(const event of this.events){const meta=this.eventMeta.get(event.id);if(!meta||event.chapter!==this.chapter||!regions.has(meta.region)||meta.at<this.playElapsed-(p.form===0?20:45)||event.source!=='system')continue;
     const region=this.layout.nodes.find(n=>n.id===meta.region)!;const span=p.form===0?15:30;
     const label=meta.action==='movement'?'出入活动':meta.action.startsWith('corruption')?'祭坛活动':meta.action==='trade'?'物资交接':'装置交互';
     this.giveEvidence(p,{id:event.id,source:'observation',chapter:event.chapter,at:Math.floor(event.at/span)*span,text:`${region.name}在${Math.floor(event.at/span)*span}秒附近留下${label}痕迹；记录不含操作者姓名。`});found++;
    }
    if(!found)this.giveEvidence(p,this.addEvidence(`${node.name}所选范围没有可确认的新痕迹。`,'observation',p.id));
    p.skillAt=this.playElapsed+RULES.skillCooldown;return true;
   }
   case 'forensic':{
    const e=[...p.evidence,...this.publicEvidence].find(e=>e.id===cmd.targetId);
    if(!e)return false;
    const known=this.events.find(original=>original.id===e.id);
    const text=e.source==='claim'?'该玩家陈述没有可核对的系统来源，不能认证内容。':known?`线索${e.id}与既有事件来源相符；派生记录仍是同一事件，不证明阵营。`:'该线索来源尚无法核对。';
    this.giveEvidence(p,this.addEvidence(text,'observation',p.id));p.skillAt=this.playElapsed+RULES.skillCooldown;return true;
   }
   case 'ranger':{
    const node=this.regionAt(p);for(const a of this.players.values())if(!a.sealed&&!a.down&&distance(a,p)<=100)a.routeUntil=this.playElapsed+8;
    this.giveEvidence(p,this.addEvidence(`${node.name}的护送通路已标记，附近携芯者8秒内搬运减速减轻；不包含隐藏玩家位置。`,'observation',p.id));p.skillAt=this.playElapsed+RULES.skillCooldown;return true;
   }
   case 'medic':if(!target?.down||target.sealed||distance(p,target)>RULES.interactRange)return false;if(!this.channel(p,target.id,'rescue',2))return false;p.skillAt=this.playElapsed+RULES.medicCooldown;return true;
   case 'scavenger':{const o=this.objects.find(o=>o.id===cmd.targetId&&o.kind==='chest'&&o.active);if(!o||distance(p,o)>RULES.interactRange||this.slots(p)>=4)return false;return this.channel(p,o.id,'chest',p.form===0?3:2);}
   case 'broker':{
    const partner=target&&target.id!==p.id?target:undefined;
    if(!partner||!this.able(partner)||distance(p,partner)>RULES.interactRange)return false;
    const itemId=p.carryingCore?'core':p.resources?'resources':p.loot[0]?.id;
    if(!itemId||!this.command(p.id,{type:'offer',to:partner.id,itemId}))return false;
    const e=this.addEvidence(`${p.name}为${partner.name}提供${p.form?'3秒限时托管':'当面确认'}服务；只有双方确认后才交付。`,'observation',p.id);this.giveEvidence(p,e);this.giveEvidence(partner,e);p.skillAt=this.playElapsed+10;return true;
   }
   case 'engineer':{
    const o=this.objects.find(o=>o.id===cmd.targetId&&['beacon','cleanse'].includes(o.kind)&&o.active);
    if(!o||distance(p,o)>RULES.interactRange)return false;this.repairUntil.set(o.id,this.playElapsed+8);
    this.addEvidence(`${p.name}设置修护标记，该装置8秒内的工程读条缩短。`,'system',p.id);p.skillAt=this.playElapsed+RULES.skillCooldown;return true;
   }
   case 'bellkeeper':this.aiAt=Math.max(this.aiAt,this.playElapsed+4);this.addEvidence(`${p.name}鸣钟，环境敌人的攻击暂缓。`,'system',p.id,true,'bell','钟声响起，环境敌人的攻击暂缓。');p.skillAt=this.playElapsed+RULES.skillCooldown;return true;
  }
 }

 private seal(p:Player){if(p.sealed||this.chapter<2||this.removalCount>=this.config.permanentRemovalCap)return;p.sealed=true;p.down=false;p.moveX=p.moveY=0;this.dropCore(p);if(p.resources)this.sharedResources+=p.resources;p.resources=0;for(const item of p.loot)this.dropItem(item,p);p.loot=[];p.relics=[];p.interaction=null;p.shield=0;p.transformUntil=0;this.offers.delete(p.id);this.removalCount++;}
 private startChapter(){
  this.chapter++;this.phase='EXPLORE';this.remaining=this.config.exploreSeconds;this.wolfBudget=this.config.shadowBudget;this.corruptions=0;this.corrupted.clear();this.cleansed=false;this.chapterFinished=false;this.corruptAt=0;this.offers.clear();
  for(const o of this.objects)if(o.chapter===this.chapter&&!this.released.has(o.id)){this.released.add(o.id);if(o.kind!=='resource'||(o.amount??0)>0)o.active=true;}
  for(const p of this.players.values()){p.voted=false;p.moveX=p.moveY=0;if(p.boons.includes('vigor')&&!p.down&&!p.sealed)p.hp=Math.min(100,p.hp+15);}
  this.addEvidence(`第${this.chapter}章开始：新的工程亡絮已释放。`,'system',undefined,true);
 }
 private council(){
  let recovered=0;for(const p of this.players.values()){recovered+=p.resources;p.resources=0;p.moveX=p.moveY=0;p.interaction=null;if(!p.sealed){p.x=500+(p.slot%5)*12-24;p.y=350+Math.floor(p.slot/5)*12;p.region='sanctuary';}}
  for(const o of this.objects)if(o.kind==='resource'&&o.guaranteed&&o.chapter!==undefined&&o.chapter<=this.chapter&&o.active){recovered+=o.amount??0;o.amount=0;o.active=false;}
  this.sharedResources+=recovered;this.offers.clear();this.phase='DISCUSS';this.remaining=this.config.discussionSeconds;this.addEvidence(`本章剩余${recovered}份工程亡絮已统一收进收絮匣。`,'system',undefined,true);
 }

 private transition(){switch(this.phase){case 'PREP':{const ids=[...this.players.keys()];for(let i=ids.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[ids[i],ids[j]]=[ids[j]!,ids[i]!];}ids.forEach((id,i)=>this.players.get(id)!.faction=i<this.config.wolves?'wolf':'human');this.startChapter();break;}
  case 'EXPLORE':this.council();break;
  case 'DISCUSS':this.phase='VOTE';this.remaining=this.config.voteSeconds;this.voteSet=new Set([...this.players.values()].filter(p=>!p.sealed||p.ghostVote).map(p=>p.id));this.votes.clear();break;
  case 'VOTE':{const counts=new Map<string,number>();for(const target of this.votes.values())if(target)counts.set(target,(counts.get(target)??0)+1);const chosen=[...counts].find(([,n])=>n>this.voteSet.size/2)?.[0];if(chosen){const p=this.players.get(chosen)!;if(this.chapter===1){this.monitored=chosen;this.monitoredChapter=this.chapter+1;this.addEvidence(`${p.name}将在下一章受到有限监视。`,'system',undefined,true);}else if(this.removalCount<this.config.permanentRemovalCap){this.seal(p);this.addEvidence(`${p.name}被封印，成为回响；阵营在终局公布。`,'system',undefined,true);}else{p.staggerUntil=this.playElapsed+20;this.addEvidence(`${p.name}被暂时禁锢，全局永久离场额度已用尽。`,'system',undefined,true);}}else this.addEvidence('无人获得严格过半票，本轮没有封印。','system',undefined,true);this.phase='DRAFT';this.remaining=this.config.draftSeconds;for(const p of this.players.values())if(!p.sealed){const pool=BOONS.filter(b=>!p.boons.includes(b.id)).map(b=>b.id);for(let i=pool.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[pool[i],pool[j]]=[pool[j]!,pool[i]!];}p.draftOptions=pool.slice(0,3);}break;}
  case 'DRAFT':for(const p of this.players.values())if(p.draftOptions.length){p.boons.push(p.draftOptions[0]!);p.draftOptions=[];}if(this.chapter<this.config.chapters)this.startChapter();else{this.phase='EXTRACT';this.remaining=this.config.extractionSeconds;this.holdProgress=0;this.escortHold.clear();for(const o of this.objects)if(o.kind==='altar')o.active=false;const exit=this.objects.find(o=>o.id==='exit')!;for(let i=0;i<2;i++)this.objects.push({id:`altar-extract-${i}`,kind:'altar',name:`撤离暗祭坛${i+1}`,x:exit.x+(i?35:-35),y:exit.y-35,active:true,progress:0});}break;
  case 'EXTRACT':{const wolves=[...this.players.values()].filter(p=>p.faction==='wolf');const eligible=[...this.players.values()].some(p=>p.faction==='human'&&!p.sealed&&!p.down&&(this.escortHold.get(p.id)??0)>=RULES.holdSeconds-1e-6);const objective=this.beaconsLit>=this.config.beacons&&this.eliteDefeated&&this.corePurified&&this.moon<this.config.moonLimit&&this.holdProgress>=RULES.holdSeconds-1e-6&&eligible;const winner=wolves.every(p=>p.sealed)||objective?'human':'wolf';const reason=wolves.every(p=>p.sealed)?'全部蚀月者已被封印':objective?'归灯芯完成最后八秒护送':'终钟响起，归灯远征未完成';if([...this.players.values()].some(p=>!p.connected)){this.winnerPending=winner;this.remaining=0;this.phase='RESULT';this.result=null;this.pendingReason=reason;}else this.settle(winner,reason);break;}
 }}
 private maybeSettlePending(){if(this.winnerPending&&[...this.players.values()].every(p=>p.connected)){const winner=this.winnerPending;this.winnerPending=null;this.settle(winner,this.pendingReason||'终局完成');}}
 private settle(winner:Faction|'invalid',reason:string){if(this.result)return;this.phase='RESULT';this.remaining=0;this.winnerPending=null;const factions:Record<string,Faction>={},rewards:GameResult['rewards']={};for(const p of this.players.values()){factions[p.id]=p.faction??'human';const won=winner===p.faction;rewards[p.id]={fragments:winner==='invalid'?0:10+(won?20:0)+(won?Math.min(10,p.stored.reduce((a,x)=>a+x.value,0)+p.loot.reduce((a,x)=>a+x.value,0)):Math.floor(Math.min(10,p.stored.reduce((a,x)=>a+x.value,0))*.25)),secrets:winner==='invalid'?0:1+(won?1:0)};}this.result={winner,reason,factions,rewards};const settlement:Settlement={matchId:`${this.roomId}:${this.matchSerial}`,ruleVersion:this.config.ruleVersion,mapSeed:this.mapSeed,winner,reason,players:[...this.players.values()].map(p=>({id:p.id,faction:p.faction??'human',sealed:p.sealed,profession:p.profession,storedValue:p.stored.reduce((a,x)=>a+x.value,0),carriedValue:p.loot.reduce((a,x)=>a+x.value,0),lootIds:[...p.stored,...p.loot].map(x=>x.id)})),events:this.events.map(e=>({...e}))};try{const task=this.onSettlement?.(settlement);if(task)void Promise.resolve(task).catch(error=>{this.settlementError=error;});}catch(error){this.settlementError=error;}}
 private reset(){const old=[...this.players.values()].filter(p=>p.connected||p.disconnectedAt===null||this.clock()-p.disconnectedAt<RULES.reconnectMilliseconds).map(p=>({id:p.id,name:p.name,cosmetic:p.cosmetic,slot:p.slot,profession:p.profession,form:p.form,connected:p.connected,disconnectedAt:p.disconnectedAt}));this.players.clear();this.matchSerial++;this.objects=this.layout.objects.map(o=>({...o}));this.phase='LOBBY';this.chapter=0;this.remaining=this.elapsed=this.playElapsed=this.moon=this.sharedResources=this.beaconsLit=this.holdProgress=this.removalCount=this.finishCount=0;this.eliteDefeated=this.corePurified=false;this.coreHolder=null;this.result=null;this.publicEvidence=[];this.messages=[];this.events=[];this.offers.clear();this.fogs=[];this.escortHold.clear();this.eventMeta.clear();this.objectPublicIds.clear();this.released.clear();this.droppedItems.clear();this.guideUntil.clear();this.wardGrants.clear();this.repairUntil.clear();this.retry.clear();this.voteSet.clear();this.votes.clear();this.monitored=null;this.aiAt=0;this.pendingReason='';this.winnerPending=null;this.settlementError=null;for(const p of old){this.addPlayer(p);const next=this.players.get(p.id)!;next.slot=p.slot;next.profession=p.profession;next.form=p.form;next.connected=p.connected;next.disconnectedAt=p.disconnectedAt;}}
 tick(dtSeconds:number){
  if(!finite(dtSeconds)||dtSeconds<=0||dtSeconds>3600)return;
  for(const p of this.players.values())if(p.disconnectedAt!==null&&this.clock()-p.disconnectedAt>=RULES.reconnectMilliseconds){if(this.phase==='LOBBY'||this.phase==='RESULT'&&!!this.result){this.players.delete(p.id);continue;}if(!this.result){this.settle('invalid','玩家超过60秒未恢复连接');return;}}
  if(this.phase==='RESULT'||this.phase==='LOBBY')return;
  let left=dtSeconds;while(left>1e-8&&!['RESULT','LOBBY'].includes(this.phase)){
   const dt=Math.min(left,RULES.tickSeconds,this.remaining);if(dt<=1e-8){this.remaining=0;this.transition();continue;}
   this.step(dt);left-=dt;
  }
 }
 private step(dt:number){
  const beforeRemaining=this.remaining;this.elapsed+=dt;this.remaining=Math.max(0,this.remaining-dt);
  if(this.isPlaying()){
   this.playElapsed+=dt;
   for(const [from,offer]of this.offers){const sender=this.players.get(from),to=this.players.get(offer.to);if(offer.until<this.playElapsed||!sender||!to||sender.down||sender.sealed||to.down||to.sealed){this.offers.delete(from);continue;}if(offer.confirmed&&(offer.deliverAt??Infinity)<=this.playElapsed){if(sender.connected&&to.connected)this.transfer(sender,to,offer.itemId);this.offers.delete(from);}}
   for(const [id,until]of this.guideUntil){const o=this.objects.find(o=>o.id===id);if(until<=this.playElapsed){if(o)o.active=false;this.guideUntil.delete(id);continue;}if(o?.owner&&id.startsWith('ward-'))for(const p of this.players.values())if(!p.sealed&&!p.down&&distance(p,o)<=100){const buff=(p.boons.includes('guardian')?1.15:1)*(p.relics.includes('buckler')?1.1:1);const grants=this.wardGrants.get(id)!;if(!grants.has(p.id)){p.shield=Math.max(p.shield,RULES.wardArea*buff);grants.add(p.id);}p.shieldUntil=Math.max(p.shieldUntil,this.playElapsed+dt);}}
   for(const p of this.players.values()){
    if(p.sealed)continue;if(p.shieldUntil<this.playElapsed)p.shield=0;
    if(p.down&&p.downUntil<=this.playElapsed){p.down=false;p.hp=50;p.x=500;p.y=350;p.staggerUntil=this.playElapsed+1;}
    if(!this.able(p))continue;
    const carry=p.boons.includes('carrier')||p.relics.includes('boots')||p.routeUntil>this.playElapsed?.95:.85;
    const speed=RULES.moveSpeed*(p.boons.includes('fleet')?1.1:1)*(p.carryingCore?carry:1);
    const x=p.x+p.moveX*speed*dt,y=p.y+p.moveY*speed*dt;
    const canX=this.walkable(x,p.y);if(canX)p.x=x;const canY=this.walkable(p.x,y);if(canY)p.y=y;
    if((!canX&&Math.abs(p.moveX)>.001||!canY&&Math.abs(p.moveY)>.001)&&this.playElapsed>=p.collisionAt){p.collisionAt=this.playElapsed+.5;this.feedback(p,'collision');}
    const region=this.regionAt(p);if(region.id!==p.region){p.region=region.id;this.addEvidence(`${region.name}出现一次出入活动。`,'system',p.id,false,'movement');}
    if(p.interaction){p.interaction.elapsed+=dt;if(p.interaction.elapsed>=p.interaction.duration-1e-7)this.complete(p);}
   }
   if(this.monitored&&this.chapter===this.monitoredChapter){const p=this.players.get(this.monitored);if(p&&!p.sealed&&distance(p,{x:500,y:350})>90){const node=this.regionAt(p);this.addEvidence(`有限监视记录：${p.name}进入${node.name}附近。`,'system',undefined,true);this.monitored=null;}}
   const core=this.objects.find(o=>o.id==='core')!;if(this.coreHolder){const p=this.players.get(this.coreHolder)!;core.x=p.x;core.y=p.y;}
   if(this.playElapsed>=this.aiAt){this.aiAt=this.playElapsed+1.8;for(const o of this.objects.filter(o=>o.kind==='elite'&&o.active)){const target=[...this.players.values()].filter(p=>this.able(p)&&distance(p,o)<110).sort((a,b)=>distance(a,o)-distance(b,o))[0];if(target)this.damage(target,15);}}
   if(this.phase==='EXTRACT'){
    const holdDt=Math.max(0,Math.min(beforeRemaining,RULES.holdSeconds)-this.remaining);
    if(holdDt>0){const exit=this.objects.find(o=>o.id==='exit')!;const holder=this.coreHolder?this.players.get(this.coreHolder):null;const coreInside=this.chapter>=2&&distance(holder??core,exit)<=65;
     this.holdProgress=coreInside?Math.min(RULES.holdSeconds,this.holdProgress+holdDt):0;
     for(const p of this.players.values()){const inside=!p.sealed&&!p.down&&distance(p,exit)<=65;this.escortHold.set(p.id,inside?Math.min(RULES.holdSeconds,(this.escortHold.get(p.id)??0)+holdDt):0);}
    }
   }
  }
  if(this.remaining<=1e-7)this.transition();
 }

 getVoiceState(){const state=this.voiceState();return {phase:this.phase,chapter:this.chapter,speakerId:state.speakerId,open:state.open,players:[...this.players.values()].map(p=>({id:p.id,name:p.name,sealed:p.sealed}))};}
 private voiceState(){const council=this.phase==='DISCUSS';const t=this.config.discussionSeconds-this.remaining;const index=Math.floor(t/this.config.statementSeconds);const speaker=[...this.players.values()].sort((a,b)=>a.slot-b.slot)[index];return {enabled:council,epoch:council?`${this.roomId}:${this.matchSerial}:${this.chapter}`:null,speakerId:council&&index<this.config.players?(speaker&&!speaker.sealed?speaker.id:null):null,open:council&&index>=this.config.players};}
 viewFor(id:string):GameView {
  const p=this.players.get(id);if(!p)throw new Error('没有远征席位');
  const council=['LOBBY','PREP','DISCUSS','VOTE','DRAFT'].includes(this.phase);const finished=!!this.result;
  const visible=(other:{x:number;y:number})=>this.canSee(p,other);
  const players=[...this.players.values()].map(other=>{const seen=finished||!p.sealed&&(other.id===id||council||visible(other));return {id:other.id,name:other.name,slot:other.slot,profession:other.profession,form:other.form,cosmetic:other.cosmetic,ready:other.ready,connected:other.connected,sealed:other.sealed,down:seen?other.down:false,hp:seen?other.hp:100,maxHp:100,x:seen?other.x:null,y:seen?other.y:null,shield:seen?other.shield:0,transformed:seen&&other.transformUntil>this.playElapsed,carryingCore:seen&&other.carryingCore};});
  const self:SelfView={id,faction:p.faction,wolfAllies:p.faction==='wolf'&&!p.sealed?[...this.players.values()].filter(a=>a.faction==='wolf').map(a=>a.id):[],resources:p.resources,supplies:p.supplies,loot:p.loot.map(x=>({...x})),relics:p.relics.slice(),boons:p.boons.slice(),evidence:p.evidence.map(e=>({...e})),ghostVote:p.ghostVote,inputSeq:p.seq,skillCooldown:Math.max(0,p.skillAt-this.playElapsed),wolfBudget:p.faction==='wolf'&&!p.sealed?this.wolfBudget:0,draftOptions:p.draftOptions.slice(),voted:p.voted,feedback:p.feedback.map(event=>({...event})),offers:[...this.offers.entries()].filter(([,o])=>o.to===id&&o.until>=this.playElapsed).map(([from,o])=>({from,itemId:o.itemId,name:o.itemId==='core'?'归灯芯':o.itemId==='resources'?'工程亡絮':this.players.get(from)?.loot.find(x=>x.id===o.itemId)?.name??'物品',expiresIn:o.until-this.playElapsed,escrow:!!o.confirmed})),...(p.interaction?{interaction:{targetId:p.interaction.targetId,progress:p.interaction.elapsed/p.interaction.duration}}:{})};
  const publicKinds=['beacon','deposit','cleanse','exit'];
  const objects=this.objects.filter(o=>o.active&&(finished||publicKinds.includes(o.kind)||!council&&visible(o))).map(o=>({id:this.publicObjectId(o),kind:o.kind,name:o.name,x:o.x,y:o.y,active:o.active,progress:o.progress,...(o.amount!==undefined?{amount:o.amount}:{}),...(o.hp!==undefined?{hp:o.hp}:{})}));
  if(!p.sealed&&!finished&&!council&&this.coreHolder&&this.playElapsed%20<2){const core=this.objects.find(o=>o.id==='core')!;objects.push({id:'core-signal',kind:'core',name:'归灯芯·区域光柱',x:this.regionAt(core).x,y:this.regionAt(core).y,active:true,progress:0});}
  return {roomId:this.roomId,invite:this.invite,config:{...this.config,professions:this.config.professions.slice()},phase:this.phase,chapter:this.chapter,remaining:this.remaining,elapsed:this.elapsed,moon:this.moon,sharedResources:this.sharedResources,beaconsLit:this.beaconsLit,eliteDefeated:this.eliteDefeated,corePurified:this.corePurified,holdProgress:this.holdProgress,eligibleVoters:this.voteSet.size,removalCount:this.removalCount,players,self,nodes:this.layout.nodes.map(n=>({...n})),objects,evidence:this.publicEvidence.slice(-50).map(e=>({...e})),messages:this.messages.map(m=>({...m})),result:this.result?structuredClone(this.result):null,voice:this.voiceState()};
 }


}
