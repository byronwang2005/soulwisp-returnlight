import type {FootstepEvent,GameView} from '@wangxu/shared';

/** Never schedules a backlog after joining, transport loss or foregrounding. */
export class FootstepCursor {
  private room='';private player='';private phase='';private elapsed=-1;private id=-1;
  private baseline=true;
  reset():void {this.baseline=true;}
  take(view:GameView,hidden:boolean):FootstepEvent[] {
    const events=view.self.footsteps??[],max=Math.max(this.id,...events.map(e=>e.id));
    const reset=this.baseline||this.room!==view.roomId||this.player!==view.self.id||this.phase!==view.phase||view.elapsed<this.elapsed;
    this.room=view.roomId;this.player=view.self.id;this.phase=view.phase;this.elapsed=view.elapsed;
    const fresh=reset||hidden||!['EXPLORE','EXTRACT'].includes(view.phase)?[]:
      events.filter(e=>e.id>this.id&&view.elapsed-e.at>=-1e-6&&view.elapsed-e.at<.5);
    this.id=reset?Math.max(-1,...events.map(e=>e.id)):max;this.baseline=hidden;
    return fresh;
  }
}
