import {canOccupy,interactionRadius,isSolid,OBJECT_FOOTPRINT,segmentDistance,SCENE,type GameView,type Vec2} from '@wangxu/shared';

export interface NavigationTarget extends Vec2 {id:string;name:string;radius:number}
export function navigationTarget(view:GameView,nodeId?:string,targetId?:string):NavigationTarget|undefined {
  const object=view.objects.find(item=>item.id===targetId&&item.active);
  if(object)return {id:object.id,name:object.name,x:object.x,y:object.y,radius:object.kind==='exit'?45:interactionRadius(object.kind)-6};
  const player=view.players.find(item=>item.id===targetId&&item.x!==null&&item.y!==null);
  if(player)return {id:player.id,name:player.name,x:player.x!,y:player.y!,radius:50};
  const node=view.nodes.find(item=>item.id===nodeId);
  if(node)return {...node,radius:24};
}

// A distance field is shared across position updates. Only authorized map geometry
// and visible objects are used.
export function navigationField(view:Pick<GameView,'nodes'|'edges'|'objects'>,target:NavigationTarget) {
  const step=10,nodes=view.nodes,edges=view.edges??[],objects=view.objects.filter(item=>item.active&&isSolid(item.kind));
  if(!nodes.length)return {route:(_point:Vec2):Vec2[]=>[]};
  const left=Math.floor(Math.min(...nodes.map(n=>n.x-n.radius))/step)*step;
  const top=Math.floor(Math.min(...nodes.map(n=>n.y-n.radius))/step)*step;
  const width=Math.ceil((Math.max(...nodes.map(n=>n.x+n.radius))-left)/step)+1;
  const height=Math.ceil((Math.max(...nodes.map(n=>n.y+n.radius))-top)/step)+1;
  const count=width*height,allowed=new Uint8Array(count),distance=new Int32Array(count).fill(-1);
  const point=(id:number):Vec2=>({x:left+(id%width)*step,y:top+Math.floor(id/width)*step});
  const corridors=edges.map(([a,b])=>({a:nodes.find(n=>n.id===a)!,b:nodes.find(n=>n.id===b)!}));
  // Cover the entire segment with room disks and corridor capsules. Sampling can
  // miss a short gap at a room/road seam or a tangent to a solid object.
  const clear=(a:Vec2,b:Vec2)=>{
    if(objects.some(o=>segmentDistance(o,a,b)<OBJECT_FOOTPRINT[o.kind]+SCENE.playerRadius))return false;
    const dx=b.x-a.x,dy=b.y-a.y,lengthSq=dx*dx+dy*dy;
    if(lengthSq<1e-10)return canOccupy(a,nodes,edges,objects);
    const intervals:[number,number][]=[];
    const disk=(center:Vec2,radius:number)=>{
      const x=a.x-center.x,y=a.y-center.y,linear=2*(dx*x+dy*y),constant=x*x+y*y-radius*radius;
      const discriminant=linear*linear-4*lengthSq*constant;if(discriminant<0)return;
      const root=Math.sqrt(discriminant),start=Math.max(0,(-linear-root)/(2*lengthSq)),end=Math.min(1,(-linear+root)/(2*lengthSq));
      if(start<=end)intervals.push([start,end]);
    };
    nodes.forEach(node=>disk(node,node.radius));
    for(const corridor of corridors){
      const x=corridor.b.x-corridor.a.x,y=corridor.b.y-corridor.a.y,length=Math.hypot(x,y);if(!length)continue;
      disk(corridor.a,SCENE.corridorRadius);disk(corridor.b,SCENE.corridorRadius);
      const ux=x/length,uy=y/length,ax=a.x-corridor.a.x,ay=a.y-corridor.a.y;
      let start=0,end=1;
      for(const [position,velocity,min,max] of [[ax*ux+ay*uy,dx*ux+dy*uy,0,length],[-ax*uy+ay*ux,-dx*uy+dy*ux,-SCENE.corridorRadius,SCENE.corridorRadius]]){
        if(Math.abs(velocity)<1e-10){if(position<min||position>max){end=-1;break;}}
        else {const t1=(min-position)/velocity,t2=(max-position)/velocity;start=Math.max(start,Math.min(t1,t2));end=Math.min(end,Math.max(t1,t2));}
      }
      if(start<=end)intervals.push([start,end]);
    }
    intervals.sort((a,b)=>a[0]-b[0]);let covered=0;
    for(const [start,end] of intervals){if(start>covered+1e-9)return false;covered=Math.max(covered,end);if(covered>=1-1e-9)return true;}
    return false;
  };
  const queue:number[]=[];
  for(let id=0;id<count;id++){
    const p=point(id);if(!canOccupy(p,nodes,edges,objects))continue;allowed[id]=1;
    if(Math.hypot(p.x-target.x,p.y-target.y)<=target.radius){distance[id]=0;queue.push(id);}
  }
  const neighbours=(id:number)=>[id%width? id-1:-1,id%width<width-1?id+1:-1,id>=width?id-width:-1,id+width<count?id+width:-1].filter(next=>next>=0&&allowed[next]);
  for(let head=0;head<queue.length;head++){
    const id=queue[head];for(const next of neighbours(id))if(distance[next]<0&&clear(point(id),point(next))){distance[next]=distance[id]+1;queue.push(next);}
  }
  return {route(start:Vec2):Vec2[]{
    if(Math.hypot(start.x-target.x,start.y-target.y)<=target.radius)return [];
    const col=Math.round((start.x-left)/step),row=Math.round((start.y-top)/step);
    let first=-1,best=Infinity;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const x=col+dx,y=row+dy;if(x<0||x>=width||y<0||y>=height)continue;
      const id=y*width+x;if(distance[id]<0)continue;
      const p=point(id),cost=Math.hypot(p.x-start.x,p.y-start.y)+distance[id]*step;
      if(cost<best&&clear(start,p)){best=cost;first=id;}
    }
    if(first<0)return [];
    const path=[start,point(first)];let id=first;
    while(distance[id]>0){const next=neighbours(id).find(next=>distance[next]===distance[id]-1&&clear(point(id),point(next)));if(next===undefined)return [];id=next;path.push(point(id));}
    const smooth=[start];let anchor=0;
    while(anchor<path.length-1){let next=path.length-1;while(next>anchor+1&&!clear(path[anchor],path[next]))next--;smooth.push(path[next]);anchor=next;}
    return smooth;
  }};
}

// Project the map with the same horizontal basis and elevation as the fixed camera.
export function mapProjection(point:Vec2):Vec2 {
  const length=Math.hypot(19,23),foreshorten=25/Math.hypot(19,25,23);
  return {x:(23*point.x-19*point.y)/length,y:(19*point.x+23*point.y)/length*foreshorten};
}
export const routeWorldPoint=(point:Vec2):[number,number,number]=>[(point.x-500)/SCENE.unitsPerMeter,.08,(point.y-350)/SCENE.unitsPerMeter];
