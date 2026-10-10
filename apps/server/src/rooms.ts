import { Room, type Client } from '@colyseus/core';
import { GameEngine, getConfig } from '@wangxu/rules';
import type { CampData, GameCommand, Settlement } from '@wangxu/shared';
import { randomInt } from 'node:crypto';
import { verifyGameTicket, getCamp, settleMatch } from './accounts.js';
import type { VoiceService } from './voice.js';
import type { VoiceLobbyService } from './voice-lobby.js';

export const rooms=new Map<string,ExpeditionRoom>();
const activeUsers=new Map<string,string>();
export function hasActiveExpedition(id:string){return activeUsers.has(id);}
let voiceLobby:VoiceLobbyService|undefined;
export function setVoiceLobby(service:VoiceLobbyService){voiceLobby=service;}
export let voiceService:VoiceService|undefined;
export function setVoiceService(service:VoiceService){voiceService=service;}
type Auth={userId:string;name:string;cosmetics:string[];equipment:CampData['equipment']};
export class ExpeditionRoom extends Room {
 engine!:GameEngine;private writes:Promise<unknown>=Promise.resolve();private voiceSyncing=false;private sendTick=0;private lastInputs=new Map<string,{at:number;count:number}>();private pending=false;settlementError:string|null=null;
 private closeRequested=false;private voiceClosing=false;private closedChapter=-1;private closingStarted=0;
 private joinedSessions=new Set<string>();
 allowsVoiceAdmission(){return !this.closeRequested&&!(this.engine.phase==='DISCUSS'&&this.closedChapter===this.engine.chapter);}
 async onCreate(options:{capacity?:number;invite?:string}){
  if(options.invite)throw new Error('邀请码不存在或远征已经开始');
  const config=getConfig(Number(options.capacity??4));this.maxClients=config.players;this.autoDispose=true;
  let invite:string;do{invite=randomInt(0x100000,0xffffff).toString(16).toUpperCase();}while([...rooms.values()].some(r=>r.engine.invite===invite));
  await this.setMetadata({invite,capacity:config.players});
  this.engine=new GameEngine({roomId:this.roomId,invite,config,onSettlement:(settlement)=>this.save(settlement)});rooms.set(this.roomId,this);
  this.onMessage('command',(client,command:GameCommand)=>{const auth=client.auth as Auth;const now=Date.now();let limit=this.lastInputs.get(client.sessionId);if(!limit||now-limit.at>1000){limit={at:now,count:0};this.lastInputs.set(client.sessionId,limit);}if(++limit.count>90)return;if(!command||typeof command!=='object')return;if(command.type==='choose'&&command.cosmetic&&!auth.cosmetics.includes(command.cosmetic)){client.send('error',{message:'尚未拥有该外观'});return;}if(command.type==='restart'&&this.pending){client.send('error',{message:'结算入库中，请稍候'});return;}try{if(!this.engine.command(auth.userId,command))client.send('error',{message:'当前阶段、距离或资源不满足此操作'});}catch{client.send('error',{message:'操作参数无效'});}});
  this.setFixedTimestep(()=>this.step(),20);
 }
 async onAuth(client:Client,options:{ticket?:string}){if(typeof options.ticket!=='string')throw new Error('请先登录');const ticket=await verifyGameTicket(options.ticket);const existing=activeUsers.get(ticket.userId);if(existing)throw new Error('此账户已有远征席位，请恢复原连接');const camp=await getCamp(ticket.userId);return {...ticket,cosmetics:camp.cosmetics,equipment:camp.equipment};}
 onJoin(client:Client){const auth=client.auth as Auth;if(activeUsers.has(auth.userId))throw new Error('此账户已有远征席位，请恢复原连接');this.engine.addPlayer({id:auth.userId,name:auth.name});const equipment=auth.equipment;this.engine.command(auth.userId,{type:'choose',profession:equipment.profession,form:equipment.form});const player=this.engine.players.get(auth.userId)!;const cosmetic=equipment.cosmeticId;player.cosmetic=(cosmetic.startsWith('outfit-')||cosmetic.startsWith('silver-'))&&!cosmetic.endsWith(player.profession)?'base':cosmetic;activeUsers.set(auth.userId,this.roomId);void voiceLobby?.removeParticipant(auth.userId);this.joinedSessions.add(client.sessionId);this.sendViews();}
 async onDrop(client:Client){if(!this.joinedSessions.has(client.sessionId))return;const auth=client.auth as Auth;this.engine.disconnect(auth.userId);this.sendViews();try{await this.allowReconnection(client,60);}catch{this.joinedSessions.delete(client.sessionId);if(activeUsers.get(auth.userId)===this.roomId)activeUsers.delete(auth.userId);}}
 onReconnect(client:Client){if(!this.joinedSessions.has(client.sessionId))throw new Error('远征席位已失效');this.engine.reconnect((client.auth as Auth).userId);this.sendViews();}
 onLeave(client:Client){if(!this.joinedSessions.delete(client.sessionId))return;const id=(client.auth as Auth)?.userId;if(id){this.engine.removePlayer(id);if((this.engine.phase==='LOBBY'||!!this.engine.result)&&activeUsers.get(id)===this.roomId)activeUsers.delete(id);}this.lastInputs.delete(client.sessionId);}
 private step(){const before=this.engine.phase;const scale=process.env.NODE_ENV==='test'?Math.min(60,Number(process.env.GAME_TIME_SCALE)||1):1;
  for(let i=0;i<scale;i++){
   if(voiceService&&this.engine.phase==='DISCUSS'&&this.engine.remaining<=.1&&this.closedChapter!==this.engine.chapter){
    if(!this.closeRequested){this.closeRequested=true;this.closingStarted=Date.now();}
    if(!this.voiceClosing){this.voiceClosing=true;void voiceService.closeRoom(this.roomId).then(closed=>{if(closed){this.closedChapter=this.engine.chapter;this.closeRequested=false;}else if(Date.now()-this.closingStarted>5000){this.engine.invalidate('议会语音未能安全关闭，本局无效');this.closeRequested=false;}}).finally(()=>{this.voiceClosing=false;});}
    this.sendViews();return;
   }
   this.engine.tick(.05);
  }
  if(before==='LOBBY'&&this.engine.phase!=='LOBBY')void this.lock();if(this.engine.phase==='LOBBY'&&this.locked){this.closedChapter=-1;void this.unlock();}
  if(this.engine.result)for(const player of this.engine.players.values())if(!player.connected&&activeUsers.get(player.id)===this.roomId)activeUsers.delete(player.id);
  if(++this.sendTick%2===0)this.sendViews();
  if(voiceService&&!this.voiceSyncing&&!(this.engine.phase==='DISCUSS'&&(this.closedChapter===this.engine.chapter||this.closeRequested))){this.voiceSyncing=true;void voiceService.syncRoom(this.roomId,this.engine.getVoiceState()).catch(error=>console.error('[voice]',error.message)).finally(()=>{this.voiceSyncing=false;});}
 }
 private sendViews(){for(const client of this.clients){try{const view=this.engine.viewFor((client.auth as Auth).userId);const state=voiceService?.snapshot(this.roomId);view.voice.epoch=state?.epoch??null;view.voice.enabled=view.phase==='DISCUSS'&&!!state?.epoch;client.send('view',view);if(this.settlementError)client.send('error',{message:'结算暂未入库，服务正在重试。'});}catch{}}}
 private save(settlement:Settlement){this.pending=true;this.writes=this.writes.then(async()=>{for(let attempt=0;;attempt++){try{await settleMatch(settlement);this.pending=false;this.settlementError=null;this.broadcast('settlementCommitted',{matchId:settlement.matchId});return;}catch(error){this.settlementError=(error as Error).message;console.error('[settlement] retry',attempt,this.settlementError);await new Promise(resolve=>setTimeout(resolve,Math.min(30000,1000*2**Math.min(attempt,5))));}}}).catch(error=>{console.error(error);});}
 hasPlayer(id:string){return this.engine.players.has(id);}
 async onDispose(){rooms.delete(this.roomId);for(const p of this.engine.players.values())if(activeUsers.get(p.id)===this.roomId)activeUsers.delete(p.id);await voiceService?.closeRoom(this.roomId).catch(()=>{});await this.writes;}
}
