import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LobbySoundTracker} from '../apps/web/src/lobby-sounds';

const self={id:'self',self:true,muted:true},remote={id:'remote',self:false,muted:true};
describe('confirmed lobby sound transitions',()=>{
  it('plays all four own cues, remote changes and one leave, keeping roster baselines silent',()=>{
    const play=vi.fn(),tracker=new LobbySoundTracker(play);
    tracker.baseline([self,remote]);expect(play).not.toHaveBeenCalled();
    tracker.join([self,remote]);expect(play.mock.calls).toEqual([['enter',false]]);
    tracker.sync([{...self,muted:false},remote],true);
    tracker.sync([{...self,muted:false},remote],true);
    tracker.sync([self,remote],true);
    tracker.sync([self,remote,{id:'new',self:false,muted:true}],true);
    tracker.sync([self,{...remote,muted:false},{id:'new',self:false,muted:true}],true);
    tracker.sync([self,remote,{id:'new',self:false,muted:true}],true);
    tracker.sync([self,remote],true);tracker.leave();tracker.leave();
    expect(play.mock.calls).toEqual([['enter',false],['mic-on',false],['mic-off',false],['enter',true],['mic-on',true],['mic-off',true],['exit',true],['exit',false]]);
  });
  it('coalesces each remote kind for 200 ms and consumes inaudible/reconnected history',()=>{
    let now=0;const play=vi.fn(),tracker=new LobbySoundTracker(play,()=>now);
    tracker.join([self]);play.mockClear();
    tracker.sync([self,remote],true);
    now=199;tracker.sync([self,remote,{id:'second',self:false,muted:true}],true);
    now=200;tracker.sync([self,remote,{id:'second',self:false,muted:true},{id:'third',self:false,muted:true}],true);
    expect(play.mock.calls).toEqual([['enter',true],['enter',true]]);
    play.mockClear();tracker.sync([{...self,muted:false},{...remote,muted:false}],false);
    expect(play.mock.calls).toEqual([['mic-on',false]]);
    play.mockClear();tracker.sync([{...self,muted:false},{...remote,muted:false}],true);
    tracker.baseline([self]);tracker.sync([self],true);expect(play).not.toHaveBeenCalled();
  });
});

const mocks=vi.hoisted(()=>({play:vi.fn(),request:vi.fn(),connect:vi.fn(),mic:vi.fn()}));
vi.mock('../apps/web/src/sound-player',()=>({playLobbySound:mocks.play,unlockEffects:vi.fn(),preloadSounds:vi.fn()}));
vi.mock('../apps/web/src/api',()=>({request:mocks.request}));
vi.mock('../apps/web/src/audio-devices',()=>({bindAudioRoom:()=>()=>{},applyVoiceVolume:vi.fn()}));
vi.mock('livekit-client',async()=>{
  const actual=await vi.importActual<typeof import('livekit-client')>('livekit-client');
  class Room {
    state=actual.ConnectionState.Disconnected;canPlaybackAudio=true;activeSpeakers:unknown[]=[];
    remoteParticipants=new Map<string,{identity:string;name:string;isMicrophoneEnabled:boolean}>();
    localParticipant={identity:'self',name:'Self',isMicrophoneEnabled:false,audioTrackPublications:new Map(),
      setMicrophoneEnabled:async(enabled:boolean)=>{
        await mocks.mic(enabled);this.localParticipant.isMicrophoneEnabled=enabled;
        this.emit(enabled?actual.RoomEvent.LocalTrackPublished:actual.RoomEvent.TrackMuted);
      },unpublishTrack:vi.fn()};
    private listeners=new Map<string,((...args:unknown[])=>void)[]>();
    on(event:string,listener:(...args:unknown[])=>void){this.listeners.set(event,[...(this.listeners.get(event)??[]),listener]);return this;}
    emit(event:string,...args:unknown[]){for(const listener of this.listeners.get(event)??[])listener(...args);}
    removeAllListeners(){this.listeners.clear();}
    startAudio=async()=>{};prepareConnection=async()=>{};
    connect=async()=>{await mocks.connect();this.state=actual.ConnectionState.Connected;};
    disconnect=async()=>{this.state=actual.ConnectionState.Disconnected;this.emit(actual.RoomEvent.Disconnected,actual.DisconnectReason.CLIENT_INITIATED);};
  }
  return {...actual,Room};
});
import {LobbyVoiceConnection} from '../apps/web/src/lobby-voice';
import {RoomEvent} from 'livekit-client';
type TestRoom={emit:(event:string,...args:unknown[])=>void;remoteParticipants:Map<string,{identity:string;name:string;isMicrophoneEnabled:boolean}>};

