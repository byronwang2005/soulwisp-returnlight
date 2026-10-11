import {describe,it,expect} from 'vitest';
import {AttackAudioMarker} from '../apps/web/src/attack-audio';
describe('blade sound follows the animation clock',()=>{
  it('waits through wind-up and hit-stop, then fires once even across a skipped frame',()=>{
    const marker=new AttackAudioMarker();marker.start(0,32/30);
    expect(marker.take(.1,60)).toBe(false);
    expect(marker.take(.1,108)).toBe(false);
    expect(marker.take(.23,180)).toBe(true);
    expect(marker.take(.5,300)).toBe(false);
  });
  it('rearms on consecutive attacks and cancels interrupted or stale cues',()=>{
    const marker=new AttackAudioMarker();marker.start(0,1);expect(marker.take(.2,150)).toBe(true);
    marker.start(200,1);expect(marker.take(.01,210)).toBe(false);expect(marker.take(.2,350)).toBe(true);
    marker.start(400,1);marker.clear();expect(marker.take(.2,550)).toBe(false);
    marker.start(600,1);expect(marker.take(.2,1400)).toBe(false);expect(marker.take(.3,1410)).toBe(false);
  });
});
