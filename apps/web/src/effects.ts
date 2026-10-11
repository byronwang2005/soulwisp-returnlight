import {AUDIO_MIX,feedbackLevel} from './audio-mix';
import {playCombatSound,effectContext,effectDestination,registerSynthesized,unlockEffects,playFootsteps,stopFootsteps,applyEffectSettings,preloadSounds} from './sound-player';
import {FootstepCursor} from './footstep-playback';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FeedbackEvent,GameCommand,GameView} from '@wangxu/shared';
import {getEffectSettings,useFeedbackSettings} from './settings';
import presets from './feedback-sounds.json';
export type {EffectSettings} from './settings';

export interface VisualFeedback extends FeedbackEvent {receivedAt:number}
const soundPresets=presets as unknown as Record<Exclude<FeedbackEvent['kind'],'hit'>,{
  tones?:[number,number,number,OscillatorType,number,number][];noises?:[number,number,number,boolean][];
}>;
function output(volume:number,level:number,pan=0){
  const context=effectContext();if(!context||context.state!=='running'||volume<=0||getEffectSettings().muted||document.hidden)return;
  const gain=context.createGain();gain.gain.value=volume*AUDIO_MIX.effects*level;
  const stereo=context.createStereoPanner();stereo.pan.value=Math.max(-.8,Math.min(.8,pan));gain.connect(stereo);stereo.connect(effectDestination());
  let ended=false,timer:ReturnType<typeof setTimeout>;const sources=new Set<AudioScheduledSourceNode>();
  const stop=()=>{if(ended)return;ended=true;clearTimeout(timer);unregister();for(const source of sources){try{source.stop();}catch{}}sources.clear();gain.disconnect();stereo.disconnect();};
  const unregister=registerSynthesized(gain,level,stop);timer=setTimeout(stop,1500);
  return{audio:context,gain,sources};
}
function tone(out:NonNullable<ReturnType<typeof output>>,frequency:number,end:number,duration:number,type:OscillatorType='sine',delay=0,amplitude=.6){const {audio,gain}=out,now=audio.currentTime+delay,osc=audio.createOscillator(),envelope=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(Math.max(25,end),now+duration);envelope.gain.setValueAtTime(.0001,now);envelope.gain.exponentialRampToValueAtTime(amplitude,now+.008);envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);osc.connect(envelope);envelope.connect(gain);out.sources.add(osc);osc.start(now);osc.stop(now+duration+.015);osc.onended=()=>{out.sources.delete(osc);osc.disconnect();envelope.disconnect();};}
function noise(out:NonNullable<ReturnType<typeof output>>,duration:number,cutoff:number,amplitude=.3,high=false){const {audio,gain}=out,length=Math.ceil(audio.sampleRate*duration),buffer=audio.createBuffer(1,length,audio.sampleRate),samples=buffer.getChannelData(0);for(let i=0;i<length;i++)samples[i]=(Math.random()*2-1)*(1-i/length);const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),envelope=audio.createGain();source.buffer=buffer;filter.type=high?'highpass':'lowpass';filter.frequency.value=cutoff;envelope.gain.setValueAtTime(amplitude,audio.currentTime);envelope.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration);source.connect(filter);filter.connect(envelope);envelope.connect(gain);out.sources.add(source);source.start();source.onended=()=>{out.sources.delete(source);source.disconnect();filter.disconnect();envelope.disconnect();};}
export function playFeedback(kind:FeedbackEvent['kind']|'swing',volume:number,power=1,pan=0){if(kind==='swing'||kind==='hit'){if(volume<=0)return;playCombatSound(kind,power,pan);return;}const out=output(Math.max(0,Math.min(1,volume)),Math.max(.25,Math.min(1,power))*feedbackLevel(kind),pan);if(!out)return;
  const preset=soundPresets[kind];
  for(const parameters of preset.tones??[])tone(out,...parameters);
  for(const parameters of preset.noises??[])noise(out,...parameters);
}
const patterns:Record<FeedbackEvent['kind'],number|number[]>={hit:24,hurt:[25,20,35],block:[10,15,10],push:18,collision:8,pickup:8,complete:[12,25,18],down:[45,30,70],rescue:[12,18,12],cast:12,dodge:8};
export function useGameEffects(view?:GameView){const {settings,updateSettings}=useFeedbackSettings();const [events,setEvents]=useState<VisualFeedback[]>([]);const settingsRef=useRef(settings);settingsRef.current=settings;const last=useRef({room:'',player:'',elapsed:0,id:-1}),steps=useRef(new FootstepCursor()),impactAt=useRef(0);
  useEffect(()=>{preloadSounds();const prime=()=>unlockEffects();window.addEventListener('pointerdown',prime,{passive:true});window.addEventListener('keydown',prime);return()=>{window.removeEventListener('pointerdown',prime);window.removeEventListener('keydown',prime);};},[]);
  useEffect(()=>{if(!view)return;const feedback=view.self.feedback||[],now=performance.now();const reset=last.current.room!==view.roomId||last.current.player!==view.self.id||view.elapsed<last.current.elapsed;
    if(reset){last.current={room:view.roomId,player:view.self.id,elapsed:view.elapsed,id:Math.max(-1,...feedback.map(e=>e.id))};setEvents([]);return;}
    const fresh=feedback.filter(e=>e.id>last.current.id&&view.elapsed-e.at<2);last.current.id=Math.max(last.current.id,...feedback.map(e=>e.id));last.current.elapsed=view.elapsed;
    if(fresh.length){const me=view.players.find(p=>p.id===view.self.id),options=settingsRef.current;
      setEvents(current=>[...current.filter(e=>now-e.receivedAt<750),...fresh.map(e=>({...e,receivedAt:now}))].slice(-16));
      for(const event of fresh.slice(-4)){if(event.kind==='collision'&&now-impactAt.current<200)continue;impactAt.current=now;if(!options.muted)playFeedback(event.kind,options.volume,event.power,me?.x===null?0:(event.x-(me?.x??event.x))/180);if(options.haptics&&typeof navigator.vibrate==='function')navigator.vibrate(patterns[event.kind]);}
    }

  },[view]);
  useEffect(()=>{const reset=()=>{steps.current.reset();stopFootsteps();};window.addEventListener('soulwisp-game-audio-reset',reset);document.addEventListener('visibilitychange',reset);return()=>{reset();window.removeEventListener('soulwisp-game-audio-reset',reset);document.removeEventListener('visibilitychange',reset);};},[]);
  useEffect(()=>{if(!view){steps.current.reset();stopFootsteps();return;}const fresh=steps.current.take(view,document.hidden);if(!['EXPLORE','EXTRACT'].includes(view.phase))stopFootsteps();if(!settings.muted)playFootsteps(fresh);},[view]);
  useEffect(()=>{applyEffectSettings();},[settings.volume,settings.muted]);
  useEffect(()=>{if(!events.length)return;const timer=setTimeout(()=>setEvents(current=>current.filter(e=>performance.now()-e.receivedAt<750)),780);return()=>clearTimeout(timer);},[events]);
  const intent=useCallback((_type:GameCommand['type'])=>{unlockEffects();},[]);
  const swing=useCallback(()=>{const options=settingsRef.current;if(!options.muted&&!document.hidden)playFeedback('swing',options.volume,1);},[]);
  return{events,settings,updateSettings,intent,swing};
}
