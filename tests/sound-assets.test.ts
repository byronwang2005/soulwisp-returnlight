import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AUDIO_MIX} from '../apps/web/src/audio-mix';

function wav(file:string){
  const data=readFileSync(`apps/web/public${file}`);
  expect(data.toString('ascii',0,4)).toBe('RIFF');expect(data.toString('ascii',8,12)).toBe('WAVE');
  expect(data.readUInt16LE(20)).toBe(1);expect(data.readUInt16LE(34)).toBe(16);
  const channels=data.readUInt16LE(22),rate=data.readUInt32LE(24),samples:number[]=[];
  for(let i=44;i<data.length;i+=2)samples.push(data.readInt16LE(i)/32767);
  let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));let start=0,end=samples.length-1;
  while(Math.abs(samples[start])<=peak*.01)start++;
  while(Math.abs(samples[end])<=peak*.01)end--;
  let squared=0;for(let i=start;i<=end;i++)squared+=samples[i]**2;
  let energy=0,difference=0;for(let i=1;i<samples.length;i++){energy+=samples[i]**2;difference+=(samples[i]-samples[i-1])**2;}
  return {data,channels,rate,peak,differenceRatio:difference/energy,rms:Math.sqrt(squared/(end-start+1)),duration:samples.length/channels/rate};
}
describe('self-hosted, licensed and calibrated effect assets',()=>{
  const manifest=JSON.parse(readFileSync('apps/web/public/audio/sfx/manifest.json','utf8'));
  it('ships four distinct cues and five distinct samples per material, with verified WAV data and hashes',()=>{
    expect(manifest.license).toBe('CC0-1.0');expect(manifest.costRmb).toBe(0);
    expect(manifest.assets).toHaveLength(16);
    const hashes=new Set<string>();
    for(const asset of manifest.assets){
      const decoded=wav(asset.file);expect(decoded.channels).toBe(1);expect(decoded.rate).toBe(24000);
      expect(decoded.data.length).toBe(asset.bytes);expect(createHash('sha256').update(decoded.data).digest('hex')).toBe(asset.sha256);
      expect(decoded.duration).toBeCloseTo(asset.durationSeconds,5);expect(decoded.peak).toBeLessThanOrEqual(.8501);
      expect(decoded.rms).toBeCloseTo(asset.activeRms,3);hashes.add(asset.sha256);
    }
    expect(hashes.size).toBe(16);
    expect(manifest.assets.filter((a:{file:string})=>a.file.includes('/stone-'))).toHaveLength(5);
    expect(manifest.assets.filter((a:{file:string})=>a.file.includes('/cobble-'))).toHaveLength(5);
    expect(manifest.assets.slice(0,4).map((a:{durationSeconds:number})=>a.durationSeconds)).toEqual([.32,.28,.15,.13]);
    expect(manifest.sources.every((s:{license:string;sha256:string})=>s.license==='CC0-1.0'&&s.sha256.length===64)).toBe(true);
  });
  it('rounds corridor transients and gives sword layers enough body at the shared volume',()=>{
    for(const asset of manifest.assets.filter((a:{file:string})=>a.file.includes('/cobble-')))
      expect(wav(asset.file).differenceRatio).toBeLessThan(.04);
    expect(wav('/audio/sfx/combat-swing.wav').rms).toBeGreaterThan(.29);
    expect(wav('/audio/sfx/combat-hit.wav').rms*AUDIO_MIX.combatHit*.6).toBeGreaterThan(.30);
  });
  it('meets the 50/50 mix margins using actual WAV samples and the recorded decoded score RMS',()=>{
    expect(AUDIO_MIX.music).toBe(manifest.calibration.musicGain);expect(AUDIO_MIX.effects).toBe(manifest.calibration.effectsGain);
    const music=Math.max(...Object.values(manifest.calibration.musicRmsDecoded) as number[])*.5*AUDIO_MIX.music;
    for(const asset of manifest.assets){
      const ui=asset.file.includes('lobby-');const level=wav(asset.file).rms*.5*AUDIO_MIX.effects*(ui?AUDIO_MIX.lobby:10**(-3/20));
      expect(20*Math.log10(level/music)).toBeGreaterThanOrEqual(ui?10:6);
    }
    for(const preview of manifest.previews){
      const decoded=wav(preview.file);expect(decoded.channels).toBe(2);expect(decoded.peak).toBeLessThan(1);
      expect(createHash('sha256').update(decoded.data).digest('hex')).toBe(preview.sha256);
      expect(preview.effectsPeak).toBeLessThanOrEqual(AUDIO_MIX.peakLimit);
    }
    expect(manifest.calibration.lobbyGain).toBe(AUDIO_MIX.lobby);
    expect(manifest.calibration.combatHitGain).toBe(AUDIO_MIX.combatHit);
    expect(manifest.calibration.feedbackGainDb.collision).toBe(3);
    expect(manifest.calibration.feedbackGainDb.pickup).toBe(6);
    const high=manifest.previews.find((preview:{file:string})=>preview.file.includes('feedback-100'));
    expect(high.slider).toBe(1);expect(high.timeline.filter((cue:{at:number})=>cue.at===12)).toHaveLength(4);
    const lobby=manifest.previews.find((preview:{file:string})=>preview.file.includes('lobby-50'));
    expect(lobby.timeline.every((cue:{gain:number})=>cue.gain===AUDIO_MIX.lobby)).toBe(true);
  });
});
