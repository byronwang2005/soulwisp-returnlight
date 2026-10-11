import {FOOTSTEPS,type FootstepEvent,type FootstepSurface} from '@wangxu/shared';
import {bindAudioContext} from './audio-devices';
import {AUDIO_MIX,footstepLevel,footstepPosition,footstepPriority} from './audio-mix';
import {getEffectSettings,subscribeEffectSettings} from './settings';
import type {LobbySound} from './lobby-sounds';

let context:AudioContext|undefined;
let subscribed=false;
const buffers=new Map<string,AudioBuffer>();
const loading=new Map<string,Promise<void>>();
const active=new Set<{source:AudioBufferSourceNode;gain:GainNode;priority:number;footstep:boolean;level:number}>();
const variants:Record<FootstepSurface,number>={stone:-1,cobble:-1};
const files=[...['enter','exit','mic-on','mic-off'].map(kind=>`lobby-${kind}`),
  ...['stone','cobble'].flatMap(surface=>Array.from({length:5},(_,i)=>`${surface}-${i}`))];

export function effectContext():AudioContext|undefined {return context;}
export function unlockEffects():void {
  try {
    context??=new AudioContext();bindAudioContext(context);
    if(!subscribed){subscribeEffectSettings(applyEffectSettings);subscribed=true;}
    if(context.state==='suspended')void context.resume().catch(()=>{});
    preloadSounds();
  }catch{/* An unavailable audio device must not block controls. */}
}
export function preloadSounds():void {
  try {context??=new AudioContext();bindAudioContext(context);}catch{return;}
  for(const file of files)if(!buffers.has(file)&&!loading.has(file)) {
    const audio=context;
    const task=fetch(`/audio/sfx/${file}.wav`).then(async response=>{
      if(!response.ok)throw new Error(`Sound unavailable: ${file}`);
      const buffer=await audio.decodeAudioData(await response.arrayBuffer());buffers.set(file,buffer);
    }).catch(()=>{}).finally(()=>loading.delete(file));
    loading.set(file,task);
  }
}
export function stopFootsteps():void {for(const sound of active)if(sound.footstep)sound.source.stop();}
export function applyEffectSettings():void {
  const settings=getEffectSettings();
  for(const sound of active){if(settings.muted||settings.volume===0)sound.source.stop();else sound.gain.gain.setTargetAtTime(settings.volume*AUDIO_MIX.effects*sound.level,context!.currentTime,.015);}
}
function play(file:string,level:number,event?:FootstepEvent):void {
  const audio=context,buffer=buffers.get(file),settings=getEffectSettings();
  if(!audio||audio.state!=='running'||!buffer||settings.muted||settings.volume<=0||document.hidden)return;
  const priority=event?footstepPriority(event):5;
  if(event) {
    const steps=[...active].filter(sound=>sound.footstep);
    if(steps.length>=AUDIO_MIX.maxFootsteps) {
      const lowest=steps.reduce((a,b)=>a.priority<=b.priority?a:b);
      if(lowest.priority>priority)return;
      lowest.source.stop();active.delete(lowest);
    }
  }
  const source=audio.createBufferSource(),gain=audio.createGain(),nodes:AudioNode[]=[source,gain];
  source.buffer=buffer;source.playbackRate.value=event?1+(Math.random()*.06-.03):1;
  gain.gain.value=settings.volume*AUDIO_MIX.effects*level;
  source.connect(gain);
  let tail:AudioNode=gain;
  if(event&&!event.own) {
    if(event.occluded){const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=FOOTSTEPS.obstructionCutoff;tail.connect(filter);tail=filter;nodes.push(filter);}
    const panner=audio.createPanner(),point=footstepPosition(event.direction);
    panner.panningModel='HRTF';panner.rolloffFactor=0;
    panner.positionX.value=point.x;panner.positionY.value=0;panner.positionZ.value=point.z;
    tail.connect(panner);tail=panner;nodes.push(panner);
  }
  tail.connect(audio.destination);
  const sound={source,gain,priority,footstep:!!event,level};active.add(sound);
  source.onended=()=>{active.delete(sound);nodes.forEach(node=>node.disconnect());};
  source.start();
}
export function playLobbySound(kind:LobbySound,remote=false):void {
  // Events are ephemeral: decode may finish later, but must not replay history.
  play(`lobby-${kind}`,remote?AUDIO_MIX.remoteLobby:1);
}
export function playFootsteps(events:FootstepEvent[]):void {
  for(const event of [...events].sort((a,b)=>footstepPriority(b)-footstepPriority(a))) {
    const last=variants[event.surface];let next=Math.floor(Math.random()*(last<0?5:4));
    if(last>=0&&next>=last)next++;variants[event.surface]=next;
    play(`${event.surface}-${next}`,footstepLevel(event),event);
  }
}
