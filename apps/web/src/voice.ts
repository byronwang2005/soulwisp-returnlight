import {bindAudioRoom,applyVoiceVolume} from './audio-devices';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { GameView } from '@wangxu/shared';
import { request } from './api';
export function useCouncilVoice(view: GameView | null) {
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(true);
  const [status, setStatus] = useState('议会开启语音');
  const [canPublish,setCanPublish] = useState(false);
  const me = view?.players.find(player => player.id === view.self.id);
  const allowed = canPublish && !!view?.voice.enabled && !me?.sealed && (view.voice.open || view.voice.speakerId === view.self.id);
  const epoch = view?.voice.enabled && (view.phase === 'DISCUSS' || view.phase === 'VOTE') ? view.voice.epoch : null;
  useEffect(() => {
    if (!enabled || !view || !epoch) return;
    let disposed = false;
    const room = new Room({adaptiveStream:true,dynacast:true}); roomRef.current = room;
    const unbindDevices=bindAudioRoom(room);
    setCanPublish(false);
    const syncPermissions=()=>{const permitted=!!room.localParticipant.permissions?.canPublish;setCanPublish(permitted);if(!permitted){setMuted(true);void room.localParticipant.setMicrophoneEnabled(false).catch(()=>{});}};
    room.on(RoomEvent.ParticipantPermissionsChanged,syncPermissions);
    room.on(RoomEvent.Connected,syncPermissions);
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) { const audio = track.attach(); applyVoiceVolume(audio); audio.autoplay = true; audio.dataset.voice = 'council'; document.body.appendChild(audio); audioRef.current.push(audio); } });
    room.on(RoomEvent.Disconnected, () => setStatus('议会语音已断开'));
    void request<{token:string;url:string;epoch:string}>('/voice/token', {roomId:view.roomId}).then(async token => { if (disposed || token.epoch !== epoch) return; await room.connect(token.url, token.token); if (!disposed) setStatus(me?.sealed ? '回响 · 仅聆听' : '议会语音已连接'); }).catch(error => { if (!disposed) setStatus(error.message || '语音暂不可用'); });
    return () => { unbindDevices(); disposed = true; void room.disconnect(); roomRef.current = null; audioRef.current.forEach(audio => audio.remove()); audioRef.current=[]; setMuted(true); setCanPublish(false); };
  }, [enabled, epoch, view?.roomId]);
  useEffect(() => { if (!allowed) { setMuted(true); void roomRef.current?.localParticipant.setMicrophoneEnabled(false).catch(()=>{}); } }, [allowed]);
  async function toggleMic() { if (!allowed || !roomRef.current) return; try { await roomRef.current.localParticipant.setMicrophoneEnabled(muted); setMuted(!muted); } catch { setStatus('请允许浏览器使用麦克风'); } }
  return {enabled,setEnabled,muted,status,allowed,toggleMic};
}
