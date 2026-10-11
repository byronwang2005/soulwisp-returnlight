import {isWalkable, SCENE, segmentDistance} from './scene.js';
import type {MapNode, Vec2} from './index.js';

export type FootstepSurface = 'stone' | 'cobble';
export type FootstepPace = 'slow' | 'normal' | 'fast';
export type FootstepEvent = {
  id:number; at:number; surface:FootstepSurface; pace:FootstepPace;
} & ({own:true} | {own:false; direction:number; distance:'near'|'mid'|'far'; occluded:boolean});
export const FOOTSTEPS = Object.freeze({stride:36, retention:.5, capacity:64,
  range:{stone:14*SCENE.unitsPerMeter, cobble:16*SCENE.unitsPerMeter},
  rangeScale:{slow:.85, normal:1, fast:1.1},
  paceGain:{slow:10**(-2/20), normal:1, fast:10**(1.5/20)},
  distanceGain:{near:1, mid:.45, far:.15}, ownGain:10**(-3/20),
  obstructionRange:.55, obstructionGain:10**(-6/20), obstructionCutoff:1400,
});

/** The scene's fixed camera points along (19, 23); screen Y points down. */
export function worldToScreen(input:Vec2):Vec2 {
  const length=Math.hypot(19,23);
  return {x:(23*input.x-19*input.y)/length, y:(19*input.x+23*input.y)/length};
}
export function footstepDirection(delta:Vec2):number {
  const screen=worldToScreen(delta);
  return (Math.round(Math.atan2(screen.x,-screen.y)*8/Math.PI)+16)%16;
}
export function footstepSurface(point:Vec2,nodes:MapNode[]):FootstepSurface {
  return nodes.some(n=>Math.hypot(point.x-n.x,point.y-n.y)<=n.radius)?'stone':'cobble';
}
export function footstepPace(speed:number,baseSpeed:number):FootstepPace {
  return speed<baseSpeed*.95-1e-7?'slow':speed>baseSpeed*1.05+1e-7?'fast':'normal';
}

function regions(point:Vec2,nodes:MapNode[],edges:[string,string][]):Set<string> {
  const ids=new Set(nodes.filter(n=>Math.hypot(point.x-n.x,point.y-n.y)<=n.radius).map(n=>n.id));
  for(const [a,b] of edges) {
    const from=nodes.find(n=>n.id===a),to=nodes.find(n=>n.id===b);
    if(from&&to&&segmentDistance(point,from,to)<=SCENE.corridorRadius){ids.add(a);ids.add(b);}
  }
  return ids;
}
function connected(from:Vec2,to:Vec2,nodes:MapNode[],edges:[string,string][]):boolean {
  const seen=regions(from,nodes,edges),goals=regions(to,nodes,edges),queue=[...seen];
  for(let i=0;i<queue.length;i++) {
    const id=queue[i];if(goals.has(id))return true;
    const node=nodes.find(n=>n.id===id)!;
    const neighbours=[...edges.flatMap(([a,b])=>a===id?[b]:b===id?[a]:[]),
      ...nodes.filter(n=>Math.hypot(n.x-node.x,n.y-node.y)<=n.radius+node.radius).map(n=>n.id)];
    for(const next of neighbours)if(!seen.has(next)){seen.add(next);queue.push(next);}
  }
  return false;
}

/** Produces only the acoustic information authorized for this listener. */
export function hearFootstep(listener:Vec2,source:Vec2,surface:FootstepSurface,pace:FootstepPace,
  nodes:MapNode[],edges:[string,string][]):Omit<Extract<FootstepEvent,{own:false}>,'id'|'at'|'surface'|'pace'>|null {
  const delta={x:source.x-listener.x,y:source.y-listener.y},distance=Math.hypot(delta.x,delta.y);
  let range=FOOTSTEPS.range[surface]*FOOTSTEPS.rangeScale[pace];
  if(distance>range||!connected(listener,source,nodes,edges))return null;
  const samples=Math.max(1,Math.ceil(distance/(SCENE.unitsPerMeter/4)));
  let occluded=false;
  for(let i=0;i<=samples;i++)if(!isWalkable({x:listener.x+delta.x*i/samples,y:listener.y+delta.y*i/samples},nodes,edges)){occluded=true;break;}
  if(occluded)range*=FOOTSTEPS.obstructionRange;
  if(distance>range)return null;
  return {own:false,direction:footstepDirection(delta),distance:distance<=range*.3?'near':distance<=range*.65?'mid':'far',occluded};
}
