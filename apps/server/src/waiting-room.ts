import { matchMaker, Room, type Client } from '@colyseus/core';
import type { IRoomCache } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { getCamp, issueGameTicket, verifyGameTicket } from './accounts.js';
import { assertAdmissionOpen, isDraining } from './deployment.js';
import { LobbyCoordinator, type LobbyAccount, type MatchSelection } from './lobby-coordinator.js';
import { INTERNAL_CREATE_KEY, setLobbyCoordinator, setSettlementNotifier } from './match-control.js';
import { rooms } from './rooms.js';
import type { LobbyCommand } from '@wangxu/shared';

export let waitingRoom: WaitingRoom | undefined;
let waitingCache: IRoomCache | undefined;
export async function createWaitingRoom() { waitingCache = await matchMaker.createRoom('waiting', { internalKey: INTERNAL_CREATE_KEY }); }
export async function reserveWaiting(account: { id: string; name: string }) {
  if (!waitingCache || !waitingRoom) throw new Error('等待区暂未就绪，请重试');
  return matchMaker.reserveSeatFor(waitingCache, { ticket: issueGameTicket(account.id, account.name) });
}
export class WaitingRoom extends Room {
  coordinator!: LobbyCoordinator;
  private sessions = new Map<string, Client>();
  private inputLimits=new Map<string,{at:number;count:number}>();
  private matches = new Map<string, string>();
  onCreate(options: { internalKey?: string }) {
    if (options.internalKey !== INTERNAL_CREATE_KEY || waitingRoom) throw new Error('请刷新页面并加入唯一等待区');
    this.autoDispose = false; this.maxClients = Infinity; void this.setPrivate(true);
    waitingRoom = this;
    this.coordinator = new LobbyCoordinator({
      start: (id, selection) => { void this.start(id, selection); },
      return: (ids, message) => {
        for (const id of ids) {
          for (const room of rooms.values()) room.returnPlayer(id);
          this.sessions.get(id)?.send('returned', { message });
        }
      },
      close: id => { void this.closeMatch(id); },
      changed: () => this.sendViews(),
    }, Date.now, isDraining);
    setLobbyCoordinator(this.coordinator);setSettlementNotifier(ids => this.notifySettlement(ids));
    this.onMessage('lobbyCommand', (client, command: LobbyCommand) => {
      let limit=this.inputLimits.get(client.sessionId);if(!limit||Date.now()-limit.at>=1000){limit={at:Date.now(),count:0};this.inputLimits.set(client.sessionId,limit);}if(++limit.count>30)return;
      if (!command || typeof command !== 'object' || !this.coordinator.command((client.auth as LobbyAccount).id, command)) client.send('error', { message: '当前不能修改准备状态或职业偏好' });
    });
    this.onMessage('returnEarly', client => {this.coordinator.returnEarly((client.auth as LobbyAccount).id);});
    this.setSimulationInterval(() => this.coordinator.tick(), 250);
  }
  async onAuth(_client: Client, options: { ticket?: string }) {
    if (typeof options.ticket !== 'string') throw new Error('请先登录');
    const ticket = verifyGameTicket(options.ticket);
    if (this.sessions.has(ticket.userId)) throw new Error('此账户已在大厅，请使用原页面');
    const camp = await getCamp(ticket.userId);
    return { id: ticket.userId, name: ticket.name, preference: camp.equipment.profession } satisfies LobbyAccount;
  }
  onJoin(client: Client) {
    const account = client.auth as LobbyAccount;
    if (this.sessions.has(account.id)) throw new Error('此账户已在大厅，请使用原页面');
    this.sessions.set(account.id, client);
    try { this.coordinator.join(account); } catch (error) { this.sessions.delete(account.id); throw error; }
    this.sendViews();
  }
  async onDrop(client: Client) {
    this.detach(client);
    try { await this.allowReconnection(client, 60); } catch { /* A new join gets a new queue position. */ }
  }
  onReconnect(client: Client) { this.onJoin(client); }
  onLeave(client: Client) { this.detach(client); }
  private detach(client: Client) {
    const id = (client.auth as LobbyAccount)?.id;
    if (this.sessions.get(id) !== client) return;
    this.sessions.delete(id);this.inputLimits.delete(client.sessionId); this.coordinator.disconnect(id); this.sendViews();
  }
  private sendViews() { for (const [id, client] of this.sessions) client.send('lobbyView', this.coordinator.snapshot(id)); }
  notifySettlement(ids: string[]) { for (const id of ids) this.sessions.get(id)?.send('settlementCommitted', {}); }
  private async start(id: string, selection: MatchSelection[]) {
    let roomId: string | undefined;
    try {
      assertAdmissionOpen();
      const selected = selection.map(member => ({ ...member, seatKey: randomUUID() }));
      const cache = await matchMaker.createRoom('expedition', { internalKey: INTERNAL_CREATE_KEY, matchId: id, selection: selected });
      roomId = cache.roomId; this.matches.set(id, roomId);
      if (!this.coordinator.attach(id, roomId)) { this.matches.delete(id);await rooms.get(roomId)?.disconnect(); return; }
      const room = rooms.get(roomId)!;
      await room.revokeWaitingVoice();
      const reservations = await Promise.all(selected.map(async member => ({ id: member.id, reservation: await matchMaker.reserveSeatFor(cache, { ticket: issueGameTicket(member.id, member.name), seatKey: member.seatKey }) })));
      if (this.coordinator.matchId !== id) { await room.disconnect(); return; }
      for (const entry of reservations) this.sessions.get(entry.id)?.send('matchSeat', entry.reservation);
    } catch (error) {
      console.error('[lobby] transfer failed', error instanceof Error ? error.message : error);
      this.coordinator.fail(id, '入场失败，已返回等待区，请重新准备。');
      if (roomId) await rooms.get(roomId)?.disconnect().catch(() => {});
    }
  }
  private async closeMatch(id: string) {
    const roomId = this.matches.get(id); this.matches.delete(id);
    try { if (roomId) await rooms.get(roomId)?.disconnect(); }
    catch (error) { console.error('[lobby] close failed', error); }
    finally { this.coordinator.closed(id); }
  }
  onDispose() { if(waitingRoom===this){waitingRoom = undefined; waitingCache = undefined;} }
}
