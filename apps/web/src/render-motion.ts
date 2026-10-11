/** Interpolate authorized snapshots at 20 Hz without extrapolating past the newest position. */
export class RenderMotion {
  private samples:{at:number;x:number;y:number}[];
  private result={x:0,y:0};
  constructor(at:number,x:number,y:number){this.samples=[{at,x,y}];}
  update(at:number,x:number,y:number){
    const last=this.samples.at(-1)!;
    if(Math.hypot(x-last.x,y-last.y)>8){this.samples=[{at,x,y}];return;}
    if(at<=last.at){last.x=x;last.y=y;return;}
    this.samples.push({at,x,y});if(this.samples.length>12)this.samples.shift();
  }
  position(now:number){
    const at=now-80;
    while(this.samples.length>2&&this.samples[1]!.at<=at)this.samples.shift();
    const first=this.samples[0]!,next=this.samples[1]??first;
    const t=Math.max(0,Math.min(1,(at-first.at)/(next.at-first.at||1)));
    this.result.x=first.x+(next.x-first.x)*t;this.result.y=first.y+(next.y-first.y)*t;
    return this.result;
  }
}
