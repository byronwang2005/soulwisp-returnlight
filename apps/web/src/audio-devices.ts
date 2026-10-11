import type {Room} from 'livekit-client';
import {getPreferences,subscribePreferences,updatePreferences,type Preferences} from './preferences';
type SinkContext=AudioContext&{setSinkId?:(id:string)=>Promise<void>};
const rooms=new Set<Room>();
const contexts=new Set<SinkContext>();
export const outputSelectionSupported=()=>typeof HTMLMediaElement.prototype.setSinkId==='function'&&typeof (AudioContext.prototype as SinkContext).setSinkId==='function';
const report=(error:unknown)=>window.dispatchEvent(new CustomEvent('soulwisp-audio-error',{detail:error instanceof Error?error.message:'无法切换音频设备'}));
async function routeRoom(room:Room,prefs:Preferences){
  if(!await room.switchActiveDevice('audioinput',prefs.microphone))throw new Error('无法使用所选麦克风');
  if(outputSelectionSupported()&&!await room.switchActiveDevice('audiooutput',prefs.output))throw new Error('无法使用所选音响或耳机');
}
export function bindAudioRoom(room:Room){rooms.add(room);void routeRoom(room,getPreferences()).catch(report);return()=>{rooms.delete(room);};}
export function bindAudioContext(context:AudioContext){const sink=context as SinkContext;if(contexts.has(sink))return;contexts.add(sink);if(sink.setSinkId)void sink.setSinkId(getPreferences().output==='default'?'':getPreferences().output).catch(report);}
export function applyVoiceVolume(element:HTMLMediaElement){element.volume=getPreferences().voiceVolume;}
subscribePreferences(()=>{document.querySelectorAll<HTMLMediaElement>('audio[data-voice]').forEach(applyVoiceVolume);});
export async function selectAudioDevice(kind:'microphone'|'output',id:string){
  const previous=getPreferences(),next={...previous,[kind]:id};
  if(kind==='output'&&!outputSelectionSupported())throw new Error('当前浏览器请通过系统设置选择音响或耳机');
  try{
    for(const room of rooms){if(!await room.switchActiveDevice(kind==='microphone'?'audioinput':'audiooutput',id))throw new Error('音频设备切换失败');}
    if(kind==='output')for(const context of contexts)if(context.state!=='closed'&&context.setSinkId)await context.setSinkId(id==='default'?'':id);
    updatePreferences({[kind]:id});
  }catch(error){for(const room of rooms)await room.switchActiveDevice(kind==='microphone'?'audioinput':'audiooutput',previous[kind]).catch(()=>{});if(kind==='output')for(const context of contexts)if(context.setSinkId)await context.setSinkId(previous.output==='default'?'':previous.output).catch(()=>{});throw error;}
}
