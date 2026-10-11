import {FOOTSTEPS,footstepPace,footstepSurface,hearFootstep,type FootstepEvent,type MapNode,type Vec2} from '@wangxu/shared';

interface Actor extends Vec2 {id:string;connected:boolean;sealed:boolean;down:boolean}
export class FootstepSystem {
  private strides=new Map<string,{distance:number;at:number;position:Vec2}>();
  private queues=new Map<string,FootstepEvent[]>();
  private serials=new Map<string,number>();
  private pending:{id:string;point:Vec2;pace:FootstepEvent['pace'];at:number}[]=[];
  constructor(private nodes:MapNode[],private edges:[string,string][],private baseSpeed:number){}

  walk(actor:Actor,before:Vec2,dt:number,at:number):void {
    const moved=Math.hypot(actor.x-before.x,actor.y-before.y);
    if(moved<1e-6)return;
    let stride=this.strides.get(actor.id);
    // Command displacements, recovery and teleports break the previous gait.
    if(!stride||at-stride.at>.5||Math.hypot(before.x-stride.position.x,before.y-stride.position.y)>1e-5)
      stride={distance:0,at,position:before};
    let remaining=moved,travelled=0;
    while(stride.distance+remaining>=FOOTSTEPS.stride-1e-7) {
      const advance=FOOTSTEPS.stride-stride.distance;travelled+=advance;remaining-=advance;
      this.pending.push({id:actor.id,point:{x:before.x+(actor.x-before.x)*travelled/moved,y:before.y+(actor.y-before.y)*travelled/moved},pace:footstepPace(moved/dt,this.baseSpeed),at});
      stride.distance=0;
    }
    stride.distance+=Math.max(0,remaining);stride.at=at;stride.position={x:actor.x,y:actor.y};
    this.strides.set(actor.id,stride);
  }
  flush(actors:Actor[],at:number):void {
    for(const step of this.pending) {
      const surface=footstepSurface(step.point,this.nodes);
      for(const listener of actors) {
        if(!listener.connected||listener.sealed)continue;
        const acoustic=listener.id===step.id?{own:true as const}:hearFootstep(listener,step.point,surface,step.pace,this.nodes,this.edges);
        if(!acoustic)continue;
        const id=(this.serials.get(listener.id)??0)+1;this.serials.set(listener.id,id);
        const queue=this.queues.get(listener.id)??[];
        queue.push({id,at:step.at,surface,pace:step.pace,...acoustic});
        this.queues.set(listener.id,queue.filter(event=>at-event.at<FOOTSTEPS.retention).slice(-FOOTSTEPS.capacity));
      }
    }
    this.pending=[];
    for(const [id,queue] of this.queues)this.queues.set(id,queue.filter(event=>at-event.at<FOOTSTEPS.retention));
  }
  view(id:string,at:number):FootstepEvent[] {
    return (this.queues.get(id)??[]).filter(event=>at-event.at<FOOTSTEPS.retention).map(event=>({...event}));
  }
  clear():void {this.strides.clear();this.queues.clear();this.pending=[];}
}
