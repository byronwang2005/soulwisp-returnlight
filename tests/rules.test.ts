import { describe, expect, it, vi } from 'vitest';
import { GameEngine, getConfig, getLayout, RULES } from '../packages/rules/src/index.js';
import {approachPoint} from '@wangxu/shared';
import type { GameCommand, Phase, Settlement } from '@wangxu/shared';
import type { Faction, Profession } from '@wangxu/shared';

// Scenario setup can access internals here; no corresponding command is exposed to clients.
const state = (game: GameEngine) => game as unknown as {
  playElapsed:number;coreHolder:string|null;wolfBudget:number;chapterFinished:boolean;
  escortHold:Map<string,number>;seal:(p:ReturnType<GameEngine['players']['get']>)=>void;
  damage:(p:NonNullable<ReturnType<GameEngine['players']['get']>>,n:number)=>void;
};
function room(n=4, seed:number|string=12, onSettlement?:(s:Settlement)=>void|Promise<void>) {
  let now=0;
  const game=new GameEngine({roomId:`test-${n}`,invite:'LOCAL',config:getConfig(n),seed,clock:()=>now,onSettlement});
  for(let i=0;i<n;i++)game.addPlayer({id:`p${i}`,name:`玩家${i}`});
  return {game,setTime:(value:number)=>{now=value;},start:()=>{for(const p of game.players.values())game.command(p.id,{type:'ready',ready:true});game.tick(game.config.prepSeconds);}};
}
function advance(game:GameEngine,phase:Phase,chapter?:number){
  for(let i=0;i<40;i++){
    if(game.phase===phase&&(chapter===undefined||game.chapter===chapter))return;
    if(game.phase==='RESULT'||game.phase==='LOBBY')throw new Error(`Cannot reach ${phase}`);
    game.tick(game.remaining);
  }
  throw new Error('Phase loop');
}
function place(p:NonNullable<ReturnType<GameEngine['players']['get']>>,o:{x:number;y:number}){p.x=o.x;p.y=o.y;p.moveX=p.moveY=0;}
type EnginePlayer = NonNullable<ReturnType<GameEngine['players']['get']>>;
// Navigate along authored corridors with the same normalized commands as a client.
function walk(game:GameEngine,player:EnginePlayer,target:{x:number;y:number},companions:EnginePlayer[]=[player]) {
  const nodes=game.layout.nodes,nearest=(point:{x:number;y:number})=>nodes.reduce((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)<Math.hypot(b.x-point.x,b.y-point.y)?a:b);
  const start=nearest(player),goal=nearest(target),parents=new Map<string,string>(),seen=new Set([start.id]),queue=[start.id];
  while(queue.length&&!seen.has(goal.id)){const id=queue.shift()!;for(const [a,b]of game.layout.edges){const next=a===id?b:b===id?a:null;if(next&&!seen.has(next)){seen.add(next);parents.set(next,id);queue.push(next);}}}
  const route=[goal.id];while(route[0]!==start.id)route.unshift(parents.get(route[0]!)!);
  const waypoints=[...route.map(id=>nodes.find(n=>n.id===id)!),approachPoint(goal,target)];
  for(const point of waypoints){for(let ticks=0;ticks<5000;ticks++){
    if(companions.every(p=>Math.hypot(point.x-p.x,point.y-p.y)<4))break;
    expect(['EXPLORE','EXTRACT']).toContain(game.phase);
    for(const p of companions){const dx=point.x-p.x,dy=point.y-p.y,length=Math.hypot(dx,dy);expect(p.down||p.sealed).toBe(false);
      expect(game.command(p.id,{type:'move',x:length<4?0:dx/length,y:length<4?0:dy/length,seq:p.seq+1})).toBe(true);}
    game.tick(.05);
    if(ticks===4999)throw new Error('Movement stuck');
  }}
  for(const p of companions)expect(game.command(p.id,{type:'move',x:0,y:0,seq:p.seq+1})).toBe(true);
}
function perform(game:GameEngine,player:EnginePlayer,targetId:string) {
  const target=game.objects.find(o=>o.id===targetId)??game.players.get(targetId);expect(target).toBeDefined();walk(game,player,target!);
  expect(game.command(player.id,{type:'interact',targetId})).toBe(true);
  const seconds=player.interaction?.duration??0;game.tick(seconds+.05);expect(player.interaction).toBeNull();
}
function councilSeal(game:GameEngine,target:EnginePlayer,chapter:number) {
  advance(game,'VOTE',chapter);
  for(const player of game.players.values())if(!player.sealed||player.ghostVote)expect(game.command(player.id,{type:'vote',targetId:target.id})).toBe(true);
  game.tick(game.remaining);expect(target.sealed).toBe(true);expect(game.result).toBeNull();
}
function commandExpedition(n:number,wrongSeal:boolean) {
  const setup=room(n,25+n);setup.start();const game=setup.game;
  if(wrongSeal){const human=[...game.players.values()].find(p=>p.faction==='human')!;councilSeal(game,human,2);advance(game,'EXPLORE',3);}
  else advance(game,'EXPLORE',2);
  const humans=[...game.players.values()].filter(p=>p.faction==='human'&&!p.sealed),carrier=humans[0]!;
  const defeatGuardian=()=>{
    const guardian=game.objects.find(o=>o.id==='guardian')!;expect(guardian.active).toBe(true);
    walk(game,carrier,guardian,humans);
    for(let volley=0;guardian.active&&volley<40;volley++){
      for(const human of humans)if(guardian.active&&!human.down){const dx=guardian.x-human.x,dy=guardian.y-human.y,length=Math.hypot(dx,dy);game.command(human.id,{type:'move',x:dx/length,y:dy/length,seq:human.seq+1});game.command(human.id,{type:'move',x:0,y:0,seq:human.seq+1});expect(game.command(human.id,{type:'attack',targetId:guardian.id})).toBe(true);}
      game.tick(.75);
    }
    expect(game.eliteDefeated).toBe(true);expect(carrier.down).toBe(false);
  };
  if(wrongSeal&&game.chapter===game.config.chapters)defeatGuardian();
  const ensureFunds=()=>{while(game.sharedResources+carrier.resources<2){const resource=game.objects.find(o=>o.kind==='resource'&&o.active&&(o.amount??0)>0);expect(resource).toBeDefined();perform(game,carrier,resource!.id);}};
  for(const beacon of game.objects.filter(o=>o.kind==='beacon')){ensureFunds();perform(game,carrier,beacon.id);}
  expect(game.beaconsLit).toBe(game.config.beacons);ensureFunds();perform(game,carrier,'core');perform(game,carrier,'purify');
  expect(game.corePurified).toBe(true);expect(carrier.carryingCore).toBe(true);
  // No public skill or wolf contribution is necessary to finish the common objectives.
  advance(game,'EXPLORE',game.config.chapters);if(!game.eliteDefeated)defeatGuardian();advance(game,'EXTRACT');
  const exit=game.objects.find(o=>o.id==='exit')!;walk(game,carrier,exit);game.tick(game.remaining);
  expect(game.result?.winner).toBe('human');expect(game.result?.reason).toContain('护送');expect(game.moon).toBe(0);
}
function professionRoom(profession:Profession,faction:Faction,form=0){
  for(let seed=1;seed<=100;seed++){
    const setup=room(10,seed),actor=[...setup.game.players.values()].find(p=>p.profession===profession)!;
    expect(setup.game.command(actor.id,{type:'choose',profession,form})).toBe(true);setup.start();
    if(actor.faction===faction)return {...setup,actor};
  }
  throw new Error('No seeded profession/faction scenario');
}
function finalScenario() {
  const setup=room();setup.start();const game=setup.game;
  advance(game,'EXTRACT');game.remaining=8;game.corePurified=true;game.beaconsLit=game.config.beacons;game.eliteDefeated=true;game.objects.find(o=>o.id==='guardian')!.active=false;game.moon=0;
  const exit=game.objects.find(o=>o.id==='exit')!;const core=game.objects.find(o=>o.id==='core')!;core.active=true;core.x=exit.x;core.y=exit.y;
  state(game).coreHolder=null;game.holdProgress=0;state(game).escortHold.clear();
  for(const p of game.players.values()){p.carryingCore=false;p.down=false;p.hp=100;place(p,{x:500,y:350});}
  return {...setup,exit,humans:[...game.players.values()].filter(p=>p.faction==='human'),wolf:[...game.players.values()].find(p=>p.faction==='wolf')!};
}

