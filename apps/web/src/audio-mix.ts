import {FOOTSTEPS,type FootstepEvent,type FeedbackEvent} from '@wangxu/shared';

export const AUDIO_MIX=Object.freeze({music:.20,effects:.65,combatHit:1.4*10**(3/20),lobby:10**(3/20),remoteLobby:10**(-3/20),maxFootsteps:16,peakLimit:.95});
export const feedbackLevel=(kind:FeedbackEvent['kind'])=>10**((kind==='hit'||kind==='collision'?3:6)/20);
export function peakLimitCurve():Float32Array<ArrayBuffer>{
  const curve=new Float32Array(4097);
  for(let i=0;i<curve.length;i++)curve[i]=Math.max(-AUDIO_MIX.peakLimit,Math.min(AUDIO_MIX.peakLimit,i*2/(curve.length-1)-1));
  return curve;
}
export const musicLevel=(volume:number,ducked:boolean)=>volume*AUDIO_MIX.music*(ducked?.18:1);
export function footstepLevel(event:FootstepEvent):number {
  return FOOTSTEPS.paceGain[event.pace]*(event.own?FOOTSTEPS.ownGain:
    FOOTSTEPS.distanceGain[event.distance]*(event.occluded?FOOTSTEPS.obstructionGain:1));
}
export function footstepPosition(direction:number):{x:number;z:number} {
  const angle=direction*Math.PI/8;
  return {x:Math.sin(angle),z:-Math.cos(angle)};
}
export function footstepPriority(event:FootstepEvent):number {
  return event.own?4:({near:3,mid:2,far:1}[event.distance])-(event.occluded?.25:0);
}
