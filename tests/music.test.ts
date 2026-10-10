import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MUSIC,phaseMusic,tutorialMusic} from '../apps/web/src/music-catalog';
import {GameEngine,getConfig} from '@wangxu/rules';

describe('complete original scene score',()=>{
  it('ships distinct, verified audio for every screen and tutorial stage',()=>{
    const manifest=JSON.parse(readFileSync('apps/web/public/audio/manifest.json','utf8'));
    expect(manifest.costRmb).toBe(0);expect(manifest.license).toBe('CC0-1.0');
    expect(manifest.tracks.map((track:{scene:string})=>track.scene).sort()).toEqual(Object.keys(MUSIC).sort());
    const hashes=new Set<string>();
    for(const track of manifest.tracks){const data=readFileSync(`apps/web/public${track.file}`);expect(data.length).toBe(track.bytes);expect(createHash('sha256').update(data).digest('hex')).toBe(track.sha256);expect(track.durationSeconds).toBeGreaterThan(25);expect(track.rms).toBeGreaterThan(.05);expect(track.peak).toBeLessThan(.99);hashes.add(track.sha256);}
    expect(hashes.size).toBe(Object.keys(MUSIC).length);expect(tutorialMusic).toHaveLength(6);
  });
  it('covers all authoritative phases and personal victory, loss and invalid settlement',()=>{
    const engine=new GameEngine({roomId:'score-test',invite:'SCORE',config:getConfig(4),seed:1});
    for(let index=0;index<4;index++)engine.addPlayer({id:`score-${index}`,name:`Player ${index}`});
    for(const phase of ['LOBBY','PREP','EXPLORE','DISCUSS','VOTE','DRAFT','EXTRACT'] as const){engine.phase=phase;expect(MUSIC[phaseMusic(engine.viewFor('score-0'))]).toBeDefined();}
    const view=engine.viewFor('score-0');
    for(const winner of ['human','wolf'] as const){const result={winner,reason:'score test'} as NonNullable<typeof view.result>;expect(phaseMusic({...view,phase:'RESULT',self:{...view.self,faction:winner},result})).toBe('victory');expect(phaseMusic({...view,phase:'RESULT',self:{...view.self,faction:winner==='human'?'wolf':'human'},result})).toBe('defeat');}
    expect(phaseMusic({...view,phase:'RESULT',result:{winner:'invalid',reason:'invalid'} as NonNullable<typeof view.result>})).toBe('defeat');
  });
});
