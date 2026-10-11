import type { MapNode, Vec2, WorldObject } from './index.js';

export const SCENE = Object.freeze({unitsPerMeter:20, playerRadius:14, corridorRadius:35, bodyHeight:2.2});
export const SCENE_MATERIALS=Object.freeze({floor:{id:'monastery_stone_floor',meters:1.8},road:{id:'cobblestone_floor_09',meters:2.2}});
export const OBJECT_FOOTPRINT:Record<WorldObject['kind'],number> = {
  resource:10, beacon:14, altar:18, core:12, cleanse:20,
  elite:22, chest:20, deposit:22, exit:65, bridge:12,
};
export function segmentDistance(point:Vec2,a:Vec2,b:Vec2) {
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
}
export function isWalkable(point:Vec2,nodes:MapNode[],edges:[string,string][],margin=0) {
  return nodes.some(node=>Math.hypot(point.x-node.x,point.y-node.y)<=node.radius+margin)
    ||edges.some(([a,b])=>segmentDistance(point,nodes.find(n=>n.id===a)!,nodes.find(n=>n.id===b)!)<=SCENE.corridorRadius+margin);
}
export function interactionRadius(kind:WorldObject['kind']) {
  return Math.min(78,OBJECT_FOOTPRINT[kind]+SCENE.playerRadius+20);
}
export function sceneryColumns(nodes:MapNode[],edges:[string,string][],objects:WorldObject[]) {
  const columns:{x:number;y:number;radius:number;height:number}[]=[];
  for(const node of nodes.filter(n=>n.id==='sanctuary'||objects.some(o=>o.kind==='exit'&&Math.hypot(o.x-n.x,o.y-n.y)<n.radius))) {
    for(const offset of [-.45,.45]) {
      const point={x:node.x+offset*node.radius,y:node.y-node.radius-55};
      const radius=14;
      if(!isWalkable(point,nodes,edges,radius+SCENE.playerRadius)
        &&objects.every(o=>Math.hypot(o.x-point.x,o.y-point.y)>radius+interactionRadius(o.kind)))
        columns.push({...point,radius,height:50});
    }
  }
  return columns;
}
export function mapRoute(point:Vec2,nodes:MapNode[],edges:[string,string][],destination:string){
  const start=nodes.reduce((a,b)=>Math.hypot(point.x-a.x,point.y-a.y)<Math.hypot(point.x-b.x,point.y-b.y)?a:b).id;
  const queue=[start],parents=new Map<string,string>(),seen=new Set([start]);
  while(queue.length&&!seen.has(destination)){const id=queue.shift()!;for(const [a,b]of edges){const next=a===id?b:b===id?a:null;if(next&&!seen.has(next)){parents.set(next,id);seen.add(next);queue.push(next);}}}
  if(!seen.has(destination))return [];
  const route=[destination];while(route[0]!==start)route.unshift(parents.get(route[0]!)!);
  return route;
}

export function isSolid(kind:WorldObject['kind']){return ['beacon','altar','cleanse','elite','chest','deposit'].includes(kind);}
export function canOccupy(point:Vec2,nodes:MapNode[],edges:[string,string][],objects:WorldObject[]){
  return isWalkable(point,nodes,edges)&&objects.every(o=>!o.active||!isSolid(o.kind)||Math.hypot(point.x-o.x,point.y-o.y)>=OBJECT_FOOTPRINT[o.kind]+SCENE.playerRadius);
}
export function approachPoint(observer:Vec2,target:Vec2&{kind?:WorldObject['kind']}){
  const dx=observer.x-target.x,dy=observer.y-target.y,length=Math.hypot(dx,dy)||1;
  const distance=target.kind&&isSolid(target.kind)?OBJECT_FOOTPRINT[target.kind]+SCENE.playerRadius+3:0;
  return {x:target.x+dx/length*distance,y:target.y+dy/length*distance};
}
