"""Render calibrated CC0 effects and review mixes. Requires numpy and ffmpeg.

Run with --download once to cache the pinned upstream archives in .local.
Subsequent renders use the cache and do not contact upstream services.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json
import math
import subprocess
import urllib.request
import wave
import zipfile
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'apps/web/public/audio/sfx'
CACHE = ROOT / '.local/audio-sources'
RATE = 24000
MUSIC_GAIN, EFFECT_GAIN = .20, .65
LOBBY_GAIN, HIT_GAIN, PEAK_LIMIT = 10**(3/20), 1.4*10**(3/20), .95
SOURCES = [
    {'name': 'Kenney Impact Sounds 1.0', 'author': 'Kenney', 'license': 'CC0-1.0',
     'page': 'https://kenney.nl/assets/impact-sounds',
     'url': 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
     'sha256': '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8', 'cache': 'kenney.zip'},
    {'name': 'Different steps on wood, stone, leaves, gravel and mud', 'author': 'TinyWorlds / pdsounds.org', 'license': 'CC0-1.0',
     'page': 'https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud',
     'url': 'https://opengameart.org/sites/default/files/%5Bkdd%5DDifferentSteps_0.zip',
     'sha256': '987d072b7deaa65177e005ddd8185f2351be7c9a76cd7575dea560549c39b33b', 'cache': 'tinyworlds.zip'},
]

def decode(data, channels=1, filters=None):
    command = ['ffmpeg', '-v', 'error', '-i', 'pipe:0']
    if filters:
        command += ['-af', filters]
    raw = subprocess.run(command + ['-ar', str(RATE), '-ac', str(channels), '-f', 'f32le', 'pipe:1'],
                         input=data, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4').astype(np.float64).reshape(-1, channels)

def active_rms(samples):
    mono_peak = np.max(np.abs(samples), axis=1) if samples.ndim == 2 else np.abs(samples)
    active = np.flatnonzero(mono_peak > np.max(mono_peak) * .01)
    return float(np.sqrt(np.mean(samples[active[0]:active[-1]+1] ** 2))) if len(active) else 0

def calibrate(samples, target):
    # Remove DC, trim source silence, retain a short release, and bound transients.
    samples = samples - np.mean(samples)
    active = np.flatnonzero(np.abs(samples) > np.max(np.abs(samples)) * .01)
    samples = samples[max(0, active[0]-round(.003*RATE)):min(len(samples), active[-1]+round(.015*RATE))]
    fade = min(round(.004*RATE), len(samples)//4)
    samples[:fade] *= np.linspace(0, 1, fade)
    samples[-fade:] *= np.linspace(1, 0, fade)
    for _ in range(4):
        samples *= target / active_rms(samples)
        samples = np.clip(samples, -.85, .85)
    return samples

def write_wav(path, samples):
    samples = np.asarray(samples)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1 if samples.ndim == 1 else samples.shape[1])
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes((np.clip(samples, -1, 1)*32767).astype('<i2').tobytes())

def bell(buffer, hz, start, duration, amplitude=1):
    t = np.arange(round(duration*RATE))/RATE
    envelope = (1-np.exp(-t*750))*np.exp(-t*14)*np.minimum(1, (duration-t)/.018)
    signal = (np.sin(2*np.pi*hz*t)+.22*np.sin(2*np.pi*hz*2.01*t)+.06*np.sin(2*np.pi*hz*3.98*t))*envelope
    offset = round(start*RATE)
    buffer[offset:offset+len(signal)] += signal*amplitude

def feedback_samples():
    """Render the runtime tone/noise definitions for offline mix inspection."""
    presets = json.loads((ROOT / 'apps/web/src/feedback-sounds.json').read_text())
    sounds = {}
    rng = np.random.default_rng(20261011)
    for kind, preset in presets.items():
        signal = np.zeros(RATE)
        for hz, end, duration, shape, delay, amplitude in preset.get('tones', []):
            t = np.arange(round((duration+.015)*RATE))/RATE
            ramp = math.log(max(25,end)/hz)/duration
            phase = 2*np.pi*hz*(np.exp(ramp*t)-1)/ramp if abs(ramp)>1e-10 else 2*np.pi*hz*t
            wave = np.sin(phase) if shape=='sine' else 2/np.pi*np.arcsin(np.sin(phase))
            envelope = np.where(t<.008, .0001*np.exp(math.log(amplitude/.0001)*t/.008),
                                amplitude*np.exp(math.log(.0001/amplitude)*(t-.008)/(duration-.008)))
            start = round(delay*RATE)
            signal[start:start+len(t)] += wave*envelope
        for duration, cutoff, amplitude, high in preset.get('noises', []):
            length = math.ceil(duration*RATE)
            t = np.arange(length)/RATE
            noise = (rng.random(length)*2-1)*(1-np.arange(length)/length)
            # Offline filters use the runtime cutoff; browser coefficients may differ.
            filter_name = 'highpass' if high else 'lowpass'
            raw = subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(RATE),'-ac','1','-i','pipe:0',
                                  '-af',f'{filter_name}=f={cutoff}', '-f','f32le','pipe:1'],
                                 input=noise.astype('<f4').tobytes(),check=True,capture_output=True).stdout
            filtered = np.frombuffer(raw,dtype='<f4')
            envelope = amplitude*np.exp(math.log(.0001/amplitude)*t/duration)
            signal[:length] += filtered*envelope
        sounds['feedback-'+kind] = signal[:np.flatnonzero(np.abs(signal)>.00001)[-1]+1]
    return sounds

def lobby(kind):
    duration = {'enter':.32, 'exit':.28, 'mic-on':.15, 'mic-off':.13}[kind]
    signal = np.zeros(round(duration*RATE))
    if kind == 'enter':
        bell(signal, 523.25, 0, .22)
        bell(signal, 783.99, .10, .22, .85)
    elif kind == 'exit':
        bell(signal, 659.25, 0, .19, .85)
        bell(signal, 440, .09, .19)
    else:
        t = np.arange(len(signal))/RATE
        rng = np.random.default_rng(20261011+(kind == 'mic-off'))
        signal += rng.normal(0, .16, len(t))*np.exp(-t*240)*np.minimum(1, t/.001)
        bell(signal, 880 if kind == 'mic-on' else 330, .012, duration-.012, .7)
    # Preserve the declared UI duration after calibration.
    calibrated = calibrate(signal, .30)
    return np.pad(calibrated[:len(signal)], (0, max(0, len(signal)-len(calibrated))))

def metadata(path, samples, **extra):
    data = path.read_bytes()
    return {'file': '/audio/sfx/'+path.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'durationSeconds': round(len(samples)/RATE, 6), 'channels': 1 if samples.ndim == 1 else samples.shape[1],
            'peak': round(float(np.max(np.abs(samples))), 6), 'activeRms': round(active_rms(samples), 6), **extra}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--previews-only', action='store_true', help='Keep existing runtime assets byte-for-byte')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archives = []
    for source in SOURCES:
        path = CACHE / source['cache']
        if args.download:
            data = urllib.request.urlopen(source['url'], timeout=30).read()
        else:
            data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != source['sha256']:
            raise ValueError('Upstream archive differs from pinned hash: '+source['name'])
        if args.download:
            path.write_bytes(data)
        archives.append(zipfile.ZipFile(io.BytesIO(data)))
    (OUTPUT / 'LICENSE.txt').write_text('All sound assets in this directory are CC0-1.0.\n'
        'Original lobby and combat cues: Soulwisp: Returnlight.\nFootsteps: Kenney Impact Sounds 1.0; TinyWorlds / pdsounds.org gravel.\n'
        'Source URLs, archive hashes and processing are recorded in manifest.json.\n'
        'CC0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode\n\n'
        + '\n'.join(line.rstrip() for line in archives[0].read('License.txt').decode().splitlines())+'\n', encoding='utf8')
    gravel = decode(archives[1].read('gravel.ogg'), filters='highpass=f=180,lowpass=f=1800')[:, 0]
    gravel = gravel[:round(.18*RATE)] * np.exp(-np.arange(min(len(gravel),round(.18*RATE)))/RATE*10)
    gravel[-round(.004*RATE):] *= np.linspace(1,0,round(.004*RATE))
    assets, sounds = [], {}
    for kind in ['enter', 'exit', 'mic-on', 'mic-off']:
        sounds['lobby-'+kind] = lobby(kind)
    for i in range(5):
        stone = decode(archives[0].read(f'Audio/footstep_concrete_{i:03d}.ogg'), filters='highpass=f=70,lowpass=f=7000')[:, 0]
        sounds[f'stone-{i}'] = calibrate(stone, .24)
        length = max(len(stone), len(gravel))
        rough = np.pad(stone, (0, length-len(stone)))
        offset = round((.012+i*.003)*RATE)
        grit = np.pad(gravel, (offset, max(0, length-len(gravel)-offset)))[:length]
        rough += grit*(np.max(np.abs(stone))/max(np.max(np.abs(gravel)), .001))*.18
        # Round off the entire sole/grit attack, not only the added gravel.
        raw = subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(RATE),'-ac','1','-i','pipe:0',
            '-af','lowpass=f=2400,lowpass=f=2400','-f','f32le','pipe:1'], input=rough.astype('<f4').tobytes(), check=True, capture_output=True).stdout
        sounds[f'cobble-{i}'] = calibrate(np.frombuffer(raw,dtype='<f4').astype(np.float64), .24)
    # Original deterministic sword layers: swept air and body; confirmed impact adds a hard transient.
    rng = np.random.default_rng(20261012)
    for kind, duration, target in [('swing',.20,.30), ('hit',.22,.38)]:
        t = np.arange(round(duration*RATE))/RATE
        air = rng.normal(0,1,len(t))
        raw = subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(RATE),'-ac','1','-i','pipe:0',
            '-af','highpass=f=180,lowpass=f=2800','-f','f32le','pipe:1'], input=air.astype('<f4').tobytes(), check=True, capture_output=True).stdout
        air = np.frombuffer(raw,dtype='<f4')
        if kind == 'swing':
            envelope = (1-np.exp(-t*100))*np.exp(-t*24)
            signal = air*envelope + .32*np.sin(2*np.pi*(210*t-240*t*t))*envelope
        else:
            envelope = (1-np.exp(-t*1200))*np.exp(-t*38)
            signal = air*envelope*.7 + np.sin(2*np.pi*(155*t-230*t*t))*np.exp(-t*24)
            signal += .16*np.sin(2*np.pi*920*t)*np.exp(-t*65)
        sounds['combat-'+kind] = calibrate(signal, target)
    for name, samples in sounds.items():
        path = OUTPUT / (name+'.wav')
        if args.previews_only:
            with wave.open(str(path)) as source:
                samples = np.frombuffer(source.readframes(source.getnframes()),dtype='<i2').astype(np.float64)/32767
            sounds[name] = samples
        else:
            write_wav(path, samples)
        source_files = [] if name.startswith(('lobby','combat')) else [f'Audio/footstep_concrete_{int(name[-1]):03d}.ogg']
        if name.startswith('cobble'):
            source_files += ['gravel.ogg']
        assets.append(metadata(path, samples, sourceFiles=source_files,
            processing='Original deterministic sword air/body/transient synthesis' if name.startswith('combat') else
            'Original deterministic bell/click synthesis' if name.startswith('lobby') else
            'Mono 24 kHz; DC removal; silence trim; 4 ms fades; stone HP 70 Hz / LP 7000 Hz; active-RMS calibration; peak <=0.85' if name.startswith('stone') else
            'Mono 24 kHz; DC removal; silence trim; 4 ms fades; high/low-pass; cobble gravel HP 180 Hz / LP 1800 Hz at 0.18 relative peak, mixed LP 2400 Hz twice; active-RMS calibration; peak <=0.85'))

    feedback = feedback_samples()
    music_manifest = json.loads((ROOT / 'apps/web/public/audio/manifest.json').read_text())
    music_rms = {}
    for track in music_manifest['tracks']:
        signal = decode((ROOT / ('apps/web/public'+track['file'])).read_bytes(), channels=2)
        music_rms[track['scene']] = float(np.sqrt(np.mean(signal**2)))
    loudest = max(music_rms.values())*.5*MUSIC_GAIN
    step_margin = min(active_rms(sounds[name])*.5*EFFECT_GAIN*10**(-3/20) for name in sounds if name.startswith(('stone','cobble')))
    lobby_margin = min(active_rms(sounds[name])*.5*EFFECT_GAIN*LOBBY_GAIN for name in sounds if name.startswith('lobby'))
    calibration = {'musicGain': MUSIC_GAIN, 'effectsGain': EFFECT_GAIN, 'slider': .5,
        'musicRmsDecoded': {key:round(value,6) for key,value in music_rms.items()},
        'minimumFootstepMarginDb': round(20*math.log10(step_margin/loudest), 3),
        'minimumLobbyMarginDb': round(20*math.log10(lobby_margin/loudest), 3),
        'lobbyGain': LOBBY_GAIN, 'combatHitGain': HIT_GAIN, 'peakLimit': PEAK_LIMIT,
        'feedbackGainDb': {kind.removeprefix('feedback-'):3 if kind=='feedback-collision' else 6 for kind in feedback},
        'rmsMethod': 'Short sounds: contiguous active span above 1% peak. Music: full decoded stereo RMS. Own normal footsteps use -3 dB gain.'}
    assert calibration['minimumFootstepMarginDb'] >= 6
    assert calibration['minimumLobbyMarginDb'] >= 10

    # Review mixes use equal-power stereo positions, not a browser's HRTF.
    music = decode((ROOT / 'apps/web/public/audio/camp.mp3').read_bytes(), channels=2)
    sounds.update(feedback)
    def preview(name, cues, slider=.5):
        length = round((max(cue[0] for cue in cues)+1.2)*RATE)
        mix = music[:length].copy()*slider*MUSIC_GAIN
        if len(mix) < length:
            mix = np.pad(mix, ((0, length-len(mix)), (0, 0)))
        effect_mix = np.zeros_like(mix)
        timeline = []
        for cue in cues:
            start, key, level, pan = cue[:4]
            occluded = len(cue) > 4 and cue[4]
            sound = decode((OUTPUT / (key+'.wav')).read_bytes(), filters='lowpass=f=1400')[:, 0] if occluded else sounds[key]
            signal = sound*slider*EFFECT_GAIN*level
            stereo = signal[:, None]*np.array([1,1] if pan == 0 else [math.sqrt((1-pan)/2), math.sqrt((1+pan)/2)])
            offset = round(start*RATE)
            effect_mix[offset:offset+len(signal)] += stereo[:len(mix)-offset]
            timeline.append({'at':start, 'sound':key, 'gain':level, 'pan':pan, 'occluded':occluded})
        raw = subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(RATE),'-ac','2','-i','pipe:0',
                              '-af','acompressor=threshold=0.707945784:ratio=20:knee=1:attack=3:release=80:makeup=1:detection=peak:link=maximum',
                              '-f','f32le','pipe:1'],input=effect_mix.astype('<f4').tobytes(),check=True,capture_output=True).stdout
        limited = np.clip(np.frombuffer(raw,dtype='<f4').reshape(-1,2),-PEAK_LIMIT,PEAK_LIMIT)
        mix += limited
        assert np.max(np.abs(mix)) < 1
        path = OUTPUT / (name+'.wav')
        write_wav(path, mix)
        return metadata(path, mix, timeline=timeline, slider=slider, effectsPeak=round(float(np.max(np.abs(limited))),6))
    previews = [preview('preview-lobby-50', [(1+i, 'lobby-'+kind, LOBBY_GAIN, 0) for i,kind in enumerate(['enter','exit','mic-on','mic-off'])])]
    cues = []
    for group, surface in enumerate(['stone','cobble']):
        for speed, ratio, db in [('slow',.85,-2), ('normal',1,0), ('fast',1.1,1.5)]:
            start = 1+group*5+({'slow':0,'normal':1,'fast':2}[speed])*1.5
            for i in range(3):
                cues.append((start+i*36/(105*ratio),f'{surface}-{i}',10**((db-3)/20),0))
    previews.append(preview('preview-footsteps-50', cues))
    previews.append(preview('preview-direction-50', [(1,'stone-0',1,-.9),(2,'stone-1',1,.9),(3,'cobble-0',.45,-.6),(4,'cobble-1',.15,.6),(5,'cobble-2',10**(-6/20),-.6,True)]))
    previews.append(preview('preview-combat-50', [(1,'combat-swing',1,0),(2,'combat-swing',1,0),(2.065,'combat-hit',HIT_GAIN*.75,0),(3,'combat-hit',HIT_GAIN*.75,0)]))
    cues = [(1+i,name,10**((3 if name=='feedback-collision' else 6)/20),0) for i,name in enumerate(feedback)]
    # A four-event burst follows the individual cues at full volume.
    burst = [(12,name,10**(6/20),pan) for name,pan in [('feedback-hurt',-.4),('feedback-block',.4),('feedback-pickup',0),('feedback-complete',0)]]
    previews.append(preview('preview-feedback-50',cues))
    previews.append(preview('preview-feedback-100',cues+burst,slider=1))
    manifest = {'license':'CC0-1.0', 'costRmb':0, 'sampleRate':RATE,
        'sources':SOURCES, 'assets':assets, 'calibration':calibration, 'previews':previews,
        'previewNote':'Runtime category gains and tone/noise definitions; offline FFmpeg compressor plus 0.95 peak guard. Browser filter/compressor coefficients and HRTF are device-dependent.'}
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(calibration, indent=2))

if __name__ == '__main__':
    main()
