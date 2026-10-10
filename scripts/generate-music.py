"""Render the original Soulwisp score. Requires numpy and ffmpeg; no network assets."""
from pathlib import Path
import hashlib
import json
import math
import subprocess
import tempfile
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'apps/web/public/audio'
RATE = 24000
# Distinct keys, tempi, orchestration and melodic contours for every screen/phase.
SCORES = [
    ('welcome', '余灯未眠', 68, 47, 'minor', 'harp', 0.0),
    ('camp', '织絮的市集', 84, 48, 'major', 'flute', .18),
    ('craft', '记忆的织机', 92, 53, 'major', 'harp', .25),
    ('research', '银絮的秘闻', 62, 49, 'minor', 'bell', 0.0),
    ('rooms', '召灯的信号', 80, 50, 'minor', 'bell', .25),
    ('lobby', '同行的脚步', 96, 48, 'major', 'harp', .4),
    ('tutorial', '艾琳的记忆', 72, 52, 'minor', 'bell', 0.0),
    ('engineering', '点灯之手', 88, 55, 'major', 'harp', .22),
    ('combat', '石城试炼', 112, 43, 'minor', 'strings', .65),
    ('prep', '最后的暖光', 86, 45, 'minor', 'strings', .45),
    ('explore', '灰月石城', 98, 42, 'minor', 'harp', .38),
    ('discuss', '灯下的证词', 60, 46, 'minor', 'piano', 0.0),
    ('vote', '悬而未决', 104, 41, 'minor', 'piano', .4),
    ('draft', '编织余灯', 94, 55, 'major', 'bell', .14),
    ('extract', '归途终钟', 132, 45, 'minor', 'strings', .8),
    ('victory', '灯火归来', 104, 50, 'major', 'bell', .4),
    ('defeat', '月蚀之后', 56, 40, 'minor', 'piano', 0.0),
    ('connecting', '远处的回声', 64, 44, 'minor', 'bell', 0.0),
    ('auth', '留下归灯之名', 70, 51, 'minor', 'piano', 0.0),
]

