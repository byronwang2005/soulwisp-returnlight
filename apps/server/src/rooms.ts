import { Room, type Client } from '@colyseus/core';
import { GameEngine, getConfig, professionForms } from '@wangxu/rules';
import type { CampData, GameCommand, Settlement } from '@wangxu/shared';
import { INTERNAL_CREATE_KEY, lobbyCoordinator, notifySettlement } from './match-control.js';
import type { MatchSelection } from './lobby-coordinator.js';
import { verifyGameTicket, getCamp, settleMatch } from './accounts.js';
import type { VoiceService } from './voice.js';
import type { VoiceLobbyService } from './voice-lobby.js';
import { assertAdmissionOpen } from './deployment.js';

export function syncAccountAvatar(id: string, image: string | null) {
 for (const room of rooms.values()) room.updateAvatar(id, image);
}
export const pendingSettlements=new Set<Promise<unknown>>();
export const rooms=new Map<string,ExpeditionRoom>();
const activeUsers=new Map<string,string>();
export function hasActiveExpedition(id:string){return activeUsers.has(id)||lobbyCoordinator?.isPlaying(id)===true;}
let voiceLobby:VoiceLobbyService|undefined;
export function setVoiceLobby(service:VoiceLobbyService){voiceLobby=service;}
export let voiceService:VoiceService|undefined;
export function setVoiceService(service:VoiceService){voiceService=service;}
type Auth={userId:string;name:string;cosmetics:string[];equipment:CampData['equipment']};
export class ExpeditionRoom extends Room {
 engine!:GameEngine;private writes:Promise<unknown>=Promise.resolve();private voiceSyncing=false;private sendTick=0;private lastInputs=new Map<string,{at:number;count:number}>();private pending=false;settlementError:string|null=null;
 private closeRequested=false;private voiceClosing=false;private closedChapter=-1;private closingStarted=0;
 private matchId='';private selection=new Map<string,MatchSelection & {seatKey:string}>();private resultAt:number|null=null;
 private joinedSessions=new Set<string>();
 allowsVoiceAdmission(){return !this.closeRequested&&!(this.engine.phase==='DISCUSS'&&this.closedChapter===this.engine.chapter);}
 async onCreate(options:{internalKey?:string;matchId?:string;selection?:Array<MatchSelection & {seatKey:string}>}){
  assertAdmissionOpen();
  if(options.internalKey!==INTERNAL_CREATE_KEY||!options.matchId||!options.selection||lobbyCoordinator?.matchId!==options.matchId)throw new Error('请刷新页面并加入等待区');
  this.matchId=options.matchId;this.selection=new Map(options.selection.map(p=>[p.id,p]));
  const config=getConfig(options.selection.length);this.maxClients=config.players;this.autoDispose=false;this.setSeatReservationTime(30);
  await this.setPrivate(true);
  this.engine=new GameEngine({roomId:this.roomId,invite:'',config,onSettlement:(settlement)=>this.save(settlement)});
  for(const member of options.selection){this.engine.addPlayer({id:member.id,name:member.name});const p=this.engine.players.get(member.id)!;p.slot=member.slot;p.profession=member.profession;p.connected=false;}
  rooms.set(this.roomId,this);
  this.onMessage('command',(client,command:GameCommand)=>{const auth=client.auth as Auth;const now=Date.now();let limit=this.lastInputs.get(client.sessionId);if(!limit||now-limit.at>1000){limit={at:now,count:0};this.lastInputs.set(client.sessionId,limit);}if(++limit.count>90)return;if(!command||typeof command!=='object')return;if(!lobbyCoordinator?.isPlaying(auth.userId))return;if(['choose','ready','restart'].includes(command.type)){client.send('error',{message:'职业与开局由大厅分配'});return;}try{if(!this.engine.command(auth.userId,command))client.send('error',{message:'当前阶段、距离或资源不满足此操作'});}catch{client.send('error',{message:'操作参数无效'});}});
  this.setFixedTimestep(()=>this.step(),20);
 }
 async onAuth(_client:Client,options:{ticket?:string;seatKey?:string}){
  if(typeof options.ticket!=='string')throw new Error('请先登录');
  const ticket=verifyGameTicket(options.ticket),assigned=this.selection.get(ticket.userId);
  if(!assigned||assigned.seatKey!==options.seatKey||lobbyCoordinator?.matchId!==this.matchId||!lobbyCoordinator.isPlaying(ticket.userId))throw new Error('此账户没有本局席位');
  if(activeUsers.has(ticket.userId))throw new Error('此账户已有远征席位，请恢复原连接');
  const camp=await getCamp(ticket.userId);return {...ticket,cosmetics:camp.cosmetics,equipment:camp.equipment};
 }
 onJoin(client:Client){
  assertAdmissionOpen();const auth=client.auth as Auth;
  if(activeUsers.has(auth.userId)||lobbyCoordinator?.matchId!==this.matchId||!lobbyCoordinator.isPlaying(auth.userId))throw new Error('远征席位已失效');
  this.engine.reconnect(auth.userId);const p=this.engine.players.get(auth.userId)!,equipment=auth.equipment;
  p.form=equipment.profession===p.profession&&professionForms(p.profession).includes(equipment.form)?equipment.form:0;
  const cosmetic=equipment.cosmeticId;p.cosmetic=auth.cosmetics.includes(cosmetic)&&(!cosmetic.startsWith('outfit-')&&!cosmetic.startsWith('silver-')||cosmetic.endsWith(p.profession))?cosmetic:'base';
  activeUsers.set(auth.userId,this.roomId);this.joinedSessions.add(client.sessionId);
  if(this.engine.phase==='LOBBY'&&[...this.engine.players.values()].every(p=>p.connected)&&lobbyCoordinator.admitted(this.matchId))this.engine.beginPreparation();
  this.sendViews();
 }
 async revokeWaitingVoice(){for(const id of this.selection.keys())await voiceLobby?.removeParticipant(id);}
 returnPlayer(id:string){if(!this.selection.has(id))return;if(activeUsers.get(id)===this.roomId)activeUsers.delete(id);for(const client of this.clients)if((client.auth as Auth).userId===id){this.joinedSessions.delete(client.sessionId);client.send('returnToLobby',{});void client.leave();}}
 async onDrop(client:Client){if(!this.joinedSessions.has(client.sessionId))return;const auth=client.auth as Auth;this.engine.disconnect(auth.userId);this.sendViews();try{await this.allowReconnection(client,60);}catch{this.joinedSessions.delete(client.sessionId);if(activeUsers.get(auth.userId)===this.roomId)activeUsers.delete(auth.userId);}}
 onReconnect(client:Client){if(!this.joinedSessions.has(client.sessionId)||!lobbyCoordinator?.isPlaying((client.auth as Auth).userId))throw new Error('远征席位已失效');this.engine.reconnect((client.auth as Auth).userId);this.sendViews();}
 onLeave(client:Client){if(!this.joinedSessions.delete(client.sessionId))return;const id=(client.auth as Auth)?.userId;if(id){this.engine.disconnect(id);if((this.engine.phase==='LOBBY'||!!this.engine.result)&&activeUsers.get(id)===this.roomId)activeUsers.delete(id);}this.lastInputs.delete(client.sessionId);}
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
  if(this.engine.result&&this.resultAt===null)this.resultAt=Date.now();
  lobbyCoordinator?.gameState(this.matchId,this.engine.phase,this.engine.remaining,!!this.engine.result);
  if(this.engine.result)for(const player of this.engine.players.values())if(!player.connected&&activeUsers.get(player.id)===this.roomId)activeUsers.delete(player.id);
  if(++this.sendTick%2===0)this.sendViews();
  if(voiceService&&!this.voiceSyncing&&!(this.engine.phase==='DISCUSS'&&(this.closedChapter===this.engine.chapter||this.closeRequested))){this.voiceSyncing=true;void voiceService.syncRoom(this.roomId,this.engine.getVoiceState()).catch(error=>console.error('[voice]',error.message)).finally(()=>{this.voiceSyncing=false;});}
 }
 updateAvatar(id:string,image:string|null){const member=this.selection.get(id);if(!member)return;member.image=image;this.sendViews();}
 private sendViews(){for(const client of this.clients){try{const view=this.engine.viewFor((client.auth as Auth).userId);view.players=view.players.map(player=>({...player,image:this.selection.get(player.id)?.image??null}));const state=voiceService?.snapshot(this.roomId);view.returnIn=this.resultAt===null?undefined:Math.max(0,Math.ceil((this.resultAt+15000-Date.now())/1000));view.settlementPending=this.pending;view.voice.epoch=state?.epoch??null;view.voice.enabled=view.phase==='DISCUSS'&&!!state?.epoch;client.send('view',view);if(this.settlementError)client.send('error',{message:'结算暂未入库，服务正在重试。'});}catch{}}}
 private save(settlement:Settlement){this.pending=true;this.writes=this.writes.then(async()=>{for(let attempt=0;;attempt++){try{await settleMatch(settlement);this.pending=false;this.settlementError=null;this.broadcast('settlementCommitted',{matchId:settlement.matchId});notifySettlement([...this.selection.keys()]);return;}catch(error){this.settlementError=(error as Error).message;console.error('[settlement] retry',attempt,this.settlementError);await new Promise(resolve=>setTimeout(resolve,Math.min(30000,1000*2**Math.min(attempt,5))));}}}).catch(error=>{console.error(error);});const task=this.writes;pendingSettlements.add(task);void task.finally(()=>pendingSettlements.delete(task));}
 hasPlayer(id:string){return this.engine.players.has(id);}
 async onDispose(){for(const p of this.engine?.players.values()??[])if(activeUsers.get(p.id)===this.roomId)activeUsers.delete(p.id);await voiceService?.closeRoom(this.roomId).catch(()=>{});rooms.delete(this.roomId);}
}
