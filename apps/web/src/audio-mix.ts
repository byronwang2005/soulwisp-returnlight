import {FOOTSTEPS,type FootstepEvent} from '@wangxu/shared';

export const AUDIO_MIX=Object.freeze({music:.20,effects:.65,remoteLobby:10**(-3/20),maxFootsteps:16});
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
