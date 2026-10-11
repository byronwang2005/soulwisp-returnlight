import { describe, expect, it, vi } from 'vitest';
import { assignProfessions, LobbyCoordinator } from '../apps/server/src/lobby-coordinator.js';
import { GameEngine, getConfig } from '@wangxu/rules';
function setup() {
  let now=0, draining=false;
  const effects={start:vi.fn(),return:vi.fn(),close:vi.fn(),changed:vi.fn()};
  const lobby=new LobbyCoordinator(effects,()=>now,()=>draining);
  const add=(id:string)=>lobby.join({id,name:id,preference:'warden'});
  const ready=(id:string,value=true)=>lobby.command(id,{type:'ready',ready:value});
  const advance=(ms:number)=>{now+=ms;lobby.tick();};
  return {lobby,effects,add,ready,advance,drain:()=>{draining=true;lobby.tick();}};
}
describe('single waiting queue',()=>{
  it.each([4,5,6,7,8,9,10])('starts exactly one %i-player match after everybody is ready and ten seconds',count=>{
    const s=setup();for(let i=0;i<count;i++)s.add(`${i}`);
    for(let i=0;i<count-1;i++)s.ready(`${i}`);
    s.advance(15000);expect(s.effects.start).not.toHaveBeenCalled();s.ready(`${count-1}`);
    expect(s.lobby.snapshot('0').countdown).toBe(10);s.advance(9999);expect(s.effects.start).not.toHaveBeenCalled();s.advance(1);
    expect(s.effects.start).toHaveBeenCalledTimes(1);expect(s.effects.start.mock.calls[0][1]).toHaveLength(count);s.advance(10000);expect(s.effects.start).toHaveBeenCalledTimes(1);
  });
  it('does not start with three ready members',()=>{const s=setup();for(const id of ['a','b','c']){s.add(id);s.ready(id);}s.advance(30000);expect(s.effects.start).not.toHaveBeenCalled();});
  it('admits overflow, preserves FIFO, and does not wait for overflow readiness',()=>{
    const s=setup();for(let i=0;i<12;i++)s.add(`${i}`);for(let i=0;i<10;i++)s.ready(`${i}`);
    const view=s.lobby.snapshot('11');expect(view.members).toHaveLength(12);expect(view.members[11]).toMatchObject({position:12,candidate:false});s.advance(10000);
    expect(s.effects.start.mock.calls[0][1].map((m:{id:string})=>m.id)).toEqual(Array.from({length:10},(_,i)=>`${i}`));
    expect(s.lobby.snapshot('11').members.map(m=>m.id)).toEqual(['10','11']);
  });
  it('freezes countdown membership and late arrivals wait',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.add('e');
    expect(s.lobby.snapshot('e').members.find(m=>m.id==='e')?.candidate).toBe(false);s.advance(10000);expect(s.effects.start.mock.calls[0][1]).toHaveLength(4);
  });
  it('cancels when a candidate unreads or disconnects; reconnect joins at the tail unready',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.ready('b',false);s.advance(10000);expect(s.effects.start).not.toHaveBeenCalled();s.ready('b');s.advance(3000);s.lobby.disconnect('a');s.add('a');
    expect(s.lobby.snapshot('a').members.at(-1)).toMatchObject({id:'a',ready:false});expect(s.lobby.snapshot('a').countdown).toBeNull();
  });
  it('rejects duplicate accounts and invalid commands; preference changes unready the member',()=>{
    const s=setup();s.add('a');expect(()=>s.add('a')).toThrow();s.ready('a');expect(s.lobby.command('a',{type:'preference',profession:null})).toBe(true);
    expect(s.lobby.snapshot('a').members[0]).toMatchObject({ready:false,preference:null});expect(s.lobby.command('missing',{type:'ready',ready:true})).toBe(false);
    expect(s.lobby.command('a',{type:'preference',profession:'__proto__' as never})).toBe(false);
  });
  it('times out incomplete transfer after thirty seconds and keeps the slot until close completes',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.advance(10000);s.advance(29999);expect(s.effects.close).not.toHaveBeenCalled();s.advance(1);
    expect(s.effects.return.mock.calls[0][0]).toEqual(['a','b','c','d']);expect(s.lobby.busy).toBe(true);expect(s.lobby.snapshot('a').members.every(m=>!m.ready)).toBe(true);
    s.lobby.closed(s.effects.close.mock.calls[0][0]);expect(s.lobby.busy).toBe(false);
  });
  it('returns disconnected transfer members only after reconnect with a fresh queue position',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.advance(10000);s.lobby.disconnect('a');
    expect(s.lobby.snapshot('b').members.map(m=>m.id)).toEqual(['b','c','d']);s.add('a');expect(s.lobby.snapshot('a').members.at(-1)?.id).toBe('a');
  });
  it('starts fifteen-second return only for a final result and preserves return ordering after early return',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.advance(10000);const id=s.lobby.matchId!;s.lobby.attach(id,'room');s.lobby.admitted(id);s.add('e');
    s.lobby.gameState(id,'RESULT',0,false);s.advance(20000);expect(s.effects.close).not.toHaveBeenCalled();expect(s.lobby.returnEarly('a')).toBe(false);
    s.lobby.gameState(id,'RESULT',0,true);expect(s.lobby.returnEarly('c')).toBe(true);s.add('f');s.advance(14999);expect(s.effects.close).not.toHaveBeenCalled();s.advance(1);
    expect(s.lobby.snapshot('a').members.map(m=>m.id)).toEqual(['e','a','b','c','d','f']);expect(s.lobby.snapshot('a').members.find(m=>m.id==='a')).toMatchObject({ready:false,preference:'warden'});
  });
  it('puts members who joined during result display ahead of a batch that has not returned yet',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.advance(10000);const id=s.lobby.matchId!;s.lobby.admitted(id);s.lobby.gameState(id,'RESULT',0,true);s.add('e');s.advance(15000);
    expect(s.lobby.snapshot('a').members.map(m=>m.id)).toEqual(['e','a','b','c','d']);
  });
  it('does not return disconnected game members automatically',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.advance(10000);const id=s.lobby.matchId!;s.lobby.admitted(id);s.lobby.disconnect('a');s.lobby.gameState(id,'RESULT',0,true);s.advance(15000);
    expect(s.effects.return.mock.calls[0][0]).not.toContain('a');
  });
  it('draining cancels countdown and blocks further starts but allows waiting joins',()=>{
    const s=setup();for(const id of ['a','b','c','d']){s.add(id);s.ready(id);}s.drain();s.add('e');s.ready('e');s.advance(10000);expect(s.effects.start).not.toHaveBeenCalled();expect(s.lobby.snapshot('e').draining).toBe(true);
  });
  it('public summary contains no account names, preferences or identity state',()=>{
    const s=setup();s.add('private-user');expect(JSON.stringify(s.lobby.summary())).not.toContain('private-user');expect(s.lobby.summary()).not.toHaveProperty('members');
  });
});
describe('profession preference assignment',()=>{
  it('satisfies distinct available preferences and allocates every slot once',()=>{
    const accounts=['warden','scout','scavenger','broker'].map((profession,i)=>({id:`${i}`,name:`${i}`,preference:profession as 'warden'}));
    const result=assignProfessions(accounts,getConfig(4).professions,()=>0);expect(result.map(r=>r.profession)).toEqual(accounts.map(a=>a.preference));expect(new Set(result.map(r=>r.slot)).size).toBe(4);
  });
  it('draws fairly for conflicts and handles absent preferences and two warden seats',()=>{
    const accounts=Array.from({length:10},(_,i)=>({id:`${i}`,name:`${i}`,preference:'warden' as const}));
    const low=assignProfessions(accounts,getConfig(10).professions,()=>0);const high=assignProfessions(accounts,getConfig(10).professions,max=>max-1);
    expect(low.filter(r=>r.profession==='warden').map(r=>r.id)).toEqual(['0','1']);expect(high.filter(r=>r.profession==='warden').map(r=>r.id)).toEqual(['8','9']);
    const absent=assignProfessions(accounts.slice(0,4).map(a=>({...a,preference:'ranger' as const})),getConfig(4).professions,()=>0);expect(absent.map(a=>a.profession).sort()).toEqual(getConfig(4).professions.slice().sort());
  });
  it('does not touch faction state; only PREP permits form changes and identities remain private',()=>{
    const engine=new GameEngine({roomId:'test',invite:'',config:getConfig(4),seed:3});
    for(let i=0;i<4;i++)engine.addPlayer({id:`${i}`,name:`${i}`});expect(engine.command('0',{type:'chooseForm',form:1})).toBe(false);expect(engine.beginPreparation()).toBe(true);
    expect(engine.command('0',{type:'chooseForm',form:1})).toBe(true);expect(engine.command('0',{type:'chooseForm',form:999})).toBe(false);expect(engine.command('0',{type:'choose',profession:'scout',form:0})).toBe(false);
    expect(engine.viewFor('0').self.faction).toBeNull();engine.tick(45);expect(engine.viewFor('0').self.faction).not.toBeNull();expect(engine.viewFor('0').players.every(p=>!Object.hasOwn(p,'faction'))).toBe(true);
    expect([...engine.players.values()].filter(p=>p.faction==='wolf')).toHaveLength(1);expect(engine.command('0',{type:'chooseForm',form:0})).toBe(false);
  });
});

it('updates only the matching avatar while preserving queue order, readiness and the countdown',()=>{
  const s=setup();for(const id of ['a','b','c','d']){s.lobby.join({id,name:'同名',preference:'warden',image:'/avatars/lantern-1.svg'});s.ready(id);}
  const before=s.lobby.snapshot('a');s.effects.changed.mockClear();
  s.lobby.updateAvatar('b','/avatars/lantern-2.svg');
  const after=s.lobby.snapshot('a');expect(after.countdown).toBe(before.countdown);
  expect(after.members.map(({image,...member})=>member)).toEqual(before.members.map(({image,...member})=>member));
  expect(after.members.map(member=>member.image)).toEqual(['/avatars/lantern-1.svg','/avatars/lantern-2.svg','/avatars/lantern-1.svg','/avatars/lantern-1.svg']);
  expect(s.effects.changed).toHaveBeenCalledOnce();s.lobby.updateAvatar('unknown',null);expect(s.effects.changed).toHaveBeenCalledOnce();
  s.lobby.updateAvatar('b',null);s.advance(10000);
  expect(s.effects.start.mock.calls[0][1].find((member:{id:string})=>member.id==='b')).toMatchObject({name:'同名',image:null});
});