describe('lobby controller audio wiring without a media service',()=>{
  const connections:LobbyVoiceConnection[]=[];
  const connection=()=>{const c=new LobbyVoiceConnection();connections.push(c);return c;};
  beforeEach(()=>{
    vi.useFakeTimers();mocks.play.mockReset();mocks.connect.mockReset();mocks.mic.mockReset();
    mocks.request.mockReset().mockImplementation(async(path:string)=>path.endsWith('/token')?{url:'local',token:'ticket'}:{available:true,online:0,capacity:10,url:null});
  });
  afterEach(()=>{connections.splice(0).forEach(c=>c.dispose());vi.useRealTimers();});
  it('signals only successful join/mic operations, and navigation disposal exits once',async()=>{
    const c=connection();await c.join();
    expect(mocks.play.mock.calls).toEqual([['enter',false]]);
    mocks.mic.mockRejectedValueOnce(new Error('Permission denied'));const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    await c.toggleMic();expect(mocks.play).toHaveBeenCalledTimes(1);expect(c.getSnapshot().muted).toBe(true);warn.mockRestore();
    await c.toggleMic();await c.toggleMic();
    expect(mocks.play.mock.calls).toEqual([['enter',false],['mic-on',false],['mic-off',false]]);
    c.leave();c.dispose();expect(mocks.play.mock.calls.at(-1)).toEqual(['exit',false]);expect(mocks.play).toHaveBeenCalledTimes(4);
  });
  it('does not signal failed/cancelled connection or a delayed microphone permission after exit',async()=>{
    const failed=connection();mocks.connect.mockRejectedValueOnce(new Error('Offline'));await failed.join();
    expect(mocks.play).not.toHaveBeenCalled();
    const cancelled=connection();let finish!:()=>void;mocks.connect.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const joining=cancelled.join();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    cancelled.leave();finish();await joining;expect(mocks.play).not.toHaveBeenCalled();
    const c=connection();await c.join();mocks.play.mockClear();
    let permission!:()=>void;mocks.mic.mockImplementationOnce(()=>new Promise<void>(resolve=>{permission=resolve;}));
    const enabling=c.toggleMic();c.leave();permission();await enabling;
    expect(mocks.play.mock.calls).toEqual([['exit',false]]);
  });
  it('notifies other members, respects listening, and keeps reconnect synchronization quiet',async()=>{
    const c=connection();await c.join();const room=c.room as unknown as TestRoom;mocks.play.mockClear();
    const peer={identity:'peer',name:'Peer',isMicrophoneEnabled:false};
    room.remoteParticipants.set(peer.identity,peer);room.emit(RoomEvent.ParticipantConnected,peer);
    peer.isMicrophoneEnabled=true;room.emit(RoomEvent.TrackPublished);
    peer.isMicrophoneEnabled=false;room.emit(RoomEvent.TrackMuted);
    expect(mocks.play.mock.calls).toEqual([['enter',true],['mic-on',true],['mic-off',true]]);
    c.toggleListening();peer.isMicrophoneEnabled=true;room.emit(RoomEvent.TrackUnmuted);expect(mocks.play).toHaveBeenCalledTimes(3);
    c.toggleListening();room.emit(RoomEvent.Reconnecting);room.remoteParticipants.clear();room.emit(RoomEvent.ParticipantDisconnected,peer);
    room.emit(RoomEvent.Reconnected);room.emit(RoomEvent.ActiveSpeakersChanged);
    expect(mocks.play).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(201);room.remoteParticipants.set(peer.identity,peer);room.emit(RoomEvent.ParticipantConnected,peer);
    room.remoteParticipants.clear();room.emit(RoomEvent.ParticipantDisconnected,peer);
    expect(mocks.play.mock.calls.slice(-2)).toEqual([['enter',true],['exit',true]]);
  });
});
