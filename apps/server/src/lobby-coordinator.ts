import { randomInt, randomUUID } from 'node:crypto';
import { getConfig } from '@wangxu/rules';
import { PROFESSION_NAMES, type LobbyCommand, type LobbyView, type Phase, type Profession } from '@wangxu/shared';

export interface LobbyAccount { id: string; name: string; preference: Profession | null }
interface Member extends LobbyAccount { order: number; ready: boolean; connected: boolean; area: 'waiting' | 'playing' }
export interface MatchSelection extends LobbyAccount { slot: number; profession: Profession }
interface Match { id: string; roomId: string | null; ids: string[]; stage: 'transferring' | 'playing' | 'result' | 'closing'; deadline: number | null; phase: Phase | null; remaining: number; returnOrders: Map<string, number> }
export interface LobbyEffects {
  start: (id: string, selection: MatchSelection[]) => void;
  return: (ids: string[], message: string) => void;
  close: (id: string) => void;
  changed?: () => void;
}

/** Assign preferences without coupling the lottery to the faction draw. */
export function assignProfessions(accounts: LobbyAccount[], pool: Profession[], draw: (max: number) => number = randomInt): MatchSelection[] {
  if (pool.length !== accounts.length || new Set(accounts.map(a => a.id)).size !== accounts.length) throw new Error('非法席位名单');
  const free = pool.map((profession, slot) => ({ profession, slot }));
  const assigned = new Map<string, { profession: Profession; slot: number }>();
  for (const profession of new Set(pool)) {
    const candidates = accounts.filter(a => a.preference === profession);
    const slots = free.filter(s => s.profession === profession);
    for (const slot of slots) {
      if (!candidates.length) break;
      const chosen = candidates.splice(draw(candidates.length), 1)[0]!;
      assigned.set(chosen.id, slot); free.splice(free.indexOf(slot), 1);
    }
  }
  for (const account of accounts) if (!assigned.has(account.id)) assigned.set(account.id, free.splice(draw(free.length), 1)[0]!);
  return accounts.map(account => ({ ...account, ...assigned.get(account.id)! }));
}

