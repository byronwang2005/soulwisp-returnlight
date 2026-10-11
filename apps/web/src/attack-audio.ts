// The bundled horizontal slash winds up until frame 6 of its 32-frame clip.
// Follow mixer time so render throttling and hit-stop keep the cue with the blade.
export const ATTACK_DURATION=.6;
export class AttackAudioMarker {
  private started=0;
  private marker=0;
  private pending=false;
  start(now:number,clipDuration:number):void {this.started=now;this.marker=clipDuration*6/32;this.pending=true;}
  clear():void {this.pending=false;}
  take(clipTime:number,now:number):boolean {
    if(!this.pending)return false;
    if(now-this.started>750){this.pending=false;return false;}
    if(clipTime<this.marker)return false;
    this.pending=false;return true;
  }
}