describe('versioned configurations and fixed two-loop maps',()=>{
  it('uses E5 for four players and rejects unsupported counts',()=>{
    expect(getConfig(4).moonLimit).toBe(5);
    for(const n of [3,11,4.5,NaN])expect(()=>getConfig(n)).toThrow();
  });
  for(let n=4;n<=10;n++)it(`${n} players: all three layouts connect and conserve chapter supply`,()=>{
    const config=getConfig(n);
    expect(config.professions).toHaveLength(n);
    for(const seed of [0,1,2]){
      const map=getLayout(config,seed);expect(map.variant).toBe(seed);expect(map.nodes).toHaveLength(config.mapNodes);
      const seen=new Set([map.nodes[0]!.id]);
      for(let pass=0;pass<map.nodes.length;pass++)for(const [a,b]of map.edges){if(seen.has(a))seen.add(b);if(seen.has(b))seen.add(a);}
      expect(seen.size).toBe(map.nodes.length);expect(map.edges.length-map.nodes.length+1).toBe(2);
      expect(new Set(map.objects.map(o=>o.id)).size).toBe(map.objects.length);
      const supply=map.objects.filter(o=>o.guaranteed);
      expect(supply.reduce((sum,o)=>sum+(o.amount??0),0)).toBe(config.guaranteedSupply);
      if(n===4)for(let chapter=1;chapter<=3;chapter++)expect(supply.filter(o=>o.chapter===chapter).reduce((sum,o)=>sum+(o.amount??0),0)).toBe(4);
      expect(map.objects.filter(o=>o.kind==='altar'&&o.active)).toHaveLength(config.darkAltars);
    }
  });
});

