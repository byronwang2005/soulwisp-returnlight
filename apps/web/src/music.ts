import {useEffect,useSyncExternalStore} from 'react';
import {Howl,Howler} from 'howler';
import type {EffectSettings} from './settings';
import {MUSIC,type MusicScene} from './music-catalog';

type Status='waiting'|'loading'|'playing'|'paused'|'blocked'|'unavailable';
interface State {scene:MusicScene;status:Status;ducked:boolean}
class SceneMusic {
  private current?:{scene:MusicScene;sound:Howl;id?:number;pending:boolean};
  private retiring?:{sound:Howl;timer:ReturnType<typeof setTimeout>};
  private unlocked=false;
  private settings?:EffectSettings;
  private state:State={scene:'welcome',status:'waiting',ducked:false};
  private listeners=new Set<()=>void>();
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(change:Partial<State>){const next={...this.state,...change};if(Object.keys(change).some(key=>next[key as keyof State]!==this.state[key as keyof State])){this.state=next;this.listeners.forEach(listener=>listener());}}
  set(scene:MusicScene,settings:EffectSettings,ducked:boolean){this.settings=settings;this.publish({scene,ducked});this.sync();}
  unlock=()=>{
    this.unlocked=true;
    // Resume during the user gesture, including when an earlier playback attempt was rejected.
    void Howler.ctx?.resume().catch(()=>{});
    this.sync();
  };
  visibility=()=>this.sync();
  private retire(){if(this.retiring){clearTimeout(this.retiring.timer);this.retiring.sound.stop();this.retiring.sound.unload();this.retiring=undefined;}}
  private play(){
    const current=this.current;
    if(!current||current.pending)return;
    current.pending=true;
    current.id=current.sound.play(current.id);
  }
  private sync(){
    const options=this.settings;
    if(!options||!this.unlocked)return;
    if(document.hidden||options.muted||!options.musicEnabled||options.musicVolume===0){
      this.retire();if(this.current?.sound.state()==='loaded')this.current.sound.pause(this.current.id);this.publish({status:'paused'});return;
    }
    const level=options.musicVolume*(this.state.ducked ? .18 : 1);
    if(this.current?.scene===this.state.scene){
      const sound=this.current.sound;
      if(!sound.playing()){sound.volume(level);this.play();}else if(Math.abs(sound.volume()-level)>.001)sound.fade(sound.volume(),level,250);
      return;
    }
    this.retire();
    if(this.current){
      const old=this.current.sound;old.fade(old.volume(),0,900);
      this.retiring={sound:old,timer:setTimeout(()=>{if(this.retiring?.sound===old)this.retire();},950)};
    }
    const scene=this.state.scene;
    const sound=new Howl({src:[`/audio/${scene}.mp3`],loop:true,volume:0,preload:true,
      onplay:()=>{
        if(this.current?.sound!==sound)return;
        this.current.pending=false;
        if(document.hidden||this.settings?.muted||!this.settings?.musicEnabled){sound.pause();this.publish({status:'paused'});return;}
        sound.fade(sound.volume(),(this.settings?.musicVolume??0)*(this.state.ducked ? .18 : 1),900);this.publish({status:'playing'});
      },
      onloaderror:()=>{if(this.current?.sound===sound){sound.unload();this.current=undefined;this.publish({status:'unavailable'});}},
      onplayerror:()=>{if(this.current?.sound===sound){this.current.pending=false;this.publish({status:'blocked'});}}
    });
    this.current={scene,sound,pending:false};this.publish({status:'loading'});this.play();
  }
  dispose(){this.retire();this.current?.sound.stop();this.current?.sound.unload();this.current=undefined;this.unlocked=false;this.publish({status:'waiting'});}
}
export const sceneMusic=new SceneMusic();
export function useSceneMusic(scene:MusicScene,settings:EffectSettings,ducked=false){
  const state=useSyncExternalStore(sceneMusic.subscribe,sceneMusic.getSnapshot);
  useEffect(()=>{sceneMusic.set(scene,settings,ducked||scene==='discuss');},[scene,settings,ducked]);
  useEffect(()=>{
    window.addEventListener('pointerdown',sceneMusic.unlock,{passive:true});window.addEventListener('keydown',sceneMusic.unlock);
    document.addEventListener('visibilitychange',sceneMusic.visibility);
    return()=>{window.removeEventListener('pointerdown',sceneMusic.unlock);window.removeEventListener('keydown',sceneMusic.unlock);document.removeEventListener('visibilitychange',sceneMusic.visibility);sceneMusic.dispose();};
  },[]);
  return {...state,title:MUSIC[state.scene].title,unlock:sceneMusic.unlock};
}
