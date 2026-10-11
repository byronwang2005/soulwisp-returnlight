import type {GameView,Vec2,VisionView} from '@wangxu/shared';
export function insidePolygon(p:Vec2,polygon:Vec2[]){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export function pointInVision(p:Vec2,origin:Vec2,vision:VisionView){return Math.hypot(p.x-origin.x,p.y-origin.y)<=vision.radius&&!vision.occluded.some(polygon=>insidePolygon(p,polygon));}
export const fogEnabled=(view:GameView)=>!!view.self.visibility&&(view.phase==='EXPLORE'||view.phase==='EXTRACT');
export function visibleActors(view:GameView){return view.players.filter(player=>player.x!==null&&player.y!==null);}
export function visibleObjects(view:GameView){if(!fogEnabled(view))return view.objects;const me=view.players.find(p=>p.id===view.self.id);if(!me||me.sealed||me.x===null||me.y===null)return [];return view.objects.filter(o=>pointInVision(o,{x:me.x!,y:me.y!},view.self.visibility!));}
export interface FogBounds {left:number;top:number;width:number;height:number}
export function fogBounds(view:Pick<GameView,'nodes'>):FogBounds{const left=Math.min(...view.nodes.map(n=>n.x-n.radius))-180,top=Math.min(...view.nodes.map(n=>n.y-n.radius))-180;return {left,top,width:Math.max(...view.nodes.map(n=>n.x+n.radius))+180-left,height:Math.max(...view.nodes.map(n=>n.y+n.radius))+180-top};}
// Terrain cells only. No actor, object or facility state enters this cache.
export class ExplorationMemory {
 private key='';private explored=new Uint8Array(256*256);
 update(view:GameView,bounds:FogBounds){const key=`${view.self.visibility?.matchKey}:${view.self.id}`;if(key!==this.key){this.key=key;this.explored.fill(0);}
  const data=new Uint8Array(256*256*4),actor=view.players.find(p=>p.id===view.self.id),active=fogEnabled(view),origin=actor?.x!==null&&actor?.y!==null&&actor?{x:actor.x!,y:actor.y!}:undefined;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*256+x,p={x:bounds.left+(x+.5)/256*bounds.width,y:bounds.top+(y+.5)/256*bounds.height};const current=!!(active&&origin&&!actor?.sealed&&pointInVision(p,origin,view.self.visibility!));if(current)this.explored[i]=1;data[i*4]=current?255:0;data[i*4+1]=this.explored[i]?255:0;data[i*4+3]=255;}return data;
 }
}
// Module lifetime survives a socket reconnect but ends at a document refresh.
export const explorationMemory=new ExplorationMemory();