describe('authority, faction assignment and clocks',()=>{
  it('confirms actual local hit/block/hurt effects without sharing another player feedback or hidden attacker identity',()=>{
    const setup=room();setup.start();const g=setup.game,wolf=[...g.players.values()].find(p=>p.faction==='wolf')!,victim=[...g.players.values()].find(p=>p.faction==='human')!,remote=[...g.players.values()].find(p=>p.id!==wolf.id&&p.id!==victim.id)!;
    place(wolf,{x:500,y:350});place(victim,wolf);place(remote,g.layout.nodes[1]!);victim.shield=15;victim.shieldUntil=state(g).playElapsed+5;
    expect(g.command(wolf.id,{type:'attack',targetId:remote.id})).toBe(false);expect(g.viewFor(wolf.id).self.feedback).toHaveLength(0);
    expect(g.command(wolf.id,{type:'transform'})).toBe(true);expect(g.command(wolf.id,{type:'attack',targetId:victim.id})).toBe(true);
    expect(g.viewFor(wolf.id).self.feedback?.at(-1)).toMatchObject({kind:'hit',targetId:victim.id,x:victim.x,y:victim.y});
    const effects=g.viewFor(victim.id).self.feedback!;expect(effects.map(e=>e.kind)).toEqual(['block','hurt']);expect(effects.map(e=>e.id)).toEqual([1,2]);expect(effects.every(e=>!e.targetId&&e.x===victim.x&&e.y===victim.y&&e.power>=0&&e.power<=1)).toBe(true);
    expect(g.viewFor(remote.id).self.feedback).toHaveLength(0);effects[0]!.power=999;expect(g.viewFor(victim.id).self.feedback![0]!.power).toBeLessThanOrEqual(1);
  });
  it('confirms pickup and collision from the authoritative result, with bounded and throttled feedback',()=>{
    const setup=room();setup.start();const g=setup.game,p=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;
    place(p,resource);g.command(p.id,{type:'interact',targetId:resource.id});g.tick(1.3);expect(g.viewFor(p.id).self.feedback?.at(-1)?.kind).toBe('pickup');
    place(p,{x:580,y:350});g.command(p.id,{type:'move',x:1,y:0,seq:1});g.tick(2);
    const collisions=g.viewFor(p.id).self.feedback!.filter(e=>e.kind==='collision');expect(collisions.length).toBeGreaterThan(0);expect(collisions.length).toBeLessThanOrEqual(4);
    for(let i=1;i<collisions.length;i++)expect(collisions[i]!.at-collisions[i-1]!.at).toBeGreaterThanOrEqual(.49);
    g.tick(10);expect(g.viewFor(p.id).self.feedback).toHaveLength(16);
  });
  it('retains a dropped lobby seat for reconnect, then releases it at 60 seconds without invalidating a match',()=>{
    const setup=room(),g=setup.game;g.command('p0',{type:'ready',ready:true});g.disconnect('p0');expect(g.players.has('p0')).toBe(true);expect(g.players.get('p0')?.connected).toBe(false);
    setup.setTime(59_999);g.reconnect('p0');expect(g.players.get('p0')?.ready).toBe(true);expect(g.players.get('p0')?.connected).toBe(true);
    g.disconnect('p0');setup.setTime(119_999);g.tick(.05);expect(g.players.has('p0')).toBe(false);expect(g.phase).toBe('LOBBY');expect(g.result).toBeNull();
    g.addPlayer({id:'replacement',name:'新同行者'});expect(g.players.get('replacement')?.slot).toBe(0);expect(g.removePlayer('replacement')).toBe(true);expect(g.players.has('replacement')).toBe(false);
  });
  for(let n=4;n<=10;n++)it(`${n} players: assignment is seeded, exact and private; complete phase clock`,()=>{
    const first=room(n,55),second=room(n,55);
    expect(first.game.viewFor('p0').self.faction).toBeNull();
    first.start();second.start();
    const factions=[...first.game.players.values()].map(p=>p.faction);
    expect(factions).toEqual([...second.game.players.values()].map(p=>p.faction));expect(factions.filter(f=>f==='wolf')).toHaveLength(getConfig(n).wolves);
    for(const p of first.game.players.values()){
      const view=first.game.viewFor(p.id);expect(view.players.every(other=>!('faction' in other))).toBe(true);
      expect(view.self.wolfAllies).toHaveLength(p.faction==='wolf'?getConfig(n).wolves:0);
      expect(first.game.command(p.id,{type:'choose',profession:p.profession,form:0})).toBe(false);
    }
    const c=first.game.config,total=c.prepSeconds+c.chapters*(c.exploreSeconds+c.discussionSeconds+c.voteSeconds+c.draftSeconds)+c.extractionSeconds;
    first.game.tick(total-c.prepSeconds-.1);expect(first.game.phase).toBe('EXTRACT');first.game.tick(.1);
    expect(first.game.phase).toBe('RESULT');expect(first.game.elapsed).toBeCloseTo(total,5);expect(first.game.result?.winner).toBe('wolf');
    if(n===4)expect(total).toBe(870);
  });
  it('changes the wolf seat across seeds while keeping profession independent',()=>{
    const positions=new Set<number>();
    for(let seed=10;seed<90;seed++){const setup=room(4,seed);setup.start();positions.add([...setup.game.players.values()].find(p=>p.faction==='wolf')!.slot);}
    expect(positions.size).toBe(4);
  });
  it('persists the initial map seed through random draws and settlement without publishing it in a live view',()=>{
    const callback=vi.fn(),setup=room(10,55,callback);expect(setup.game.mapSeed).toBe(55);setup.start();advance(setup.game,'EXTRACT');setup.game.tick(setup.game.remaining);
    expect(callback.mock.calls[0]![0].mapSeed).toBe(55);expect(setup.game.mapSeed).toBe(55);expect('mapSeed' in setup.game.viewFor('p0')).toBe(false);
  });
  it('rejects spectators, nonfinite input, stale sequence and remote interactions',()=>{
    const setup=room();setup.start();const game=setup.game,p=game.players.get('p0')!;
    expect(game.command('outsider',{type:'move',x:1,y:0,seq:1})).toBe(false);expect(()=>game.viewFor('outsider')).toThrow();
    for(const [x,y]of [[NaN,0],[Infinity,1],[100000,0],[0,-10]])expect(game.command(p.id,{type:'move',x,y,seq:1})).toBe(false);
    expect(game.command(p.id,{type:'dodge',x:NaN,y:0})).toBe(false);
    expect(game.command(p.id,{type:'move',x:1,y:1,seq:1})).toBe(true);const origin={x:p.x,y:p.y};game.tick(.05);
    expect(game.viewFor(p.id).self.inputSeq).toBe(1);expect(Math.hypot(p.x-origin.x,p.y-origin.y)).toBeLessThanOrEqual(RULES.moveSpeed*.05+.001);
    expect(game.command(p.id,{type:'move',x:-1,y:0,seq:1})).toBe(false);
    const resource=game.objects.find(o=>o.kind==='resource'&&o.active)!;expect(game.command(p.id,{type:'interact',targetId:resource.id})).toBe(false);
    expect(game.command(p.id,{type:'ready',ready:'yes'} as unknown as GameCommand)).toBe(false);
  });
  it('freezes shield, month transformation, down and skill timers throughout council and draft',()=>{
    const setup=room();setup.start();const g=setup.game,w=[...g.players.values()].find(p=>p.faction==='wolf')!,ward=g.players.get('p0')!,victim=g.players.get('p1')!;
    g.remaining=.05;expect(g.command(w.id,{type:'transform'})).toBe(true);expect(g.command(ward.id,{type:'skill',targetId:ward.id})).toBe(true);
    state(g).damage(victim,300);g.tick(.05);const clock=state(g).playElapsed,cooldown=g.viewFor(ward.id).self.skillCooldown;
    g.tick(g.config.discussionSeconds+g.config.voteSeconds+g.config.draftSeconds);
    expect(g.phase).toBe('EXPLORE');expect(state(g).playElapsed).toBeCloseTo(clock);expect(g.viewFor(ward.id).self.skillCooldown).toBeCloseTo(cooldown);
    expect(victim.down).toBe(true);expect(ward.shield).toBeGreaterThan(0);expect(w.transformUntil).toBeGreaterThan(state(g).playElapsed);
  });
});

