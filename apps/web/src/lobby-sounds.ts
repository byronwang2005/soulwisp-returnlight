export type LobbySound='enter'|'exit'|'mic-on'|'mic-off';
interface Member {id:string;self:boolean;muted:boolean}
/** Diffs confirmed media state, keeping reconnect/initial rosters silent. */
export class LobbySoundTracker {
  private members=new Map<string,Member>();
  private active=false;
  private remoteAt=new Map<LobbySound,number>();
  constructor(private play:(kind:LobbySound,remote:boolean)=>void,private now=()=>performance.now()){}
  private emit(kind:LobbySound,remote:boolean,listening=true):void {
    if(remote) {
      if(!listening)return;
      const now=this.now();if(now-(this.remoteAt.get(kind)??-Infinity)<200)return;
      this.remoteAt.set(kind,now);
    }
    this.play(kind,remote);
  }
  join(members:Member[]):void {
    this.members=new Map(members.map(member=>[member.id,{...member}]));
    if(!this.active){this.active=true;this.remoteAt.clear();this.emit('enter',false);}
  }
  baseline(members:Member[]):void {this.members=new Map(members.map(member=>[member.id,{...member}]));}
  sync(members:Member[],listening:boolean):void {
    if(!this.active){this.baseline(members);return;}
    const current=new Map(members.map(member=>[member.id,{...member}]));
    for(const member of current.values()) {
      const previous=this.members.get(member.id);
      if(!previous){if(!member.self)this.emit('enter',true,listening);}
      else if(previous.muted!==member.muted)this.emit(member.muted?'mic-off':'mic-on',!member.self,listening);
    }
    for(const previous of this.members.values())if(!current.has(previous.id)&&!previous.self)this.emit('exit',true,listening);
    this.members=current;
  }
  leave():void {
    if(this.active)this.emit('exit',false);
    this.active=false;this.members.clear();this.remoteAt.clear();
  }
}
