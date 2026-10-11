import {useSyncExternalStore} from 'react';

export interface EffectSettings {volume:number;muted:boolean;haptics:boolean;motion:boolean;musicVolume:number;musicEnabled:boolean}
const key='soulwisp-effects';
const listeners=new Set<()=>void>();
let snapshot:EffectSettings|undefined;
const volume=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
function read():EffectSettings {
  let saved:Partial<EffectSettings>={};
  try{saved=JSON.parse(localStorage.getItem(key)||'{}')??{};}catch{}
  return {volume:volume(saved.volume,.65),muted:saved.muted===true,haptics:saved.haptics!==false,motion:typeof saved.motion==='boolean'?saved.motion:!matchMedia('(prefers-reduced-motion: reduce)').matches,musicVolume:volume(saved.musicVolume,.45),musicEnabled:saved.musicEnabled!==false};
}
const getSnapshot=()=>snapshot??=read();
function changed(){snapshot=read();listeners.forEach(listener=>listener());}
function subscribe(listener:()=>void){
  if(!listeners.size)window.addEventListener('storage',changed);
  listeners.add(listener);
  return()=>{listeners.delete(listener);if(!listeners.size)window.removeEventListener('storage',changed);};
}
export function updateSettings(change:Partial<EffectSettings>){
  const current=getSnapshot();snapshot={...current,...change,volume:volume(change.volume,current.volume),musicVolume:volume(change.musicVolume,current.musicVolume)};
  try{localStorage.setItem(key,JSON.stringify(snapshot));}catch{}
  listeners.forEach(listener=>listener());
}
export const getEffectSettings=getSnapshot;
export const subscribeEffectSettings=subscribe;
export function useFeedbackSettings(){return {settings:useSyncExternalStore(subscribe,getSnapshot),updateSettings};}