describe('resource accounting, inventory and transactions',()=>{
  it('recovers carried, dropped and untouched current supply once, without releasing future chapters',()=>{
    const setup=room();setup.start();const g=setup.game,p=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;
    place(p,resource);expect(g.command(p.id,{type:'interact',targetId:resource.id})).toBe(true);g.tick(1.3);expect(p.resources).toBe(2);
    expect(g.command(p.id,{type:'drop',itemId:'resources'})).toBe(true);expect(g.command(p.id,{type:'drop',itemId:'resources'})).toBe(false);
    g.remaining=.05;g.tick(.05);expect(g.sharedResources).toBe(4);
    expect(g.objects.filter(o=>o.guaranteed&&o.chapter===2&&o.active)).toHaveLength(0);
    advance(g,'EXPLORE',2);expect(g.objects.filter(o=>o.kind==='resource'&&o.active).reduce((a,o)=>a+(o.amount??0),0)).toBe(4);
    expect(g.objects.filter(o=>o.guaranteed&&o.chapter===1&&o.active)).toHaveLength(0);
    advance(g,'DISCUSS',2);expect(g.sharedResources).toBe(8);advance(g,'DISCUSS',3);expect(g.sharedResources).toBe(12);
  });
  it('consumed supply does not reappear at chapter boundaries',()=>{
    const setup=room();setup.start();const g=setup.game,p=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;
    place(p,resource);g.command(p.id,{type:'interact',targetId:resource.id});g.tick(1.3);
    const beacon=g.objects.find(o=>o.kind==='beacon')!;place(p,beacon);g.command(p.id,{type:'interact',targetId:beacon.id});g.tick(4.1);expect(g.beaconsLit).toBe(1);
    advance(g,'DISCUSS',1);expect(g.sharedResources).toBe(2);advance(g,'EXPLORE',2);expect(resource.active).toBe(false);expect(resource.amount).toBe(0);
  });
  it('segmented excavation has distinct item instances; repeated drop/pickup preserves one instance',()=>{
    const setup=room(),g=setup.game,scavenger=g.players.get('p2')!;g.command(scavenger.id,{type:'choose',profession:'scavenger',form:1});setup.start();
    const chest=g.objects.find(o=>o.id==='chest-1')!;place(scavenger,chest);
    expect(g.command(scavenger.id,{type:'skill',targetId:chest.id})).toBe(true);g.tick(2.1);expect(scavenger.loot).toHaveLength(1);expect(chest.active).toBe(true);
    expect(g.command(scavenger.id,{type:'skill',targetId:chest.id})).toBe(true);g.tick(2.1);expect(scavenger.loot).toHaveLength(2);expect(new Set(scavenger.loot.map(i=>i.id)).size).toBe(2);
    expect(g.command(scavenger.id,{type:'skill',targetId:chest.id})).toBe(false);
    const item=scavenger.loot[0]!,recipient=g.players.get('p1')!;place(recipient,scavenger);
    for(let loop=0;loop<2;loop++){
      const holder=loop===0?scavenger:recipient;expect(g.command(holder.id,{type:'drop',itemId:item.id})).toBe(true);
      expect(g.command(recipient.id,{type:'interact',targetId:item.id})).toBe(true);g.tick(4.1);
      expect(recipient.loot.filter(i=>i.id===item.id)).toHaveLength(1);expect(g.objects.filter(o=>o.id===item.id)).toHaveLength(1);
    }
    expect(scavenger.loot.some(i=>i.id===item.id)).toBe(false);
  });
  it('counts equipment, supplies and resource stacks in the same four slots',()=>{
    const setup=room();setup.start();const g=setup.game,p=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;
    p.loot=[0,1,2].map(i=>({id:`item${i}`,contentId:'treasure',name:'珍藏',value:1}));p.supplies=1;place(p,resource);
    expect(g.command(p.id,{type:'interact',targetId:resource.id})).toBe(false);
    p.supplies=0;expect(g.command(p.id,{type:'interact',targetId:resource.id})).toBe(true);g.tick(1.3);expect(p.resources).toBe(2);
    expect(g.command(p.id,{type:'interact',targetId:resource.id})).toBe(false);
  });
  it('requires bilateral trade; escrow locks an item and transfers once after confirmation',()=>{
    const setup=room(),g=setup.game,from=g.players.get('p3')!,to=g.players.get('p0')!;
    g.command(from.id,{type:'choose',profession:'broker',form:1});setup.start();place(to,from);from.loot=[{id:'owned',contentId:'treasure',name:'珍藏',value:4}];
    expect(g.command(to.id,{type:'accept',from:from.id,itemId:'owned'})).toBe(false);
    expect(g.command(from.id,{type:'offer',to:to.id,itemId:'owned'})).toBe(true);expect(g.viewFor(to.id).self.offers?.[0]?.itemId).toBe('owned');
    expect(g.command(to.id,{type:'accept',from:from.id,itemId:'owned'})).toBe(true);expect(to.loot).toHaveLength(0);
    expect(g.command(from.id,{type:'drop',itemId:'owned'})).toBe(false);g.tick(3.1);
    expect(from.loot).toHaveLength(0);expect(to.loot.map(i=>i.id)).toEqual(['owned']);expect(g.command(to.id,{type:'accept',from:from.id,itemId:'owned'})).toBe(false);
  });
});