/** One authority for the queue and the single game slot. Time is real server time. */
export class LobbyCoordinator {
  private members = new Map<string, Member>();
  private order = 0;
  private countdown: { ids: string[]; deadline: number } | null = null;
  private match: Match | null = null;
  constructor(private effects: LobbyEffects, private now: () => number = Date.now, private draining: () => boolean = () => false) {}
  get busy() { return Boolean(this.match); }
  get matchId() { return this.match?.id ?? null; }
  isWaiting(id: string) { const m = this.members.get(id); return Boolean(m?.connected && m.area === 'waiting'); }
  isPlaying(id: string) { return this.match?.ids.includes(id) === true && this.members.get(id)?.area === 'playing'; }
  private waiting() { return [...this.members.values()].filter(m => m.area === 'waiting' && m.connected).sort((a,b) => a.order-b.order); }
  join(account: LobbyAccount) {
    const existing = this.members.get(account.id);
    if (existing?.connected) throw new Error('此账户已在大厅，请使用原页面');
    if (existing?.area === 'playing') { existing.connected = true; existing.name = account.name; }
    else this.members.set(account.id, { ...account, order: ++this.order, ready: false, connected: true, area: 'waiting' });
    this.check();
  }
  disconnect(id: string) {
    const member = this.members.get(id); if (!member) return;
    member.connected = false; member.ready = false;
    if (member.area === 'waiting') this.members.delete(id);
    if (this.countdown?.ids.includes(id)) this.countdown = null;
    if (this.match?.stage === 'transferring' && this.match.ids.includes(id)) this.finish('同行者断线，已取消入场，请重新准备。');
    this.check();
  }
  command(id: string, command: LobbyCommand) {
    const member = this.members.get(id);
    if (!member?.connected || member.area !== 'waiting') return false;
    if (command.type === 'ready' && typeof command.ready === 'boolean') {
      member.ready = command.ready;
      if (!command.ready && this.countdown?.ids.includes(id)) this.countdown = null;
    } else if (command.type === 'preference' && (command.profession === null || Object.hasOwn(PROFESSION_NAMES, command.profession))) {
      if (this.countdown?.ids.includes(id)) return false;
      member.preference = command.profession; member.ready = false;
    } else return false;
    this.check(); return true;
  }
  private check() {
    if (this.draining()) this.countdown = null;
    if (!this.match && !this.countdown && !this.draining()) {
      const candidates = this.waiting().slice(0, 10);
      if (candidates.length >= 4 && candidates.every(m => m.ready)) this.countdown = { ids: candidates.map(m => m.id), deadline: this.now()+10_000 };
    }
    this.effects.changed?.();
  }
  tick() {
    if (this.draining()) this.countdown = null;
    if (this.countdown && this.now() >= this.countdown.deadline) {
      const selected = this.countdown.ids.map(id => this.members.get(id)!);
      this.countdown = null;
      if (!this.match && !this.draining() && selected.every(m => m?.connected && m.ready && m.area === 'waiting')) {
        const id = randomUUID();
        this.match = { id, roomId: null, ids: selected.map(m => m.id), stage: 'transferring', deadline: this.now()+30_000, phase: null, remaining: 0, returnOrders: new Map() };
        selected.forEach(m => { m.area = 'playing'; m.ready = false; });
        this.effects.changed?.();
        this.effects.start(id, assignProfessions(selected, getConfig(selected.length).professions));
      }
    }
    const match = this.match;
    if (match?.deadline !== null && match?.deadline !== undefined && this.now() >= match.deadline) {
      if (match.stage === 'transferring') this.finish('入场未完成，已返回等待区，请重新准备。');
      else if (match.stage === 'result') this.finish('本局结束，已返回等待区。');
    }
    this.check();
  }
  attach(id: string, roomId: string) { if (this.match?.id !== id || this.match.stage !== 'transferring') return false; this.match.roomId = roomId; return true; }
  admitted(id: string) { if (this.match?.id !== id || this.match.stage !== 'transferring') return false; this.match.stage = 'playing'; this.match.deadline = null; this.check(); return true; }
  gameState(id: string, phase: Phase, remaining: number, final: boolean) {
    const match = this.match; if (!match || match.id !== id || match.stage === 'closing') return;
    match.phase = phase; match.remaining = remaining;
    if (final && match.stage !== 'result') {
      match.stage = 'result'; match.deadline = this.now()+15_000;
    }
  }
  returnEarly(id: string) {
    if (this.match?.stage !== 'result' || !this.match.ids.includes(id) || !this.members.get(id)?.connected || this.members.get(id)?.area!=='playing') return false;
    this.returnMembers([id], '已返回等待区。'); this.check(); return true;
  }
  private returnMembers(ids: string[], message: string) {
    const returned: string[] = [];
    if(this.match&&!this.match.returnOrders.size)this.match.ids.forEach(id=>this.match!.returnOrders.set(id,++this.order));
    for (const id of ids) {
      const member = this.members.get(id);
      if (!member || member.area !== 'playing') continue;
      if (!member.connected) { this.members.delete(id); continue; }
      member.area = 'waiting'; member.ready = false;
      member.order = this.match?.returnOrders.get(id) ?? ++this.order; returned.push(id);
    }
    this.effects.return(returned, message);
  }
  fail(id: string, message: string) { if (this.match?.id === id) this.finish(message); }
  private finish(message: string) {
    const match = this.match; if (!match || match.stage === 'closing') return;
    this.returnMembers(match.ids, message); match.stage = 'closing'; match.deadline = null;
    this.effects.close(match.id); this.check();
  }
  closed(id: string) { if (this.match?.id !== id) return; this.match = null; this.check(); }
  snapshot(selfId: string): LobbyView {
    const waiting = this.waiting(); const candidates = this.countdown?.ids ?? waiting.slice(0,10).map(m => m.id);
    const match = this.match;
    return { selfId, members: waiting.map((m,index) => ({ id: m.id, name: m.name, ready: m.ready, preference: m.preference, position: index+1, candidate: candidates.includes(m.id) })),
      selfArea: this.members.get(selfId)?.area ?? 'waiting', countdown: this.countdown ? Math.max(0,Math.ceil((this.countdown.deadline-this.now())/1000)) : null,
      game: match ? { stage: match.stage, players: match.ids.length, phase: match.phase, remaining: match.remaining } : null, draining: this.draining() };
  }
  summary() { const view = this.snapshot(''); return { waiting: view.members.length, game: view.game, countdown: view.countdown, draining: view.draining }; }
}