def frequency(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def render(index, bpm, root, mode, instrument, percussion):
    beat = 60 / bpm
    count = round(64 * beat * RATE)
    mix = np.zeros((count, 2), dtype=np.float64)
    rng = np.random.default_rng(1073 + index * 137)
    scale = [0, 2, 4, 5, 7, 9, 11] if mode == 'major' else [0, 2, 3, 5, 7, 8, 10]
    progression = [0, 4, 5, 3, 0, 5, 3, 4] if mode == 'major' else [0, 5, 3, 6, 0, 3, 5, 4]

    def add(samples, position, level, pan=0):
        start = round(position * RATE)
        indices = (np.arange(len(samples)) + start) % count
        np.add.at(mix[:, 0], indices, samples * level * math.sqrt((1 - pan) / 2))
        np.add.at(mix[:, 1], indices, samples * level * math.sqrt((1 + pan) / 2))

    def voice(midi, duration, kind):
        t = np.arange(round(duration * RATE)) / RATE
        hz = frequency(midi)
        phase = 2 * np.pi * hz * t
        if kind == 'pad':
            sound = sum(np.sin(phase * h + .004 * h * np.sin(2*np.pi*.21*t)) / h**2 for h in range(1, 6))
            sound += .25 * np.sin(phase * 1.002 + .4)
            return sound * np.sin(np.pi * t / duration)**1.3
        if kind == 'bell':
            sound = np.sin(phase) * np.exp(-t*2.5) + .38*np.sin(phase*2.01)*np.exp(-t*4) + .13*np.sin(phase*4.13)*np.exp(-t*7)
        elif kind == 'piano':
            sound = sum(np.sin(phase*h + h*.17)*np.exp(-t*(1.2+h*.45))/h**1.5 for h in range(1, 7))
        elif kind == 'flute':
            sound = (np.sin(phase+.015*np.sin(t*2*np.pi*5)) + .18*np.sin(phase*2)) * np.sin(np.pi*t/duration)**1.4
        elif kind == 'strings':
            sound = sum(np.sin(phase*h+.03*np.sin(t*2*np.pi*4.7))/h**1.6 for h in range(1, 7)) * np.sin(np.pi*t/duration)**.8
        elif kind == 'bass':
            sound = (np.sin(phase)+.18*np.sin(phase*2)) * np.exp(-t*3/duration)
        else:
            sound = sum(np.sin(phase*h)*np.exp(-t*(1.8+h*.7))/h**1.8 for h in range(1, 6))
        return sound * (1-np.exp(-t*70)) * np.minimum(1,(duration-t)/.05)

    for bar, degree in enumerate(progression):
        position = bar * 8 * beat
        for chord_voice, offset in enumerate([0, 2, 4, 6]):
            note_degree = degree + offset
            midi = root + 12 + scale[note_degree % 7] + (note_degree//7)*12
            add(voice(midi, 9*beat, 'pad'), position, .052 if chord_voice < 3 else .015, [-.65, .6, -.15, .2][chord_voice])
        for pulse in range(8):
            time = position + pulse * beat
            if pulse % 2 == 0:
                add(voice(root + scale[degree], beat*1.5, 'bass'), time, .075, -.06)
            if instrument in ['harp', 'strings'] or pulse % 2 == 0:
                contour = [0, 2, 4, 6, 4, 2, 1, 4] if bar%2 == 0 else [4, 3, 2, 0, 2, 4, 6, 2]
                melodic_degree = degree + contour[(pulse + index%3)%8]
                midi = root + 24 + scale[melodic_degree%7] + (melodic_degree//7)*12
                add(voice(midi, min(2.5, beat*(1.7 if instrument!='strings' else .85)), instrument), time+.03, .058 if instrument!='strings' else .046, .3*np.sin((pulse+bar)*1.2))
            if percussion:
                t = np.arange(round(.22*RATE))/RATE
                if pulse%2 == 0:
                    phase = 2*np.pi*(45*t + 65*.025*(1-np.exp(-t/.025)))
                    kick = np.sin(phase)*np.exp(-t*24)*(1-np.exp(-t*250))
                    add(kick, time, .11*percussion, 0)
                else:
                    brush = rng.standard_normal(len(t))*np.exp(-t*38)
                    brush = np.convolve(brush,np.ones(9)/9,mode='same')
                    add(brush, time, .06*percussion, .25)
                if percussion > .6:
                    add(voice(root+12+scale[(degree+4)%7],beat*.3,'harp'),time+beat*.5,.028,-.25)
        # A recognisable rising Returnlight motif, varied in register and phrasing.
        for motif_index, offset in enumerate([0, 2, 4, 2] if mode=='major' else [0, 2, 4, 1]):
            if bar%2 == index%2:
                midi = root+36+scale[(degree+offset)%7]
                add(voice(midi,beat*2.3,'bell' if instrument=='harp' else instrument),position+(motif_index*1.5+.5)*beat,.036,.1)
    dry = mix.copy()
    for delay, amount in [(.113,.17),(.239,.13),(.421,.09),(.673,.06),(.911,.035)]:
        mix[:,0] += np.roll(dry[:,1],round(delay*RATE))*amount
        mix[:,1] += np.roll(dry[:,0],round((delay+.027)*RATE))*amount
    mix = np.tanh(mix*1.5)
    rms = np.sqrt(np.mean(mix**2))
    mix *= min(.18/max(rms,.0001),.84/max(np.max(np.abs(mix)),.0001))
    return mix

def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    tracks=[]
    for index,(scene,title,bpm,root,mode,instrument,percussion) in enumerate(SCORES):
        samples=render(index,bpm,root,mode,instrument,percussion)
        with tempfile.TemporaryDirectory(prefix='soulwisp-score-') as temporary:
            source=Path(temporary)/'score.wav'
            with wave.open(str(source),'wb') as wav:
                wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(RATE)
                wav.writeframes((samples*32767).astype('<i2').tobytes())
            target=OUTPUT/f'{scene}.mp3'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-codec:a','libmp3lame','-q:a','5','-metadata',f'title={title}','-metadata','artist=Soulwisp: Returnlight',str(target)],check=True)
        tracks.append(dict(scene=scene,title=title,bpm=bpm,durationSeconds=round(len(samples)/RATE,3),file=f'/audio/{scene}.mp3',bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest(),peak=round(float(np.max(np.abs(samples))),4),rms=round(float(np.sqrt(np.mean(samples**2))),4)))
        print(f'{scene}: {tracks[-1]["durationSeconds"]}s')
    manifest=dict(project='Soulwisp: Returnlight',license='CC0-1.0',origin='Original procedural compositions rendered by scripts/generate-music.py; no sampled third-party recordings.',costRmb=0,tracks=tracks)
    (OUTPUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (OUTPUT/'LICENSE.txt').write_text('Soulwisp: Returnlight original procedural score\n\nAll MP3 compositions in this folder are dedicated to the public domain under CC0 1.0 Universal.\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\nGenerated from the included deterministic score; no third-party recordings or samples.\n')

if __name__=='__main__':
    main()