describe('wolf team budgets, interruptions and removal limits',()=>{
  for(let n=6;n<=10;n++)it(`${n} players: all finishers share one chapter charge and preserve council seal capacity`,()=>{
    const setup=room(n);setup.start();const g=setup.game,wolves=[...g.players.values()].filter(p=>p.faction==='wolf');
    for(let charge=0;charge<g.config.wolfFinisherGameCap;charge++){
      advance(g,'EXPLORE',charge+2);const victim=[...g.players.values()].find(p=>p.faction==='human'&&!p.sealed)!;
      state(g).damage(victim,150);for(const wolf of wolves){place(wolf,victim);expect(g.command(wolf.id,{type:'transform'})).toBe(true);}
      expect(g.command(wolves[0]!.id,{type:'finish',targetId:victim.id})).toBe(true);g.tick(3.05);expect(victim.sealed).toBe(true);
      const other=[...g.players.values()].find(p=>p.faction==='human'&&!p.sealed)!;state(g).damage(other,150);place(wolves[1]!,other);
      expect(g.command(wolves[1]!.id,{type:'finish',targetId:other.id})).toBe(false);expect(state(g).wolfBudget).toBe(g.config.shadowBudget-2);
    }
    expect(g.removalCount).toBe(g.config.wolfFinisherGameCap);expect(g.config.permanentRemovalCap-g.removalCount).toBeGreaterThanOrEqual(g.config.wolves);
  });
  it('shares budget and corruption cooldown across mutually aware wolves',()=>{
    const setup=room(6);setup.start();const g=setup.game,wolves=[...g.players.values()].filter(p=>p.faction==='wolf'),altars=g.objects.filter(o=>o.kind==='altar');
    place(wolves[0]!,altars[0]!);place(wolves[1]!,altars[1]!);
    expect(g.command(wolves[0]!.id,{type:'corrupt',targetId:altars[0]!.id})).toBe(true);expect(g.command(wolves[1]!.id,{type:'corrupt',targetId:altars[1]!.id})).toBe(true);g.tick(4.1);
    expect(g.moon).toBe(1);for(const w of wolves)expect(g.viewFor(w.id).self.wolfBudget).toBe(1);
    expect(g.command(wolves[1]!.id,{type:'corrupt',targetId:altars[1]!.id})).toBe(false);g.tick(20);
    expect(g.command(wolves[1]!.id,{type:'corrupt',targetId:altars[1]!.id})).toBe(true);g.tick(4.1);expect(g.moon).toBe(2);expect(state(g).wolfBudget).toBe(0);
    expect(g.command(wolves[0]!.id,{type:'fog',x:wolves[0]!.x,y:wolves[0]!.y})).toBe(false);
  });
  it('interrupted corruption spends nothing and enforces the retry delay',()=>{
    const setup=room();setup.start();const g=setup.game,w=[...g.players.values()].find(p=>p.faction==='wolf')!,h=[...g.players.values()].find(p=>p.faction==='human')!,altar=g.objects.find(o=>o.kind==='altar')!;
    place(w,altar);place(h,w);g.command(w.id,{type:'corrupt',targetId:altar.id});g.tick(1);
    expect(g.command(h.id,{type:'attack',targetId:w.id})).toBe(true);expect(w.interaction).toBeNull();expect(state(g).wolfBudget).toBe(2);expect(g.moon).toBe(0);
    expect(g.command(w.id,{type:'corrupt',targetId:altar.id})).toBe(false);g.tick(10.1);expect(g.command(w.id,{type:'corrupt',targetId:altar.id})).toBe(true);
  });
  it('prohibits micro finishers and applies the shared global limit to larger rooms',()=>{
    for(const n of [4,5,6]){
      const setup=room(n);setup.start();const g=setup.game;advance(g,'EXPLORE',2);const w=[...g.players.values()].find(p=>p.faction==='wolf')!,h=[...g.players.values()].find(p=>p.faction==='human')!;
      place(w,h);state(g).damage(h,500);expect(g.command(w.id,{type:'transform'})).toBe(true);
      expect(g.command(w.id,{type:'finish',targetId:h.id})).toBe(n===6);
      if(n===6){g.tick(3.1);expect(h.sealed).toBe(true);expect(g.removalCount).toBe(1);expect(state(g).wolfBudget).toBe(0);advance(g,'EXPLORE',3);const other=[...g.players.values()].find(p=>p.faction==='human'&&!p.sealed)!;place(w,other);state(g).damage(other,500);w.transformUntil=state(g).playElapsed+8;expect(g.command(w.id,{type:'finish',targetId:other.id})).toBe(false);}
    }
  });
});

