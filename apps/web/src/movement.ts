import {SCENE,segmentDistance,type GameView,type Vec2} from '@wangxu/shared';
const length=Math.hypot(19,23);
/** Match the fixed isometric camera: right is screen right, forward is screen up. */
export function screenToWorld(input:Vec2):Vec2{return {x:(23*input.x+19*input.y)/length,y:(-19*input.x+23*input.y)/length};}
export {worldToScreen} from '@wangxu/shared';
export function movementInput(input:Vec2,view:GameView):Vec2{
  const world=screenToWorld(input),magnitude=Math.hypot(world.x,world.y);
  if(!magnitude)return {x:0,y:0};
  world.x/=magnitude;world.y/=magnitude;
  const actor=view.players.find(p=>p.id===view.self.id);
  if(actor?.x==null||actor.y==null)return world;
  const point={x:actor.x,y:actor.y};
  // Rooms keep unrestricted steering. Corridors help a held direction follow their centre.
  if(view.nodes.some(n=>Math.hypot(point.x-n.x,point.y-n.y)<n.radius-12))return world;
  const roads=(view.edges??[]).map(([a,b])=>({a:view.nodes.find(n=>n.id===a)!,b:view.nodes.find(n=>n.id===b)!}));
  roads.sort((a,b)=>segmentDistance(point,a.a,a.b)-segmentDistance(point,b.a,b.b));
  const road=roads[0];if(!road||segmentDistance(point,road.a,road.b)>SCENE.corridorRadius)return world;
  const dx=road.b.x-road.a.x,dy=road.b.y-road.a.y,d=Math.hypot(dx,dy),tx=dx/d,ty=dy/d;
  const alignment=world.x*tx+world.y*ty;
  if(Math.abs(alignment)<.82)return world; // Turning across a road always releases assistance.
  const lateral=(point.x-road.a.x)*-ty+(point.y-road.a.y)*tx;
  const correction=Math.max(-.35,Math.min(.35,-lateral/45)),sign=Math.sign(alignment);
  const x=tx*sign-ty*correction,y=ty*sign+tx*correction,n=Math.hypot(x,y);
  return {x:x/n,y:y/n};
}
