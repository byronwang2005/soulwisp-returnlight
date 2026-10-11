import {ActionButton} from './ActionButton';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PHASE_NAMES } from './GameUI';
import { PROFESSION_NAMES, type LobbyView, type LobbyCommand, type Profession } from '@wangxu/shared';
import type { User } from './api';
import { LobbyVoiceConnection } from './lobby-voice';
import { lobbyNetworkQuality } from './lobby-stats';
import './voice-lobby.css';

export function VoiceLobby({ user, lobby, summary, suspended, onJoin, onLeave, send, onError, onLogin, onConnection, onActivityChange }: {
  user: User | null; lobby: LobbyView | null; summary: {waiting:number;game:LobbyView['game']}; suspended: boolean;
  onJoin: () => Promise<void>; onLeave: () => Promise<void>; send: (command: LobbyCommand) => void; onError: (message:string) => void;
  onLogin: () => void; onConnection: (connection: LobbyVoiceConnection | null) => void; onActivityChange: (active: boolean) => void;
}) {
  const [connection] = useState(() => new LobbyVoiceConnection());
  const voice = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  useEffect(() => { onConnection(connection); void connection.initialize(); return () => { onConnection(null); connection.dispose(); }; }, [connection, onConnection]);
  useEffect(() => { if (!user) connection.leave(); }, [user?.id, connection]);
  useEffect(() => { onActivityChange(voice.state !== 'idle'); }, [voice.state, onActivityChange]);
  useEffect(() => () => onActivityChange(false), [onActivityChange]);
  const joined = voice.state === 'connected' || voice.state === 'reconnecting';
  const quality = lobbyNetworkQuality(voice.metrics);
  const qualityLabel = { unknown: '等待音频', good: '网络良好', fair: '网络有波动', poor: '网络较弱' }[quality];
  const wantsListening=useRef(sessionStorage.getItem('wangxu-waiting-listen')==='true');
  const waiting=!!lobby&&lobby.selfArea==='waiting';
  const self=lobby?.members.find(member=>member.id===lobby.selfId);
  const joinAttempt=useRef(0);
  const [joining,setJoining]=useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const openPanel = () => setExpanded(true);
  const closePanel = () => { dialog.current?.close(); setExpanded(false); };
  const leave = () => {joinAttempt.current++;setJoining(false); wantsListening.current=false;sessionStorage.removeItem('wangxu-waiting-listen');connection.leave();closePanel();void onLeave().catch(error=>onError((error as Error).message)); };
  const login = () => { closePanel(); onLogin(); };
  const join = async () => {
    const attempt=++joinAttempt.current;openPanel();setJoining(true);
    try{await onJoin();if(attempt!==joinAttempt.current)return;wantsListening.current=true;sessionStorage.setItem('wangxu-waiting-listen','true');await connection.join();}
    catch(error){onError((error as Error).message);}finally{if(attempt===joinAttempt.current)setJoining(false);}
  };
  useEffect(()=>{
    const suspend=()=>{joinAttempt.current++;setJoining(false);if(connection.getSnapshot().state!=='idle'){wantsListening.current=true;sessionStorage.setItem('wangxu-waiting-listen','true');}connection.leave();dialog.current?.close();setExpanded(false);};
    const exit=()=>{joinAttempt.current++;setJoining(false);wantsListening.current=false;sessionStorage.removeItem('wangxu-waiting-listen');connection.leave();};
    window.addEventListener('soulwisp-waiting-suspend',suspend);window.addEventListener('soulwisp-waiting-exit',exit);
    return()=>{window.removeEventListener('soulwisp-waiting-suspend',suspend);window.removeEventListener('soulwisp-waiting-exit',exit);};
  },[connection]);
  useEffect(()=>{if(suspended||!waiting){connection.leave();dialog.current?.close();setExpanded(false);}else if(wantsListening.current||sessionStorage.getItem('wangxu-waiting-listen')==='true'){wantsListening.current=true;void connection.join();}},[waiting,suspended,connection]);
  useEffect(() => {
    if (expanded && !dialog.current?.open) dialog.current?.showModal();
  }, [expanded]);
  const hint = voice.playbackBlocked ? '声音待启用' : voice.state === 'reconnecting' ? '正在重连' : voice.state === 'joining' ? '正在连接' : voice.message ? '查看提示' : joined ? (voice.muted ? '已静音' : '麦克风开启') : !voice.info.available ? '暂时离线' : '';
  const micLabel = voice.micBusy ? '正在打开麦克风…' : voice.muted ? '开启麦克风' : '静音麦克风';
  const entryAction = () => !user
    ? <ActionButton iconKind="enter" className="primary" onClick={login}>登录并加入</ActionButton>
    : <ActionButton iconKind="rooms" className="primary" disabled={joining} onClick={()=>void join()}>{joining?'正在加入…':waiting?'连接语音':'加入等待区'}</ActionButton>;
  const game=lobby?.game??summary.game;
  return <div hidden={suspended}>
    <section className={`voice-lobby panel ${joined ? 'is-connected' : ''}`} aria-label="公共语音状态">
      <ActionButton id="voice-lobby-trigger" iconKind="rooms" className="voice-lobby-trigger" aria-label="打开灯下等待区" aria-haspopup="dialog" aria-expanded={expanded} aria-controls="voice-lobby-dialog" onClick={openPanel}>
        <span className="voice-strip-title">灯下等待区</span>{hint && <span className={`voice-strip-hint ${voice.playbackBlocked || (voice.message && voice.state !== 'reconnecting') ? 'needs-attention' : ''} ${voice.state === 'joining' || voice.state === 'reconnecting' ? 'is-transient' : ''}`}>{hint}</span>}
      </ActionButton>
      <span className="voice-lobby-count" aria-label={`${lobby?.members.length??summary.waiting}人在等待区`}><span className={voice.info.available ? 'signal-dot' : 'signal-dot offline'} aria-hidden="true"/><strong>{lobby?.members.length??summary.waiting}<small> 人等待</small></strong></span>
      <div className="voice-strip-actions">{waiting ? <ActionButton iconKind="play" className="primary" disabled={lobby.draining} onClick={()=>send({type:'ready',ready:!self?.ready})}>{self?.ready?'取消准备':'准备'}</ActionButton> : entryAction()}{joined && <ActionButton iconKind="mic" iconState={voice.micBusy ? 'busy' : voice.muted ? 'off' : 'on'} className={`voice-quick-mic ${!voice.muted ? 'primary' : ''}`} aria-label={`快捷${micLabel}`} title={micLabel} disabled={voice.state !== 'connected' || voice.micBusy} aria-pressed={!voice.muted} onClick={() => void connection.toggleMic()}><span>{micLabel}</span></ActionButton>}</div>
      <span className="voice-announcement" role="status">{voice.message || (voice.playbackBlocked ? '声音播放受阻，请打开语音大厅启用声音。' : '')}</span>
    </section>
    <dialog ref={dialog} id="voice-lobby-dialog" className="voice-lobby-dialog panel" aria-labelledby="voice-lobby-title" onClose={() => {
      setExpanded(false);
      // Native dialog restores focus; fall back when a joining button was replaced.
      if (document.activeElement === document.body) document.getElementById('voice-lobby-trigger')?.focus();
    }}>
      <div className="voice-lobby-heading"><div><span className="eyebrow">UNDER THE LANTERN / 等待与候场</span><h2 id="voice-lobby-title">灯下等待区</h2><p>先聊几句，再一起出发。</p></div><ActionButton iconKind="close" autoFocus aria-label="收起语音大厅" onClick={closePanel}/></div>
      <div className="voice-lobby-body scroll-region">
        <section className="waiting-game-status" aria-label="游玩区状态"><h3>游玩区</h3><p>{game?`${game.players} 人 · ${game.stage==='transferring'?'正在入场':game.stage==='result'?'展示结算':game.stage==='closing'?'正在回厅':game.phase?PHASE_NAMES[game.phase]:'游戏进行中'}`:'空闲，等待同行者准备'}</p></section>
        {waiting&&<>
          <p role="status">{lobby.draining?'服务正在更新，暂停开局。':lobby.countdown!==null?`${lobby.countdown} 秒后进入游玩区`:(lobby.members.length<4?'至少 4 人才能出发。':'候选成员全部准备后倒数 10 秒。')}{self&&!self.candidate&&` 本局席位已满，你在候场队列第 ${lobby.members.filter(m=>!m.candidate).findIndex(m=>m.id===self.id)+1} 位，仍可自由聊天。`}</p>
          <label>职业偏好<select aria-label="职业偏好" value={self?.preference??''} disabled={lobby.countdown!==null&&self?.candidate} onChange={event=>send({type:'preference',profession:event.target.value?event.target.value as Profession:null})}><option value="">随意</option>{Object.entries(PROFESSION_NAMES).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
          <p className="hint">偏好冲突由系统抽签；本局人数未包含的职业将替换为其他职业。秘密身份独立随机。</p>
          <ul className="voice-lobby-members" aria-label="等待区成员">{lobby.members.map(member=>{const media=voice.members.find(peer=>peer.id===member.id);return <li key={member.id} className={media?.speaking&&!media.muted?'is-speaking':''}><span className="voice-avatar" aria-hidden="true">{member.name.slice(0,1)}</span><span className="voice-member-name"><strong>{member.name}{member.id===lobby.selfId&&<small> · 你</small>}</strong><span>{member.candidate?'候选':'候场'} · {member.ready?'已准备':'未准备'} · {member.preference?PROFESSION_NAMES[member.preference]:'随意'}{media?` · ${media.muted?'已静音':media.speaking?'正在说话':'麦克风开启'}`:' · 未连接语音'}</span></span></li>;})}</ul>
        </>}
        {joined?<p className={`voice-network ${quality}`}>{qualityLabel} · {voice.members.length} 人连接语音。收起面板或浏览营地可继续通话。</p>:<p>{waiting?'语音暂未连接；你仍可准备和参加游戏。':'加入等待区后即可准备；语音默认静音，候场也能自由聊天。'}</p>}
        {voice.message && <p className="voice-lobby-message">{voice.message}</p>}
        {joined && voice.metrics.length > 0 && <details className="voice-diagnostics"><summary>连接诊断</summary><p>网络往返与缓冲统计；音频端到端延迟需单独测量。</p><div className="voice-diagnostics-scroll"><table><thead><tr><th>成员</th><th>网络往返</th><th>丢包</th><th>抖动</th><th>缓冲等待</th><th>路径</th></tr></thead><tbody>{voice.metrics.map(metric => <tr key={metric.trackId}><td>{voice.members.find(member => member.id === metric.peerId)?.name || '归灯者'}</td><td>{format(metric.roundTripMs, 'ms')}</td><td>{format(metric.lossPercent, '%')}</td><td>{format(metric.jitterMs, 'ms')}</td><td>{format(metric.bufferMs, 'ms')}</td><td>{metric.protocol?.toUpperCase() || '—'}{metric.relay === true ? ` / 中继${metric.relayProtocol ? ' '+metric.relayProtocol.toUpperCase() : ''}` : metric.relay === false ? ' / 直连' : ''}</td></tr>)}</tbody></table></div></details>}
      </div>
      <div className="voice-lobby-controls">{waiting?<>
        <ActionButton iconKind="play" className="primary" disabled={lobby.draining} onClick={()=>send({type:'ready',ready:!self?.ready})}>{self?.ready?'取消准备':'准备出征'}</ActionButton>
        {joined?<><ActionButton iconKind="mic" iconState={voice.muted?'off':'on'} disabled={voice.state!=='connected'||voice.micBusy} aria-pressed={!voice.muted} onClick={()=>void connection.toggleMic()}>{micLabel}</ActionButton><ActionButton iconKind="listen" aria-pressed={voice.listening} onClick={()=>connection.toggleListening()}>{voice.listening?'关闭收听':'开启收听'}</ActionButton></>:entryAction()}
        <ActionButton iconKind="leave" onClick={leave}>离开等待区</ActionButton>
        {voice.playbackBlocked&&<ActionButton iconKind="listen" onClick={()=>void connection.startAudio()}>点击启用声音</ActionButton>}
      </>:entryAction()}</div>
    </dialog>
  </div>;
}
function format(value: number | null, unit: string): string { return value === null ? '—' : `${value.toFixed(1)} ${unit}`; }
