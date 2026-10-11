import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import type {FootstepEvent} from '@wangxu/shared';
const state=vi.hoisted(()=>({settings:{volume:.5,muted:false},changed:()=>{},bind:vi.fn()}));
vi.mock('../apps/web/src/settings',()=>({getEffectSettings:()=>state.settings,subscribeEffectSettings:(callback:()=>void)=>{state.changed=callback;return()=>{};}}));
vi.mock('../apps/web/src/audio-devices',()=>({bindAudioContext:state.bind}));

const parameter=()=>({value:0,setTargetAtTime:vi.fn()});
class Node {
  connect=vi.fn();disconnect=vi.fn();
  gain=parameter();frequency=parameter();positionX=parameter();positionY=parameter();positionZ=parameter();
  playbackRate=parameter();panningModel='';rolloffFactor=1;type='';buffer:unknown;
  onended:(()=>void)|null=null;start=vi.fn();stop=vi.fn(()=>this.onended?.());
}
class Context {
  static latest:Context;
  state='running';currentTime=1;destination={};
  sources:Node[]=[];panners:Node[]=[];filters:Node[]=[];
  constructor(){Context.latest=this;}
  resume=vi.fn(async()=>{});decodeAudioData=vi.fn(async()=>({duration:.2}));
  createBufferSource(){const node=new Node();this.sources.push(node);return node;}
  createGain(){return new Node();}
  createPanner(){const node=new Node();this.panners.push(node);return node;}
  createBiquadFilter(){const node=new Node();this.filters.push(node);return node;}
}
const event=(overrides:Partial<FootstepEvent>={}):FootstepEvent=>({id:1,at:1,surface:'stone',pace:'normal',own:false,direction:4,distance:'near',occluded:false,...overrides} as FootstepEvent);

describe('native audio graph without browser/device playback',()=>{
  beforeEach(()=>{
    vi.resetModules();state.settings={volume:.5,muted:false};state.bind.mockClear();
    vi.stubGlobal('AudioContext',Context);vi.stubGlobal('document',{hidden:false});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
  async function player(){
    const player=await import('../apps/web/src/sound-player');player.unlockEffects();
    await vi.waitFor(()=>expect(Context.latest.decodeAudioData).toHaveBeenCalledTimes(14));
    // All decodes complete before testing synchronous event playback.
    await Promise.resolve();return player;
  }
  it('decodes once, binds device routing, uses HRTF and muffles only obstructed remote footsteps',async()=>{
    const p=await player(),ctx=Context.latest;p.preloadSounds();
    expect(fetch).toHaveBeenCalledTimes(14);expect(state.bind).toHaveBeenCalled();
    p.playFootsteps([event({occluded:true})]);
    expect(ctx.panners[0].panningModel).toBe('HRTF');expect(ctx.panners[0].rolloffFactor).toBe(0);
    expect(ctx.panners[0].positionX.value).toBe(1);expect(ctx.panners[0].positionZ.value).toBeCloseTo(0);
    expect(ctx.filters[0].frequency.value).toBe(1400);
    const source=ctx.sources[0];expect(source.playbackRate.value).toBeGreaterThanOrEqual(.97);expect(source.playbackRate.value).toBeLessThanOrEqual(1.03);
    p.playFootsteps([{id:2,at:1,surface:'stone',pace:'normal',own:true}]);
    expect(ctx.panners).toHaveLength(1);expect(ctx.filters).toHaveLength(1);
    source.onended?.();expect(source.disconnect).toHaveBeenCalled();
  });
  it('caps footsteps at 16, keeps nearer and own sounds, and releases them on reset',async()=>{
    const p=await player(),ctx=Context.latest;
    p.playFootsteps(Array.from({length:16},()=>event({distance:'far'})));
    expect(ctx.sources.filter(s=>!s.stop.mock.calls.length)).toHaveLength(16);
    p.playFootsteps([event({distance:'near'})]);expect(ctx.sources[0].stop).toHaveBeenCalled();
    p.playFootsteps([{id:2,at:1,surface:'stone',pace:'normal',own:true}]);
    expect(ctx.sources.filter(s=>!s.stop.mock.calls.length)).toHaveLength(16);
    p.stopFootsteps();expect(ctx.sources.every(s=>s.stop.mock.calls.length>0)).toBe(true);
    const q=await player();q.playFootsteps(Array.from({length:16},()=>event({distance:'near'})));
    const count=ctx.sources.length;q.playFootsteps([event({distance:'far'})]);expect(ctx.sources).toHaveLength(count);
  });
  it('honors zero, mute and visibility, updates active volume, and preserves UI cues during footstep reset',async()=>{
    const p=await player(),ctx=Context.latest;
    p.playLobbySound('enter');const ui=ctx.sources[0];p.stopFootsteps();expect(ui.stop).not.toHaveBeenCalled();
    state.settings.volume=.8;state.changed();
    expect((ui.connect.mock.calls[0][0] as Node).gain.setTargetAtTime).toHaveBeenCalledWith(.8*.65,1,.015);
    state.settings.muted=true;state.changed();expect(ui.stop).toHaveBeenCalled();
    p.playLobbySound('mic-on');p.playFootsteps([event()]);expect(ctx.sources).toHaveLength(1);
    state.settings.muted=false;state.settings.volume=0;p.playLobbySound('mic-off');expect(ctx.sources).toHaveLength(1);
    state.settings.volume=.5;vi.stubGlobal('document',{hidden:true});p.playFootsteps([event()]);expect(ctx.sources).toHaveLength(1);
  });
  it('does not replay an event after a late decoder and avoids consecutive sample repeats',async()=>{
    let decode!:(value:unknown)=>void;
    const p=await import('../apps/web/src/sound-player');p.unlockEffects();
    Context.latest.decodeAudioData.mockImplementationOnce(()=>new Promise(resolve=>{decode=resolve as typeof decode;}));
    // The first decode is the enter cue; keep it pending while the other assets load.
    await vi.waitFor(()=>expect(decode).toBeTypeOf('function'));
    p.playLobbySound('enter');expect(Context.latest.sources).toHaveLength(0);
    decode({duration:.32});await Promise.resolve();await Promise.resolve();
    expect(Context.latest.sources).toHaveLength(0);
    p.playFootsteps([event(),event()]);
    const first=Context.latest.sources[0],second=Context.latest.sources[1];
    expect(first.buffer).not.toBe(second.buffer);
  });
});