describe('council and secret information',()=>{
  it('uses opaque evidence, message, drop and ward IDs without hiding provenance from the verifier',()=>{
    const setup=room();setup.start();const g=setup.game,actor=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;
    place(actor,resource);g.command(actor.id,{type:'interact',targetId:resource.id});g.tick(1.3);expect(g.command(actor.id,{type:'drop',itemId:'resources'})).toBe(true);
    const drop=g.viewFor(actor.id).objects.find(o=>o.name==='掉落的工程亡絮')!;expect(drop.id).toMatch(/^[\da-f-]{36}$/);expect(drop.id).not.toContain(actor.id);
    expect(actor.evidence.every(e=>/^[\da-f-]{36}$/.test(e.id))).toBe(true);
    advance(g,'DISCUSS',1);expect(g.command(actor.id,{type:'say',text:'公开陈述'})).toBe(true);expect(g.viewFor(actor.id).messages.at(-1)?.id).toMatch(/^[\da-f-]{36}$/);
    const second=room(),ward=second.game.players.get('p0')!;second.game.command(ward.id,{type:'choose',profession:'warden',form:1});second.start();second.game.command(ward.id,{type:'skill'});
    const view=second.game.viewFor('p1'),area=view.objects.find(o=>o.name==='定点薄盾')!;expect(area.id).toMatch(/^[\da-f-]{36}$/);expect(area.id).not.toContain(ward.id);expect('owner' in area).toBe(false);
    expect(second.game.viewFor('p2').objects.find(o=>o.name==='定点薄盾')?.id).toBe(area.id);
  });
  it('publishes only device state remotely; witness identity stays private until its owner publishes',()=>{
    const setup=room();setup.start();const g=setup.game,actor=g.players.get('p0')!,remote=g.players.get('p3')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!,beacon=g.objects.find(o=>o.kind==='beacon')!;
    place(actor,resource);g.command(actor.id,{type:'interact',targetId:resource.id});g.tick(1.3);place(actor,beacon);g.command(actor.id,{type:'interact',targetId:beacon.id});g.tick(4.05);
    const global=g.viewFor(remote.id).evidence.find(e=>e.text.includes('已点亮'))!;expect(global.author).toBeUndefined();expect(global.text).not.toContain(actor.name);
    const proof=actor.evidence.find(e=>e.text.includes('已由'))!;expect(proof.author).toBe(actor.id);
    const copy=g.viewFor(actor.id);copy.self.evidence[0]!.text='tampered';copy.config.professions[0]='medic';copy.players[0]!.hp=999;
    expect(g.viewFor(actor.id).self.evidence[0]!.text).not.toBe('tampered');expect(g.config.professions[0]).toBe('warden');expect(actor.hp).toBe(100);
  });
  it('requires strict majority, permits first-chapter monitoring only, and consumes one ghost vote',()=>{
    const setup=room();setup.start();const g=setup.game;advance(g,'VOTE',1);
    g.command('p0',{type:'vote',targetId:'p3'});g.command('p1',{type:'vote',targetId:'p3'});g.tick(g.remaining);expect(g.removalCount).toBe(0);
    advance(g,'VOTE',2);for(const id of ['p0','p1','p2'])expect(g.command(id,{type:'vote',targetId:'p3'})).toBe(true);g.tick(g.remaining);
    expect(g.players.get('p3')!.sealed).toBe(true);expect(g.result).toBeNull();expect(g.viewFor('p3').players.every(p=>p.x===null&&p.y===null)).toBe(true);
    advance(g,'VOTE',3);expect(g.viewFor('p3').eligibleVoters).toBe(4);expect(g.command('p3',{type:'vote',targetId:null})).toBe(true);expect(g.command('p3',{type:'vote',targetId:'p0'})).toBe(false);
    expect(g.viewFor('p3').self.ghostVote).toBe(false);expect(g.viewFor('p0').eligibleVoters).toBe(4);
    for(const id of ['p0','p1','p2'])g.command(id,{type:'vote',targetId:'p0'});g.tick(g.remaining);expect(g.removalCount).toBe(1);expect(g.players.get('p0')!.sealed).toBe(false);
  });
  it('first-chapter three votes monitor without revealing faction or removing a player',()=>{
    const setup=room();setup.start();const g=setup.game;advance(g,'VOTE',1);for(const id of ['p0','p1','p2'])g.command(id,{type:'vote',targetId:'p3'});g.tick(g.remaining);
    expect(g.removalCount).toBe(0);expect(g.players.get('p3')!.sealed).toBe(false);expect(g.result).toBeNull();expect(g.viewFor('p0').evidence.some(e=>e.text.includes('有限监视'))).toBe(true);
  });
  it('scout reports stay regional and never copy an unseen actor name',()=>{
    const setup=room();setup.start();const g=setup.game,scout=g.players.get('p1')!,actor=g.players.get('p3')!,altar=g.objects.find(o=>o.kind==='altar')!;
    actor.faction='wolf';place(actor,altar);g.command(actor.id,{type:'corrupt',targetId:altar.id});g.tick(4.1);
    place(scout,{x:500,y:350});expect(g.command(scout.id,{type:'skill'})).toBe(true);
    const own=g.viewFor(scout.id).self.evidence;expect(own.some(e=>e.text.includes(actor.name))).toBe(false);expect(own.some(e=>e.text.includes('祭坛'))).toBe(false);
    expect(g.viewFor(scout.id).players.find(p=>p.id===actor.id)?.x).toBeNull();
  });
  it('only permits publishing owned evidence and gives sealed players no new observation or wolf budget',()=>{
    const setup=room(6);setup.start();const g=setup.game;advance(g,'EXPLORE',2);const w=[...g.players.values()].find(p=>p.faction==='wolf')!;state(g).seal(w);
    const snapshot=g.viewFor(w.id).self.evidence.length;
    const other=[...g.players.values()].find(p=>p.faction==='wolf'&&!p.sealed)!,altar=g.objects.find(o=>o.kind==='altar')!;place(other,altar);g.command(other.id,{type:'corrupt',targetId:altar.id});g.tick(4.1);
    expect(g.viewFor(w.id).self.evidence).toHaveLength(snapshot);expect(g.viewFor(w.id).self.wolfBudget).toBe(0);expect(g.viewFor(w.id).self.wolfAllies).toEqual([]);
    advance(g,'DISCUSS',2);expect(g.command(w.id,{type:'publish',evidenceId:'not-owned'})).toBe(false);expect(g.viewFor(w.id).players.every(p=>p.x===null)).toBe(true);
  });
});

