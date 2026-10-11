import {movementInput,screenToWorld,worldToScreen} from '../apps/web/src/movement';
import {describe,it,expect} from 'vitest';
import {getConfig,getLayout,GameEngine,TrainingSession} from '@wangxu/rules';
import {OBJECT_FOOTPRINT,isWalkable,canOccupy,approachPoint,interactionRadius,sceneryColumns,mapRoute,segmentDistance,isSolid} from '@wangxu/shared';
import {AutoQuality,qualityProfile} from '../apps/web/src/render-quality';
import {pickAction} from '../apps/web/src/interaction';
import {groundPolygons,pavingGeometry} from '../apps/web/src/ground-geometry';

describe('authored map geometry',()=>{
  for(let n=4;n<=10;n++)for(let seed=0;seed<3;seed++)it(`${n} players / layout ${seed}: all chapter stations fit and corridors are open`,()=>{
    const layout=getLayout(getConfig(n),seed);
    for(const o of layout.objects){expect(isWalkable(o,layout.nodes,layout.edges)).toBe(true);const node=layout.nodes.find(n=>n.id===o.nodeId)!;expect(Math.hypot(o.x-node.x,o.y-node.y)+OBJECT_FOOTPRINT[o.kind]).toBeLessThan(node.radius);const active=layout.objects.map(o=>({...o,active:true}));expect(Array.from({length:16},(_,i)=>({x:o.x+Math.cos(i*Math.PI/8)*(OBJECT_FOOTPRINT[o.kind]+17),y:o.y+Math.sin(i*Math.PI/8)*(OBJECT_FOOTPRINT[o.kind]+17)})).some(point=>canOccupy(point,layout.nodes,layout.edges,active))).toBe(true);}
    for(let i=0;i<layout.objects.length;i++)for(let j=i+1;j<layout.objects.length;j++){
      const a=layout.objects[i],b=layout.objects[j];expect(Math.hypot(a.x-b.x,a.y-b.y),`${a.id} overlaps ${b.id}`).toBeGreaterThan(OBJECT_FOOTPRINT[a.kind]+OBJECT_FOOTPRINT[b.kind]+14);
    }
    for(const [a,b]of layout.edges)for(const object of layout.objects.filter(o=>isSolid(o.kind)))expect(segmentDistance(object,layout.nodes.find(n=>n.id===a)!,layout.nodes.find(n=>n.id===b)!),`road ${a}/${b} blocked by ${object.id}`).toBeGreaterThan(OBJECT_FOOTPRINT[object.kind]+14);
    for(const column of sceneryColumns(layout.nodes,layout.edges,layout.objects))expect(isWalkable(column,layout.nodes,layout.edges,column.radius+14)).toBe(false);
    for(const node of layout.nodes)expect(mapRoute(layout.nodes[0],layout.nodes,layout.edges,node.id).at(-1)).toBe(node.id);
    const polygons=groundPolygons(layout.nodes,layout.edges,35);
    const mesh=pavingGeometry(polygons.roads,2.2),positions=mesh.getAttribute('position'),index=mesh.getIndex()!;
    for(let i=0;i<index.count;i+=3){const vertices=[0,1,2].map(j=>index.getX(i+j));const center={x:vertices.reduce((v,j)=>v+positions.getX(j),0)/3,y:vertices.reduce((v,j)=>v+positions.getZ(j),0)/3};
      expect(isWalkable(center,layout.nodes,layout.edges,.1)).toBe(true);
      for(const node of layout.nodes)expect(Math.hypot(center.x-node.x,center.y-node.y)).toBeGreaterThan(node.radius-.1);
    }mesh.dispose();
  });
});
function started(){const game=new GameEngine({roomId:'context',invite:'CONTEXT',config:getConfig(4),seed:0});for(let i=0;i<4;i++)game.addPlayer({id:`p${i}`,name:`Player ${i}`});for(const p of game.players.values())game.command(p.id,{type:'ready',ready:true});game.tick(45);return game;}
describe('authoritative context actions',()=>{
  it('shows a resource blocker and never advertises hidden coordinates',()=>{
    const game=started(),me=game.players.get('p0')!,object=game.objects.find(o=>o.kind==='resource'&&o.active)!;me.x=object.x;me.y=object.y;me.resources=4;
    const view=game.viewFor(me.id),candidate=view.self.actions!.find(a=>a.targetId===object.id)!;
    expect(candidate.enabled).toBe(false);expect(candidate.reason).toBe('背包已满');expect(game.command(me.id,{type:'interact',targetId:object.id})).toBe(false);
    for(const action of view.self.actions!)expect(view.objects.some(o=>o.id===action.targetId)||view.players.some(p=>p.id===action.targetId&&p.x!==null)).toBe(true);
    game.players.get('p1')!.x=10000;game.players.get('p1')!.y=10000;const hidden=game.viewFor(me.id).players.find(p=>p.id==='p1')!;expect(hidden.x).toBeNull();expect(hidden.facing).toBeUndefined();
  });
  it('rejects backward attacks, prioritizes the guard and retains facing at rest',()=>{
    const game=started(),me=game.players.get('p0')!,guard=game.objects.find(o=>o.id==='guardian')!,other=game.players.get('p1')!;
    me.x=500;me.y=350;me.facingX=1;me.facingY=0;guard.x=540;guard.y=350;guard.active=true;guard.hp=66;other.x=530;other.y=350;
    expect(game.command(me.id,{type:'attack'})).toBe(true);expect(guard.hp).toBe(44);expect(other.hp).toBe(100);
    game.tick(.8);guard.x=460;expect(game.command(me.id,{type:'attack',targetId:guard.id})).toBe(false);
    game.command(me.id,{type:'move',x:0,y:-1,seq:1});game.command(me.id,{type:'move',x:0,y:0,seq:2});expect(game.viewFor(me.id).players.find(p=>p.id===me.id)!.facing).toEqual({x:0,y:-1});
  });
  it('uses role-specific skill targets independently of the interaction target',()=>{
    const game=started(),me=game.players.get('p0')!,other=game.players.get('p1')!;me.x=500;me.y=350;me.facingX=1;me.facingY=0;other.x=540;other.y=350;
    expect(game.command(me.id,{type:'skill'})).toBe(true);expect(other.shield).toBeGreaterThan(0);expect(me.shield).toBe(0);
  });
  it('uses ten-unit hysteresis, releases invalid targets and pins a channel',()=>{
    const view=started().viewFor('p0');const action=(id:string,distance:number)=>({targetId:id,action:'interact' as const,label:'Collect',name:id,distance,alignment:1,enabled:true});
    view.self.actions=[action('new',30),action('old',37)];expect(pickAction(view,'interact','old')?.targetId).toBe('old');
    view.self.actions[1].distance=41;expect(pickAction(view,'interact','old')?.targetId).toBe('new');
    view.self.interaction={targetId:'old',progress:.5};expect(pickAction(view,'interact','new')?.targetId).toBe('old');view.self.actions.pop();expect(pickAction(view,'interact','old')?.targetId).toBe('new');
  });
});
describe('automatic quality',()=>{
  it('reduces effects before resolution and avoids a failed upgrade for thirty seconds',()=>{
    const control=new AutoQuality();expect(control.sample(50,2500)).toBe(4);expect(control.sample(50,5000)).toBe(3);expect(qualityProfile(3,2).dpr).toBe(2);
    for(let i=1;i<=4;i++)control.sample(60,5000+i*2500);expect(control.level).toBe(4);
    control.sample(50,17500);control.sample(50,20000);expect(control.level).toBe(3);
    for(let i=1;i<=8;i++)control.sample(60,20000+i*2500);expect(control.level).toBe(3);
    control.sample(60,50000);expect(control.level).toBe(4);
  });
});
function walk(session:TrainingSession,target:{x:number;y:number}){
  const {nodes,edges}=session.engine.layout;const goal=nodes.reduce((a,b)=>Math.hypot(target.x-a.x,target.y-a.y)<Math.hypot(target.x-b.x,target.y-b.y)?a:b);
  const route=mapRoute(session.me,nodes,edges,goal.id);
  for(const point of [...route.map(id=>nodes.find(n=>n.id===id)!),target]){
    let count=0;while(Math.hypot(session.me.x-point.x,session.me.y-point.y)>3&&count++<2000){const dx=point.x-session.me.x,dy=point.y-session.me.y,d=Math.hypot(dx,dy);session.command({type:'move',x:dx/d,y:dy/d,seq:session.me.seq+1});session.tick(.025);}
    expect(count).toBeLessThan(2000);
  }
  session.command({type:'move',x:0,y:0,seq:session.me.seq+1});
}
function use(session:TrainingSession,id:string){const target=session.engine.objects.find(o=>o.id===id)??session.engine.players.get(id)!;const node=session.engine.layout.nodes.reduce((a,b)=>Math.hypot(target.x-a.x,target.y-a.y)<Math.hypot(target.x-b.x,target.y-b.y)?a:b);walk(session,node);walk(session,approachPoint(session.me,target));const action=pickAction(session.view,'interact');expect(action?.targetId).toBe(id);expect(action?.enabled).toBe(true);expect(session.command({type:'interact',targetId:action!.targetId})).toBe(true);for(let i=0;i<110;i++)session.tick(.05);}
describe('cross-region training',()=>{
  for(const wolf of [false,true])it(`${wolf?'wolf':'human'} completes all physical stations using movement and context actions`,()=>{
    const s=new TrainingSession(wolf);use(s,'resource-training-start');expect(s.done).toBe(true);s.enter(1);
    use(s,'chest-training');use(s,'warehouse');use(s,'stash');use(s,'beacon-0');expect(s.done).toBe(true);s.enter(2);
    walk(s,s.engine.layout.nodes.find(n=>n.id==='node-1')!);s.command({type:'skill'});s.command({type:'dodge',x:1,y:0});walk(s,s.engine.layout.nodes.find(n=>n.id==='node-4')!);walk(s,approachPoint(s.me,s.engine.objects.find(o=>o.id==='guardian')!));
    s.command({type:'skill'});for(let i=0;i<3;i++){expect(s.command({type:'attack'})).toBe(true);s.tick(.8);}
    use(s,'guide-1');use(s,'resource-training-repair');use(s,'beacon-1');
    if(wolf){walk(s,s.engine.layout.nodes.find(n=>n.id==='node-1')!);walk(s,approachPoint(s.me,s.engine.objects.find(o=>o.id==='altar-training')!));expect(s.command({type:'transform'}),'transform').toBe(true);expect(s.command({type:'corrupt',targetId:pickAction(s.view,'corrupt')!.targetId}),JSON.stringify(s.view.self.actions)).toBe(true);expect(s.command({type:'fog',x:s.me.x,y:s.me.y})).toBe(true);for(let i=0;i<90;i++)s.tick(.05);}
    use(s,'cleanse');expect(s.done).toBe(true);s.enter(3);expect(s.me.x).toBe(500);expect(s.me.evidence.length).toBeGreaterThan(0);
    expect(s.command({type:'publish',evidenceId:s.me.evidence[0].id})).toBe(true);expect(s.command({type:'say',text:'I witnessed the rescue and public engineering.'})).toBe(true);s.beginVote();expect(s.command({type:'vote',targetId:null})).toBe(true);expect(s.done).toBe(true);
    s.enter(4);s.command({type:'draft',boonId:s.me.draftOptions[0]});expect(s.done).toBe(true);s.enter(5);use(s,'resource-training-core');use(s,'core');use(s,'purify');walk(s,s.engine.objects.find(o=>o.id==='exit')!);for(let i=0;i<520&&!s.done;i++)s.tick(.05);expect(s.done,JSON.stringify({phase:s.engine.phase,result:s.engine.result,hold:s.engine.holdProgress,players:[...s.engine.players.values()].map(p=>({id:p.id,x:p.x,y:p.y,down:p.down,faction:p.faction}))})).toBe(true);
  });
  it('restores every lesson with an achievable objective and independent inventory',()=>{for(let step=0;step<6;step++){const session=new TrainingSession(false,step);expect(session.step).toBe(step);expect(session.me.hp).toBe(100);expect(session.objective().text).toBeTruthy();expect(session.me.resources).toBeLessThanOrEqual(4);}});
});
describe('independent skill targeting and channel races',()=>{
  it('selects a downed ally for rescue and a nearby chest for excavation',()=>{
    const g=started(),me=g.players.get('p0')!,ally=g.players.get('p1')!;me.profession='medic';ally.down=true;ally.hp=0;ally.x=me.x+30;ally.y=me.y;
    expect(g.command(me.id,{type:'skill'})).toBe(true);expect(me.interaction?.targetId).toBe(ally.id);g.tick(2.1);expect(ally.down).toBe(false);
    me.profession='scavenger';me.skillAt=0;const chest=g.objects.find(o=>o.kind==='chest')!;me.x=chest.x;me.y=chest.y;expect(g.command(me.id,{type:'skill'})).toBe(true);expect(me.interaction?.targetId).toBe(chest.id);
  });
  it('engineer selects a visible repair device and does not reveal a hidden one',()=>{
    const g=started(),me=g.players.get('p0')!,beacon=g.objects.find(o=>o.kind==='beacon')!;me.profession='engineer';me.x=beacon.x;me.y=beacon.y;
    expect(g.command(me.id,{type:'skill'})).toBe(true);expect(me.skillAt).toBeGreaterThan(0);me.skillAt=0;beacon.x+=5000;
    expect(g.command(me.id,{type:'skill',targetId:beacon.id})).toBe(false);
  });
  it('moving, canceling and damage release a fixed channel without allocating its item',()=>{
    const g=started(),me=g.players.get('p0')!,o=g.objects.find(o=>o.kind==='resource'&&o.active)!;me.x=o.x;me.y=o.y;
    expect(g.command(me.id,{type:'interact',targetId:o.id})).toBe(true);g.command(me.id,{type:'move',x:1,y:0,seq:1});expect(me.interaction).toBeNull();g.command(me.id,{type:'move',x:0,y:0,seq:2});
    g.command(me.id,{type:'interact',targetId:o.id});g.command(me.id,{type:'cancel'});expect(me.interaction).toBeNull();
    g.command(me.id,{type:'interact',targetId:o.id});(g as any).damage(me,1);expect(me.interaction).toBeNull();expect(me.resources).toBe(0);
  });
  it('concurrent core pickup awards one holder and one inventory allocation',()=>{
    const g=started();g.chapter=2;const core=g.objects.find(o=>o.id==='core')!;core.active=true;
    for(const id of ['p0','p1']){const p=g.players.get(id)!;p.x=core.x;p.y=core.y;expect(g.command(id,{type:'interact',targetId:core.id})).toBe(true);}
    g.tick(2);expect([...g.players.values()].filter(p=>p.carryingCore)).toHaveLength(1);expect(core.active).toBe(false);
  });
});
it('separates repeated dropped items while preserving the pickup instances',()=>{
  const g=started(),me=g.players.get('p0')!;me.loot=[0,1,2].map(i=>({id:`dropped-${i}`,contentId:'treasure',name:'Treasure',value:3}));
  for(let i=0;i<3;i++)expect(g.command(me.id,{type:'drop',itemId:`dropped-${i}`})).toBe(true);
  const dropped=g.objects.filter(o=>o.id.startsWith('dropped-'));expect(dropped).toHaveLength(3);
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)expect(Math.hypot(dropped[i].x-dropped[j].x,dropped[i].y-dropped[j].y)).toBeGreaterThan(54);
});

