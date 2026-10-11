import {describe,it,expect} from 'vitest';
import {FOOTSTEPS,hearFootstep,footstepSurface,footstepDirection,type MapNode,type FootstepEvent,type GameView} from '@wangxu/shared';
import {GameEngine,getConfig,RULES} from '@wangxu/rules';
import {FootstepSystem} from '../packages/rules/src/footsteps';
import {FootstepCursor} from '../apps/web/src/footstep-playback';
import {footstepPosition,footstepLevel} from '../apps/web/src/audio-mix';

const hall:MapNode[]=[{id:'hall',name:'Hall',x:500,y:350,radius:1000}];
function game(){
  const engine=new GameEngine({roomId:'steps',invite:'STEPS',config:getConfig(4),seed:1,
    layout:{nodes:hall,edges:[],variant:0,objects:[{id:'core',name:'Core',kind:'core',x:500,y:350,active:false,progress:0}]}});
  for(let i=0;i<4;i++)engine.addPlayer({id:`p${i}`,name:`Player ${i}`});
  engine.phase='EXPLORE';engine.remaining=100;engine.chapter=1;
  for(const p of engine.players.values()){p.x=500;p.y=350;}
  return engine;
}
function move(engine:GameEngine,id='p0',x=1,y=0){
  const actor=engine.players.get(id)!;
  expect(engine.command(id,{type:'move',x,y,seq:actor.seq+1})).toBe(true);
}
describe('authoritative walking and private hearing',()=>{
  it('emits one step per actual stride, with recipient-only ids and no hidden identity/position',()=>{
    const engine=game();engine.players.get('p1')!.x=260;
    move(engine);engine.tick(.35);
    const view=engine.viewFor('p1'),events=view.self.footsteps!;
    expect(view.players.find(p=>p.id==='p0')!.x).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({id:1,own:false,surface:'stone',pace:'normal',distance:'far',occluded:false});
    expect(Object.keys(events[0]).sort()).toEqual(['at','direction','distance','id','occluded','own','pace','surface'].sort());
    expect(engine.viewFor('p0').self.footsteps![0]).toMatchObject({own:true});
    engine.tick(.35);expect(engine.viewFor('p1').self.footsteps!.at(-1)!.id).toBe(1);
    engine.players.get('p1')!.x=350;engine.tick(.35);expect(engine.viewFor('p1').self.footsteps!.at(-1)!.id).toBe(2);
    move(engine,'p0',0,0);engine.tick(.6);expect(engine.viewFor('p1').self.footsteps).toEqual([]);
  });
  it('changes cadence and pace for core carrying, fractional input and fleet movement',()=>{
    const slow=game(),normal=game(),fast=game();
    slow.players.get('p0')!.carryingCore=true;fast.players.get('p0')!.boons.push('fleet');
    for(const engine of [slow,normal,fast])move(engine);
    for(const engine of [slow,normal,fast])engine.tick(.35);
    expect(slow.viewFor('p0').self.footsteps).toEqual([]);
    expect(normal.viewFor('p0').self.footsteps![0].pace).toBe('normal');
    expect(fast.viewFor('p0').self.footsteps![0].pace).toBe('fast');
    slow.tick(.1);expect(slow.viewFor('p0').self.footsteps![0].pace).toBe('slow');
    const fractional=game();move(fractional,'p0',.5);fractional.tick(.7);
    expect(fractional.viewFor('p0').self.footsteps![0].pace).toBe('slow');
  });
  it('does not turn collision, dodge, push, teleport or recovery into extra footsteps',()=>{
    const engine=game(),actor=engine.players.get('p0')!;
    actor.x=1499.9;move(engine);engine.tick(.4);expect(engine.viewFor('p0').self.footsteps).toEqual([]);
    actor.x=500;move(engine,'p0',0,0);
    expect(engine.command('p0',{type:'dodge',x:1,y:0})).toBe(true);
    engine.tick(.05);expect(engine.viewFor('p0').self.footsteps).toEqual([]);
    actor.x+=100;engine.tick(.05);expect(engine.viewFor('p0').self.footsteps).toEqual([]);
    actor.down=true;actor.downUntil=0;actor.x=900;engine.tick(.05);
    expect(actor.x).toBe(500);expect(engine.viewFor('p0').self.footsteps).toEqual([]);
    const pushed=game(),target=pushed.players.get('p1')!;target.x=540;
    move(pushed);move(pushed,'p0',0,0);
    expect(pushed.command('p0',{type:'attack',targetId:'p1'})).toBe(true);
    pushed.tick(.05);expect(pushed.viewFor('p1').self.footsteps).toEqual([]);
  });
  it('keeps downed listeners hearing, excludes sealed/disconnected listeners and ignores visual fog',()=>{
    const engine=game();engine.players.get('p1')!.down=true;engine.players.get('p1')!.downUntil=20;
    engine.players.get('p2')!.sealed=true;engine.disconnect('p3');
    const internal=engine as unknown as {fogs:{x:number;y:number;until:number}[]};
    internal.fogs.push({x:500,y:350,until:10});engine.players.get('p1')!.x=340;
    move(engine);engine.tick(.35);
    expect(engine.viewFor('p1').players.find(p=>p.id==='p0')!.x).toBeNull();
    expect(engine.viewFor('p1').self.footsteps).toHaveLength(1);
    expect(engine.viewFor('p2').self.footsteps).toEqual([]);
    expect(engine.viewFor('p3').self.footsteps).toEqual([]);
    engine.phase='DISCUSS';expect(engine.viewFor('p0').self.footsteps).toEqual([]);
  });
  it('bounds each listener queue and emits serials only for heard events',()=>{
    const system=new FootstepSystem(hall,[],RULES.moveSpeed);
    const source={id:'source',x:500,y:350,connected:true,sealed:false,down:false};
    const listener={...source,id:'listener',x:1400};
    for(let i=0;i<100;i++)system.walk(source,{x:464,y:350},.35,.35);
    system.flush([source,listener],.35);
    expect(system.view(source.id,.35)).toHaveLength(FOOTSTEPS.capacity);
    expect(system.view(listener.id,.35)).toEqual([]);
    listener.x=500;system.walk(source,{x:464,y:350},.35,.7);system.flush([source,listener],.7);
    expect(system.view(listener.id,.7)[0].id).toBe(1);
    expect(system.view(source.id,1.3)).toEqual([]);
  });
});