describe('terminal escort, rewards and reconnect boundaries',()=>{
  it('consented departure after settlement releases that slot for the next lobby',()=>{
    const setup=room();setup.start();const g=setup.game;advance(g,'EXTRACT');g.tick(g.remaining);expect(g.removePlayer('p3')).toBe(true);
    expect(g.command('p0',{type:'restart'})).toBe(true);expect(g.players.size).toBe(3);expect(g.phase).toBe('LOBBY');g.addPlayer({id:'new','name':'新同行者'});expect(g.players.get('new')?.slot).toBe(3);
  });
  it('reset retains a dropped player connection state and frees only its expired reservation',()=>{
    const setup=room(),g=setup.game;g.command('p1',{type:'choose',profession:'scout',form:1});setup.start();advance(g,'EXTRACT');g.tick(g.remaining);g.disconnect('p1');
    setup.setTime(59_999);expect(g.command('p0',{type:'restart'})).toBe(true);expect(g.players.get('p1')).toMatchObject({connected:false,disconnectedAt:0,profession:'scout',form:1,slot:1});
    expect(g.command('p1',{type:'ready',ready:true})).toBe(false);setup.setTime(60_000);g.tick(.05);expect(g.players.has('p1')).toBe(false);expect(g.phase).toBe('LOBBY');expect(g.result).toBeNull();
    g.addPlayer({id:'new',name:'新同行者'});expect(g.players.get('new')?.slot).toBe(1);
  });
  it('requires the same human for eight seconds; relaying two humans cannot win',()=>{
    const {game:g,exit,humans}=finalScenario();place(humans[0]!,exit);g.tick(4);place(humans[0]!,{x:500,y:350});place(humans[1]!,exit);g.tick(4);
    expect(g.holdProgress).toBeCloseTo(8);expect(g.result?.winner).toBe('wolf');
  });
  it('a continuous human escort wins; public progress does not reveal wolf-only presence',()=>{
    const first=finalScenario();place(first.humans[0]!,first.exit);first.game.tick(4);
    const second=finalScenario();place(second.wolf,second.exit);second.game.tick(4);
    expect(second.game.viewFor(second.wolf.id).holdProgress).toBeCloseTo(first.game.viewFor(first.humans[0]!.id).holdProgress);
    first.game.tick(4);second.game.tick(4);expect(first.game.result?.winner).toBe('human');expect(second.game.result?.winner).toBe('wolf');
  });
  it('processes completing corruption before the final winner check',()=>{
    const {game:g,exit,humans,wolf}=finalScenario();place(humans[0]!,exit);g.moon=4;g.tick(4);
    const altar=g.objects.find(o=>o.id==='altar-extract-0')!;place(wolf,altar);expect(g.command(wolf.id,{type:'corrupt',targetId:altar.id})).toBe(true);g.tick(4);
    expect(g.moon).toBe(5);expect(g.holdProgress).toBeCloseTo(8);expect(g.result?.winner).toBe('wolf');
  });
  it('does not reveal all-wolf sealing or settle before the fixed final moment',()=>{
    const setup=room(),g=setup.game;setup.start();advance(g,'EXPLORE',2);const wolf=[...g.players.values()].find(p=>p.faction==='wolf')!;state(g).seal(wolf);
    expect(g.result).toBeNull();expect(g.viewFor('p0').evidence.some(e=>e.text.includes('全部蚀月'))).toBe(false);advance(g,'EXTRACT');g.tick(g.remaining);expect(g.result?.winner).toBe('human');
  });
  it('uses real 60-second disconnect time and repeated disconnect does not extend it',()=>{
    const setup=room();setup.start();setup.game.disconnect('p0');setup.setTime(30_000);setup.game.disconnect('p0');setup.game.tick(.05);expect(setup.game.result).toBeNull();
    setup.setTime(60_000);setup.game.tick(.05);expect(setup.game.result?.winner).toBe('invalid');expect(setup.game.result?.rewards.p0?.fragments).toBe(0);
  });
  it('accepts 59.999-second reconnect and delays only final settlement during a pending reconnect',()=>{
    const setup=finalScenario();place(setup.humans[0]!,setup.exit);setup.game.disconnect(setup.wolf.id);setup.game.tick(8);
    expect(setup.game.phase).toBe('RESULT');expect(setup.game.result).toBeNull();expect(setup.game.command('p0',{type:'restart'})).toBe(false);
    setup.setTime(59_999);setup.game.reconnect(setup.wolf.id);expect(setup.game.result?.winner).toBe('human');expect(setup.game.remaining).toBe(0);
  });
  it('pending final outcome turns invalid at 60 seconds without leaking its private reason',()=>{
    const setup=room();setup.start();const g=setup.game;advance(g,'EXPLORE',2);const w=[...g.players.values()].find(p=>p.faction==='wolf')!;state(g).seal(w);advance(g,'EXTRACT');g.disconnect('p0');g.tick(g.remaining);
    expect(g.result).toBeNull();expect(g.viewFor('p1').evidence.some(e=>e.text.includes('全部蚀月'))).toBe(false);setup.setTime(60_000);g.tick(.05);expect(g.result?.winner).toBe('invalid');
  });
  it('delivers each settlement once and uses a different match key after restart',()=>{
    const callback=vi.fn(),setup=room(4,12,callback);setup.start();const g=setup.game;advance(g,'EXTRACT');g.tick(g.remaining);g.tick(10);g.invalidate('late');expect(callback).toHaveBeenCalledTimes(1);
    const first=callback.mock.calls[0]![0] as Settlement;expect(first.winner).toBe('wolf');expect(g.result!.rewards[[...g.players.values()].find(p=>p.faction==='wolf')!.id]?.fragments).toBe(30);
    g.command('p0',{type:'restart'});setup.start();advance(g,'EXTRACT');g.tick(g.remaining);expect(callback).toHaveBeenCalledTimes(2);expect(callback.mock.calls[1]![0].matchId).not.toBe(first.matchId);
  });
  it('contains asynchronous persistence errors instead of rejecting the tick',async()=>{
    const failure=new Error('database unavailable'),setup=room(4,1,async()=>{throw failure;});setup.start();setup.game.invalidate('server stopped');await Promise.resolve();await Promise.resolve();expect(setup.game.settlementError).toBe(failure);expect(setup.game.result?.winner).toBe('invalid');
  });
});

describe('complete command routes for every supported room size',()=>{
  for(let n=4;n<=10;n++){
    it(`${n} players: common commands finish an expedition without any wolf or profession help`,()=>commandExpedition(n,false));
    it(`${n} players: a mistaken council seal leaves the common expedition reachable`,()=>commandExpedition(n,true));
    it(`${n} players: every wolf can be sealed through strict-majority councils, with outcome delayed`,()=>{
      const setup=room(n,25+n);setup.start();const game=setup.game,wolves=[...game.players.values()].filter(p=>p.faction==='wolf');
      wolves.forEach((wolf,i)=>councilSeal(game,wolf,i+2));expect(game.result).toBeNull();expect(game.viewFor('p0').evidence.some(e=>e.text.includes('全部蚀月'))).toBe(false);
      advance(game,'EXTRACT');game.tick(game.remaining);expect(game.result?.winner).toBe('human');expect(game.result?.reason).toContain('全部蚀月者');
    });
  }
});

