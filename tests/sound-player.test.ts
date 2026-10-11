import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {AUDIO_MIX,feedbackLevel,peakLimitCurve} from '../apps/web/src/audio-mix';
import type {FootstepEvent} from '@wangxu/shared';
const state=vi.hoisted(()=>({settings:{volume:.5,muted:false},changed:()=>{},bind:vi.fn()}));
vi.mock('../apps/web/src/settings',()=>({getEffectSettings:()=>state.settings,subscribeEffectSettings:(callback:()=>void)=>{state.changed=callback;return()=>{};}}));
vi.mock('../apps/web/src/audio-devices',()=>({bindAudioContext:state.bind}));

const parameter=()=>({value:0,setTargetAtTime:vi.fn(),setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
class Node {
  connect=vi.fn();disconnect=vi.fn();
  pan=parameter();gain=parameter();frequency=parameter();positionX=parameter();positionY=parameter();positionZ=parameter();
  threshold=parameter();knee=parameter();ratio=parameter();attack=parameter();release=parameter();curve:Float32Array|null=null;oversample='';
  playbackRate=parameter();panningModel='';rolloffFactor=1;type='';buffer:unknown;
  onended:(()=>void)|null=null;start=vi.fn();stop=vi.fn((at?:number)=>{if(at===undefined)this.onended?.();});
}
class Context {
  static latest:Context;
  state='running';currentTime=1;sampleRate=24000;destination={};compressors:Node[]=[];guards:Node[]=[];oscillators:Node[]=[];
  sources:Node[]=[];panners:Node[]=[];filters:Node[]=[];
  constructor(){Context.latest=this;}
  resume=vi.fn(async()=>{});decodeAudioData=vi.fn(async()=>({duration:.2}));
  createDynamicsCompressor(){const node=new Node();this.compressors.push(node);return node;}
  createWaveShaper(){const node=new Node();this.guards.push(node);return node;}
  createOscillator(){const node=new Node();this.oscillators.push(node);return node;}
  createBuffer(_channels:number,length:number){return {getChannelData:()=>new Float32Array(length)};}
  createBufferSource(){const node=new Node();this.sources.push(node);return node;}
  createGain(){return new Node();}
  createStereoPanner(){const node=new Node();this.panners.push(node);return node;}
  createPanner(){const node=new Node();this.panners.push(node);return node;}
  createBiquadFilter(){const node=new Node();this.filters.push(node);return node;}
}
const event=(overrides:Partial<FootstepEvent>={}):FootstepEvent=>({id:1,at:1,surface:'stone',pace:'normal',own:false,direction:4,distance:'near',occluded:false,...overrides} as FootstepEvent);

describe('native audio graph without browser/device playback',()=>{
  beforeEach(()=>{
    vi.resetModules();state.settings={volume:.5,muted:false};state.bind.mockClear();
    vi.stubGlobal('AudioContext',Context);const events=new EventTarget();vi.stubGlobal('document',{hidden:false,addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));
  });
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
  async function player(){
    const player=await import('../apps/web/src/sound-player');player.unlockEffects();
    await vi.waitFor(()=>expect(Context.latest.decodeAudioData).toHaveBeenCalledTimes(16));
    // All decodes complete before testing synchronous event playback.
    await Promise.resolve();return player;
  }
  it('decodes once, binds device routing, uses HRTF and muffles only obstructed remote footsteps',async()=>{
    const p=await player(),ctx=Context.latest;p.preloadSounds();
    expect(fetch).toHaveBeenCalledTimes(16);expect(state.bind).toHaveBeenCalled();
    p.playFootsteps([event({occluded:true})]);
    expect(ctx.panners[0].panningModel).toBe('HRTF');expect(ctx.panners[0].rolloffFactor).toBe(0);
    expect(ctx.panners[0].positionX.value).toBe(1);expect(ctx.panners[0].positionZ.value).toBeCloseTo(0);
    expect(ctx.filters[0].frequency.value).toBe(1400);
    const source=ctx.sources[0];expect(source.playbackRate.value).toBeGreaterThanOrEqual(.97);expect(source.playbackRate.value).toBeLessThanOrEqual(1.03);
    p.playFootsteps([{id:2,at:1,surface:'stone',pace:'normal',own:true}]);
    expect(ctx.panners).toHaveLength(1);expect(ctx.filters).toHaveLength(1);
    source.onended?.();expect(source.disconnect).toHaveBeenCalled();
  });
  it('plays stronger combat samples through the shared gain, pan and mute controls',async()=>{
    const p=await player(),ctx=Context.latest;
    p.playCombatSound('swing');p.playCombatSound('hit',.75,.4);
    expect(ctx.sources).toHaveLength(2);
    expect((ctx.sources[0].connect.mock.calls[0][0] as Node).gain.value).toBeCloseTo(.5*.65);
    expect((ctx.sources[1].connect.mock.calls[0][0] as Node).gain.value).toBeCloseTo(.5*.65*.75*AUDIO_MIX.combatHit);
    expect(ctx.panners[0].pan.value).toBe(.4);
    state.settings.muted=true;state.changed();expect(ctx.sources.every(s=>s.stop.mock.calls.length)).toBe(true);
    p.playCombatSound('swing');expect(ctx.sources).toHaveLength(2);
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
    expect((ui.connect.mock.calls[0][0] as Node).gain.setTargetAtTime).toHaveBeenCalledWith(.8*.65*AUDIO_MIX.lobby,1,.015);
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
  it('boosts categories and remote cues without changing footsteps or swing, and shares a bounded bus',async()=>{
    const p=await player(),ctx=Context.latest;
    p.playLobbySound('enter');p.playLobbySound('enter',true);p.playFootsteps([{id:2,at:1,surface:'stone',pace:'normal',own:true}]);p.playCombatSound('swing');
    const gains=ctx.sources.map(source=>(source.connect.mock.calls[0][0] as Node).gain.value);
    expect(gains[0]).toBeCloseTo(.5*.65*10**(3/20));expect(gains[1]/gains[0]).toBeCloseTo(10**(-3/20));
    expect(gains[2]).toBeCloseTo(.5*.65*10**(-3/20));expect(gains[3]).toBeCloseTo(.5*.65);
    expect(ctx.compressors).toHaveLength(1);expect(ctx.guards).toHaveLength(1);
    expect(ctx.compressors[0].threshold.value).toBe(-3);expect(ctx.compressors[0].ratio.value).toBe(20);
    const curve=peakLimitCurve();expect(Math.max(...curve)).toBeLessThanOrEqual(.95001);expect(Math.min(...curve)).toBeGreaterThanOrEqual(-.95001);
    expect(curve[3072]).toBe(.5);
    expect(feedbackLevel('collision')).toBeCloseTo(10**(3/20));expect(feedbackLevel('pickup')).toBeCloseTo(10**(6/20));
  });
  it('updates, mutes and releases synthesized feedback including scheduled tones and hidden pages',async()=>{
    const p=await player(),ctx=Context.latest,effects=await import('../apps/web/src/effects');
    effects.playFeedback('pickup',.5);expect(ctx.oscillators).toHaveLength(2);
    const gain=(ctx.oscillators[0].connect.mock.calls[0][0] as Node).connect.mock.calls[0][0] as Node;
    expect(gain.gain.value).toBeCloseTo(.5*.65*10**(6/20));
    state.settings.volume=.8;state.changed();expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(.8*.65*10**(6/20),1,.015);
    state.settings.muted=true;state.changed();expect(ctx.oscillators.every(node=>node.stop.mock.calls.some(call=>call.length===0))).toBe(true);
    expect(gain.disconnect).toHaveBeenCalled();
    state.settings.muted=false;effects.playFeedback('pickup',.8);p.playLobbySound('enter');
    Object.assign(document,{hidden:true});document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.oscillators.every(node=>node.stop.mock.calls.some(call=>call.length===0))).toBe(true);
    expect(ctx.sources.at(-1)?.stop).toHaveBeenCalled();
    const count=ctx.oscillators.length;effects.playFeedback('pickup',.8);expect(ctx.oscillators).toHaveLength(count);
  });
});