describe('map acoustics and camera orientation',()=>{
  const nodes:MapNode[]=[{id:'a',name:'A',x:0,y:0,radius:50},{id:'b',name:'B',x:400,y:0,radius:50}];
  it('gives floor regions precedence over corridors and enforces material/pace ranges',()=>{
    expect(footstepSurface({x:50,y:0},nodes)).toBe('stone');
    expect(footstepSurface({x:51,y:0},nodes)).toBe('cobble');
    const hear=(x:number,surface:'stone'|'cobble',pace:'slow'|'normal'|'fast')=>hearFootstep({x:0,y:0},{x,y:0},surface,pace,hall,[]);
    expect(hear(280,'stone','normal')).not.toBeNull();expect(hear(280.1,'stone','normal')).toBeNull();
    expect(hear(320,'cobble','normal')).not.toBeNull();expect(hear(320.1,'cobble','normal')).toBeNull();
    expect(hear(250,'stone','slow')).toBeNull();expect(hear(300,'stone','fast')).not.toBeNull();
    expect(hear(84,'stone','normal')!.distance).toBe('near');
    expect(hear(84.1,'stone','normal')!.distance).toBe('mid');
    expect(hear(182.1,'stone','normal')!.distance).toBe('far');
  });
  it('suppresses disconnected rooms and muffles around an authored corridor bend',()=>{
    expect(hearFootstep({x:0,y:0},{x:200,y:0},'stone','normal',nodes,[])).toBeNull();
    const bend:MapNode[]=[{id:'a',name:'A',x:0,y:0,radius:30},{id:'b',name:'B',x:100,y:0,radius:30},{id:'c',name:'C',x:100,y:100,radius:30}];
    const edges:[string,string][]=[['a','b'],['b','c']];
    const sound=hearFootstep({x:0,y:0},{x:100,y:100},'stone','normal',bend,edges);
    expect(sound).toMatchObject({occluded:true,distance:'far'});
    expect(footstepLevel({id:1,at:0,surface:'stone',pace:'normal',...sound!})).toBeCloseTo(.15*10**(-6/20));
    bend[2].y=140;
    expect(hearFootstep({x:0,y:0},{x:100,y:140},'stone','normal',bend,edges)).toBeNull();
  });
  it('maps screen forward/right/back/left to HRTF front/right/back/left',()=>{
    const directions=[{x:-19,y:-23},{x:23,y:-19},{x:19,y:23},{x:-23,y:19}];
    expect(directions.map(footstepDirection)).toEqual([0,4,8,12]);
    expect(footstepPosition(0).z).toBe(-1);expect(footstepPosition(4).x).toBe(1);
    expect(footstepPosition(8).z).toBe(1);expect(footstepPosition(12).x).toBe(-1);
  });
});

describe('ephemeral client playback',()=>{
  it('drops initial, duplicate, stale, reconnect, phase and visibility backlogs',()=>{
    const cursor=new FootstepCursor(),base=game().viewFor('p0');
    const event=(id:number,at:number):FootstepEvent=>({id,at,own:true,surface:'stone',pace:'normal'});
    const view=(elapsed:number,events:FootstepEvent[]):GameView=>({...base,elapsed,self:{...base.self,footsteps:events}});
    expect(cursor.take(view(1,[event(1,1)]),false)).toEqual([]);
    expect(cursor.take(view(1.1,[event(1,1),event(2,1.1)]),false)).toHaveLength(1);
    expect(cursor.take(view(1.1,[event(2,1.1)]),false)).toEqual([]);
    expect(cursor.take(view(2,[event(3,1.4)]),false)).toEqual([]);
    cursor.reset();expect(cursor.take(view(2.1,[event(4,2.1)]),false)).toEqual([]);
    expect(cursor.take(view(2.2,[event(5,2.2)]),true)).toEqual([]);
    expect(cursor.take(view(2.3,[event(6,2.3)]),false)).toEqual([]);
    expect(cursor.take(view(2.4,[event(7,2.4)]),false)).toHaveLength(1);
    expect(cursor.take({...view(2.5,[event(8,2.5)]),phase:'EXTRACT'},false)).toEqual([]);
    expect(cursor.take(view(0,[event(1,0)]),false)).toEqual([]);
  });
});