describe('public profession tools function on either secret faction',()=>{
  for(const faction of ['human','wolf'] as Faction[]){
    it(`${faction} warden: thick shield follows its recipient and respects the recipient boon`,()=>{
      const {game:g,actor}=professionRoom('warden',faction),recipient=g.players.get('p1')!;recipient.boons=['guardian'];place(recipient,actor);
      expect(g.command(actor.id,{type:'skill',targetId:recipient.id})).toBe(true);expect(recipient.shield).toBeCloseTo(55*1.15);
      place(actor,g.layout.nodes[1]!);state(g).damage(recipient,30);expect(recipient.hp).toBe(100);expect(recipient.shield).toBeCloseTo(55*1.15-30);
      g.tick(5.1);expect(recipient.shield).toBe(0);
    });
    it(`${faction} warden: fixed thin shield grants once, without refilling each server tick`,()=>{
      const {game:g,actor}=professionRoom('warden',faction,1),recipient=g.players.get('p1')!;place(recipient,actor);
      expect(g.command(actor.id,{type:'skill'})).toBe(true);g.tick(.05);expect(recipient.shield).toBe(25);state(g).damage(recipient,10);g.tick(.2);expect(recipient.shield).toBe(15);
      place(recipient,g.layout.nodes[1]!);g.tick(.1);expect(recipient.shield).toBe(0);
    });
    for(const form of [0,1])it(`${faction} scout form ${form}: obtains a coarse local trace without an unseen identity`,()=>{
      const {game:g,actor}=professionRoom('scout',faction,form),wolf=[...g.players.values()].find(p=>p.faction==='wolf'&&p.id!==actor.id)!,altar=g.objects.find(o=>o.kind==='altar')!;
      place(wolf,altar);expect(g.command(wolf.id,{type:'corrupt',targetId:altar.id})).toBe(true);g.tick(4.1);place(actor,altar);
      expect(g.command(actor.id,{type:'skill'})).toBe(true);const traces=actor.evidence.filter(e=>e.source==='observation'&&e.text.includes('祭坛活动'));
      expect(traces.length).toBeGreaterThan(0);expect(traces.every(e=>!e.author&&!e.text.includes(wolf.name))).toBe(true);
    });
    for(const form of [0,1])it(`${faction} scavenger form ${form}: excavation differs in depth and duration`,()=>{
      const {game:g,actor}=professionRoom('scavenger',faction,form),chest=g.objects.find(o=>o.id==='chest-1')!;place(actor,chest);
      expect(g.command(actor.id,{type:'skill',targetId:chest.id})).toBe(true);g.tick(form===0?3.05:2.05);
      expect(actor.loot).toHaveLength(form===0?2:1);expect(chest.active).toBe(form===1);expect(new Set(actor.loot.map(item=>item.id)).size).toBe(actor.loot.length);
    });
    for(const form of [0,1])it(`${faction} broker form ${form}: skill creates an executable consensual transfer`,()=>{
      const {game:g,actor}=professionRoom('broker',faction,form),recipient=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;
      place(actor,resource);g.command(actor.id,{type:'interact',targetId:resource.id});g.tick(1.3);expect(actor.resources).toBe(2);place(recipient,actor);
      expect(g.command(actor.id,{type:'skill',targetId:recipient.id})).toBe(true);expect(g.viewFor(recipient.id).self.offers?.[0]?.itemId).toBe('resources');expect(recipient.resources).toBe(0);
      expect(g.command(recipient.id,{type:'accept',from:actor.id,itemId:'resources'})).toBe(true);
      if(form===1){expect(actor.resources).toBe(2);const beacon=g.objects.find(o=>o.kind==='beacon')!;place(actor,beacon);expect(g.command(actor.id,{type:'interact',targetId:beacon.id})).toBe(false);expect(g.command(actor.id,{type:'drop',itemId:'resources'})).toBe(false);g.tick(3.05);}
      expect(actor.resources).toBe(0);expect(recipient.resources).toBe(2);
    });
    it(`${faction} medic: quickly restores a downed body without changing alignment`,()=>{
      const {game:g,actor}=professionRoom('medic',faction),recipient=g.players.get('p0')!,original=recipient.faction;place(recipient,actor);state(g).damage(recipient,150);
      expect(g.command(actor.id,{type:'skill',targetId:recipient.id})).toBe(true);g.tick(1.95);expect(recipient.down).toBe(true);g.tick(.1);expect(recipient.down).toBe(false);expect(recipient.hp).toBe(50);expect(recipient.faction).toBe(original);
      expect(g.command(actor.id,{type:'skill',targetId:recipient.id})).toBe(false);
    });
    it(`${faction} engineer: accelerates another profession's common engineering channel`,()=>{
      const {game:g,actor}=professionRoom('engineer',faction);advance(g,'EXPLORE',2);const partner=g.players.get('p0')!,beacon=g.objects.find(o=>o.kind==='beacon')!;place(actor,beacon);place(partner,beacon);partner.boons=[];
      expect(g.command(actor.id,{type:'skill',targetId:beacon.id})).toBe(true);expect(g.command(partner.id,{type:'interact',targetId:beacon.id})).toBe(true);expect(partner.interaction?.duration).toBeCloseTo(3.4);
      g.tick(3.45);expect(beacon.progress).toBe(1);
    });
    it(`${faction} forensic: checks only owned or published provenance, without a faction oracle`,()=>{
      const {game:g,actor}=professionRoom('forensic',faction),other=g.players.get('p0')!,resource=g.objects.find(o=>o.kind==='resource'&&o.active)!;place(other,resource);g.command(other.id,{type:'interact',targetId:resource.id});g.tick(1.3);
      const privateEvidence=other.evidence.find(e=>e.text.includes('采集'))!;expect(actor.evidence.some(e=>e.id===privateEvidence.id)).toBe(false);expect(g.command(actor.id,{type:'skill',targetId:privateEvidence.id})).toBe(false);
      const publicEvidence=g.viewFor(actor.id).evidence[0]!;expect(g.command(actor.id,{type:'skill',targetId:publicEvidence.id})).toBe(true);expect(actor.evidence.at(-1)?.text).toContain('不证明阵营');
    });
    it(`${faction} bellkeeper: postpones actual guardian damage for four gameplay seconds`,()=>{
      const {game:g,actor}=professionRoom('bellkeeper',faction);advance(g,'EXPLORE',4);const recipient=g.players.get('p0')!,guardian=g.objects.find(o=>o.id==='guardian')!;place(recipient,guardian);recipient.hp=100;
      expect(g.command(actor.id,{type:'skill'})).toBe(true);g.tick(3.9);expect(recipient.hp).toBe(100);g.tick(.2);expect(recipient.hp).toBe(85);
    });
    it(`${faction} ranger: its route increases a nearby carrier's actual movement for a short period`,()=>{
      const {game:g,actor}=professionRoom('ranger',faction);advance(g,'EXPLORE',2);const carrier=g.players.get('p0')!,core=g.objects.find(o=>o.id==='core')!;place(carrier,core);g.command(carrier.id,{type:'interact',targetId:core.id});g.tick(2.05);expect(carrier.carryingCore).toBe(true);
      carrier.boons=[];place(carrier,{x:500,y:350});place(actor,carrier);const origin=carrier.x;g.command(carrier.id,{type:'move',x:1,y:0,seq:1});g.tick(.1);const ordinary=carrier.x-origin;
      expect(g.command(actor.id,{type:'skill'})).toBe(true);const marked=carrier.x;g.tick(.1);expect(carrier.x-marked).toBeGreaterThan(ordinary);expect(actor.evidence.at(-1)?.text).toContain('不包含隐藏玩家位置');
    });
  }
});
