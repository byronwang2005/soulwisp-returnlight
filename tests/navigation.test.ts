import {describe,it,expect} from 'vitest';
import {TrainingSession,trainingLayout,getLayout,getConfig} from '@wangxu/rules';
import {canOccupy,type Vec2,type WorldObject} from '@wangxu/shared';
import {mapProjection,navigationField,navigationTarget} from '../apps/web/src/navigation';

function validatePath(layout:Parameters<typeof navigationField>[0],path:Vec2[]) {
  expect(path.length).toBeGreaterThan(1);
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],samples=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y));
    for(let j=0;j<=samples;j++){
      const t=samples?j/samples:0;
      expect(canOccupy({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},layout.nodes,layout.edges??[],layout.objects)).toBe(true);
    }
  }
}

describe('authorized ground navigation',()=>{
  it('follows the training road network instead of cutting across the void',()=>{
    const session=new TrainingSession(false,0),objective=session.objective(),view=session.view;
    const target=navigationTarget(view,objective.nodeId,objective.targetId)!;
    const path=navigationField(view,target).route(session.me);
    validatePath(view,path);
    expect(Math.hypot(path.at(-1)!.x-target.x,path.at(-1)!.y-target.y)).toBeLessThanOrEqual(target.radius);
    expect(path.length).toBeGreaterThan(2);
  });

  it('reaches every training landmark through free floor and stops in interaction range',()=>{
    const layout=trainingLayout();
    for(const object of layout.objects){
      const session=new TrainingSession(false,0),view={...session.view,...layout,objects:layout.objects.map(o=>({...o,active:true}))};
      const target=navigationTarget(view,object.nodeId,object.id)!;
      const path=navigationField(view,target).route({x:500,y:350});
      validatePath(view,path);
      expect(Math.hypot(path.at(-1)!.x-target.x,path.at(-1)!.y-target.y),object.id).toBeLessThanOrEqual(target.radius);
    }
  });

  it('routes around solid equipment even inside a room',()=>{
    const obstacle:WorldObject={id:'chest',kind:'chest',name:'箱子',x:0,y:0,active:true,progress:0};
    const view={nodes:[{id:'room',name:'房间',x:0,y:0,radius:120}],edges:[] as [string,string][],objects:[obstacle]};
    const target={id:'goal',name:'目标',x:80,y:0,radius:10};
    const path=navigationField(view,target).route({x:-80,y:0});
    validatePath(view,path);expect(path.length).toBeGreaterThan(2);
  });

  it('continues forward when starting halfway along a corridor',()=>{
    const view={nodes:[{id:'a',name:'甲',x:0,y:0,radius:70},{id:'b',name:'乙',x:300,y:0,radius:70}],edges:[['a','b']] as [string,string][],objects:[]};
    const path=navigationField(view,{id:'b',name:'乙',x:300,y:0,radius:20}).route({x:140,y:0});
    validatePath(view,path);expect(path.every(p=>p.x>=140)).toBe(true);
  });

  it('returns no trail after arrival or for disconnected destinations',()=>{
    const view={nodes:[{id:'a',name:'甲',x:0,y:0,radius:70},{id:'b',name:'乙',x:300,y:0,radius:70}],edges:[] as [string,string][],objects:[]};
    const field=navigationField(view,{id:'b',name:'乙',x:300,y:0,radius:20});
    expect(field.route({x:0,y:0})).toEqual([]);expect(field.route({x:300,y:0})).toEqual([]);
    expect(navigationField({...view,nodes:[]},{id:'b',name:'乙',x:300,y:0,radius:20}).route({x:0,y:0})).toEqual([]);
  });

  it('uses a public room until a private target is actually visible',()=>{
    const session=new TrainingSession(false,0),view=session.view;
    const objective=session.objective();expect(view.objects.some(o=>o.id===objective.targetId)).toBe(false);
    expect(navigationTarget(view,objective.nodeId,objective.targetId)?.id).toBe(objective.nodeId);
    const hidden=view.players.find(p=>p.x===null)!;
    expect(hidden).toBeDefined();expect(navigationTarget(view,undefined,hidden.id)).toBeUndefined();
  });

  it('projects screen-right and screen-up consistently with the game camera',()=>{
    expect(mapProjection({x:23,y:-19}).x).toBeGreaterThan(0);
    expect(mapProjection({x:23,y:-19}).y).toBeCloseTo(0);
    expect(mapProjection({x:-19,y:-23}).x).toBeCloseTo(0);
    expect(mapProjection({x:-19,y:-23}).y).toBeLessThan(0);
  });

  it('navigates the generated four-player and ten-player map variants',()=>{
    for(const capacity of [4,10])for(let seed=0;seed<3;seed++){
      const layout=getLayout(getConfig(capacity),seed),target={...layout.nodes.at(-1)!,radius:24};
      const path=navigationField(layout,target).route(layout.nodes[0]);
      validatePath(layout,path);
      expect(Math.hypot(path.at(-1)!.x-target.x,path.at(-1)!.y-target.y)).toBeLessThanOrEqual(target.radius);
    }
  });
});
