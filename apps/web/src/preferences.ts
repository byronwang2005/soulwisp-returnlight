import {useSyncExternalStore} from 'react';
export interface Preferences {frameRate:0|60|120;microphone:string;output:string;voiceVolume:number}
const key='soulwisp-preferences';
const listeners=new Set<()=>void>();
function read():Preferences{let saved:Partial<Preferences>={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')??{};}catch{}return{frameRate:saved.frameRate===60||saved.frameRate===120?saved.frameRate:0,microphone:typeof saved.microphone==='string'?saved.microphone:'default',output:typeof saved.output==='string'?saved.output:'default',voiceVolume:typeof saved.voiceVolume==='number'&&Number.isFinite(saved.voiceVolume)?Math.max(0,Math.min(1,saved.voiceVolume)):1};}
let value=read();
export const getPreferences=()=>value;
export function subscribePreferences(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function updatePreferences(patch:Partial<Preferences>){value={...value,...patch};try{localStorage.setItem(key,JSON.stringify(value));}catch{}listeners.forEach(fn=>fn());}
window.addEventListener('storage',event=>{if(event.key===key||event.key===null){value=read();listeners.forEach(fn=>fn());}});
export function usePreferences(){return useSyncExternalStore(subscribePreferences,getPreferences);}
export function openSettings(){window.dispatchEvent(new Event('soulwisp-open-settings'));}