describe('screen movement and corridor guidance',()=>{
  it('maps WASD to the camera and keeps a single held direction on a diagonal road',()=>{
    const screen={x:.4,y:-.8},inverse=worldToScreen(screenToWorld(screen));expect(inverse.x).toBeCloseTo(screen.x);expect(inverse.y).toBeCloseTo(screen.y);
    const s=new TrainingSession(false),from=s.engine.layout.nodes[1]!,to=s.engine.layout.nodes[2]!;s.me.x=from.x;s.me.y=from.y;
    let minimumError=Infinity;for(let i=0;i<200;i++){const move=movementInput({x:0,y:1},s.view);expect(Math.hypot(move.x,move.y)).toBeCloseTo(1);s.command({type:'move',...move,seq:s.me.seq+1});s.tick(.05);const distance=Math.hypot(s.me.x-to.x,s.me.y-to.y);minimumError=Math.min(minimumError,distance);expect(s.me.down).toBe(false);}
    expect(minimumError).toBeLessThan(45);
  });
  it('allows turning away from a corridor and releases movement completely',()=>{
    const s=new TrainingSession(false),a=s.engine.layout.nodes[1]!,b=s.engine.layout.nodes[2]!;s.me.x=(a.x+b.x)/2;s.me.y=(a.y+b.y)/2;
    expect(movementInput({x:0,y:0},s.view)).toEqual({x:0,y:0});expect(movementInput({x:1,y:0},s.view)).toEqual(screenToWorld({x:1,y:0}));
  });
});
