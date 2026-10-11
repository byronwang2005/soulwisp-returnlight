import {ActionButton} from './ActionButton';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from './api';
import { LobbyVoiceConnection } from './lobby-voice';
import { lobbyNetworkQuality } from './lobby-stats';
import './voice-lobby.css';

export function VoiceLobby({ user, onLogin, onConnection, onActivityChange }: { user: User | null; onLogin: () => void; onConnection: (connection: LobbyVoiceConnection | null) => void; onActivityChange: (active: boolean) => void }) {
  const [connection] = useState(() => new LobbyVoiceConnection());
  const voice = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  useEffect(() => { onConnection(connection); void connection.initialize(); return () => { onConnection(null); connection.dispose(); }; }, [connection, onConnection]);
  useEffect(() => { if (!user) connection.leave(); }, [user?.id, connection]);
  useEffect(() => { onActivityChange(voice.state !== 'idle'); }, [voice.state, onActivityChange]);
  useEffect(() => () => onActivityChange(false), [onActivityChange]);
  const joined = voice.state === 'connected' || voice.state === 'reconnecting';
  const quality = lobbyNetworkQuality(voice.metrics);
  const qualityLabel = { unknown: '等待音频', good: '网络良好', fair: '网络有波动', poor: '网络较弱' }[quality];
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const openPanel = () => setExpanded(true);
  const closePanel = () => { dialog.current?.close(); setExpanded(false); };
  const leave = () => { connection.leave(); closePanel(); };
  const login = () => { closePanel(); onLogin(); };
  const join = () => { openPanel(); void connection.join(); };
  useEffect(() => {
    if (expanded && !dialog.current?.open) dialog.current?.showModal();
  }, [expanded]);
  const hint = voice.playbackBlocked ? '声音待启用' : voice.state === 'reconnecting' ? '正在重连' : voice.state === 'joining' ? '正在连接' : voice.message ? '查看提示' : joined ? (voice.muted ? '已静音' : '麦克风开启') : !voice.info.available ? '暂时离线' : '';
  const micLabel = voice.micBusy ? '正在打开麦克风…' : voice.muted ? '开启麦克风' : '静音麦克风';
  const entryAction = () => voice.state === 'joining'
    ? <ActionButton iconKind="leave" onClick={leave}>取消连接</ActionButton>
    : !user ? <ActionButton iconKind="enter" className="primary" aria-label="登录并加入" onClick={login}><span className="voice-action-wide">登录并加入</span><span className="voice-action-short" aria-hidden="true">登录加入</span></ActionButton>
    : voice.info.available ? <ActionButton iconKind="rooms" className="primary" aria-label="加入语音大厅" onClick={join}><span className="voice-action-wide">加入语音大厅</span><span className="voice-action-short" aria-hidden="true">加入大厅</span></ActionButton>
    : <ActionButton iconKind="retry" onClick={() => void connection.refresh()}>重试连接</ActionButton>;
  return <>
    <section className={`voice-lobby panel ${joined ? 'is-connected' : ''}`} aria-label="公共语音状态">
      <ActionButton id="voice-lobby-trigger" iconKind="rooms" className="voice-lobby-trigger" aria-label="打开灯下语音大厅" aria-haspopup="dialog" aria-expanded={expanded} aria-controls="voice-lobby-dialog" onClick={openPanel}>
        <span className="voice-strip-title">灯下语音大厅</span>{hint && <span className={`voice-strip-hint ${voice.playbackBlocked || (voice.message && voice.state !== 'reconnecting') ? 'needs-attention' : ''} ${voice.state === 'joining' || voice.state === 'reconnecting' ? 'is-transient' : ''}`}>{hint}</span>}
      </ActionButton>
      <span className="voice-lobby-count" aria-label={`${joined ? voice.members.length : voice.info.online}人，最多10人`}><span className={voice.info.available ? 'signal-dot' : 'signal-dot offline'} aria-hidden="true"/><strong>{joined ? voice.members.length : voice.info.online}<small> / 10</small></strong></span>
      <div className="voice-strip-actions">{joined ? <ActionButton iconKind="mic" iconState={voice.micBusy ? 'busy' : voice.muted ? 'off' : 'on'} className={`voice-quick-mic ${!voice.muted ? 'primary' : ''}`} aria-label={`快捷${micLabel}`} title={micLabel} disabled={voice.state !== 'connected' || voice.micBusy} aria-pressed={!voice.muted} onClick={() => void connection.toggleMic()}><span>{micLabel}</span></ActionButton> : entryAction()}</div>
      <span className="voice-announcement" role="status">{voice.message || (voice.playbackBlocked ? '声音播放受阻，请打开语音大厅启用声音。' : '')}</span>
    </section>
    <dialog ref={dialog} id="voice-lobby-dialog" className="voice-lobby-dialog panel" aria-labelledby="voice-lobby-title" onClose={() => {
      setExpanded(false);
      // Native dialog restores focus; fall back when a joining button was replaced.
      if (document.activeElement === document.body) document.getElementById('voice-lobby-trigger')?.focus();
    }}>
      <div className="voice-lobby-heading"><div><span className="eyebrow">UNDER THE LANTERN / 公共语音</span><h2 id="voice-lobby-title">灯下语音大厅</h2><p>先聊几句，再一起出发。</p></div><ActionButton iconKind="close" autoFocus aria-label="收起语音大厅" onClick={closePanel}/></div>
      <div className="voice-lobby-body scroll-region">
        {joined ? <><span className={`voice-network ${quality}`}>{voice.state === 'reconnecting' ? '正在重连' : qualityLabel} · {voice.members.length} / 10 人</span><ul className="voice-lobby-members" aria-label="大厅成员">{voice.members.map(member => <li key={member.id} className={member.speaking && !member.muted ? 'is-speaking' : ''}>
          <span className="voice-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><span className="voice-member-name"><strong title={member.name}>{member.name}{member.self && <small> · 你</small>}</strong><span>{member.muted ? '已静音' : member.speaking ? '正在说话' : '麦克风已开启'}</span></span>
        </li>)}</ul><p className="voice-lobby-note">{voice.muted ? '麦克风已静音。' : '麦克风已开启。'}收起面板后继续通话；离开首页将退出大厅。首次开麦后，静音时麦克风设备仍保持连接。</p></>
        : <div className="voice-lobby-entry"><p>{user ? '加入即可收听，准备好后再开启麦克风。' : '登录后加入，和同行者自由聊天。'}<span>纯语音 · 最多 10 人 · 自由开麦</span></p>{voice.state === 'joining' ? <p>正在连接…</p> : !voice.info.available && <p>大厅暂时离线</p>}</div>}
        {voice.message && <p className="voice-lobby-message">{voice.message}</p>}
        {joined && voice.metrics.length > 0 && <details className="voice-diagnostics"><summary>连接诊断</summary><p>网络往返与缓冲统计；音频端到端延迟需单独测量。</p><div className="voice-diagnostics-scroll"><table><thead><tr><th>成员</th><th>网络往返</th><th>丢包</th><th>抖动</th><th>缓冲等待</th><th>路径</th></tr></thead><tbody>{voice.metrics.map(metric => <tr key={metric.trackId}><td>{voice.members.find(member => member.id === metric.peerId)?.name || '归灯者'}</td><td>{format(metric.roundTripMs, 'ms')}</td><td>{format(metric.lossPercent, '%')}</td><td>{format(metric.jitterMs, 'ms')}</td><td>{format(metric.bufferMs, 'ms')}</td><td>{metric.protocol?.toUpperCase() || '—'}{metric.relay === true ? ` / 中继${metric.relayProtocol ? ' '+metric.relayProtocol.toUpperCase() : ''}` : metric.relay === false ? ' / 直连' : ''}</td></tr>)}</tbody></table></div></details>}
      </div>
      <div className="voice-lobby-controls">{joined ? <>
        <ActionButton iconKind="mic" iconState={voice.micBusy ? 'busy' : voice.muted ? 'off' : 'on'} className={!voice.muted ? 'primary' : ''} disabled={voice.state !== 'connected' || voice.micBusy} aria-pressed={!voice.muted} onClick={() => void connection.toggleMic()}>{micLabel}</ActionButton>
        <ActionButton iconKind="listen" iconState={voice.listening ? 'on' : 'off'} disabled={voice.state !== 'connected'} aria-pressed={voice.listening} onClick={() => connection.toggleListening()}>{voice.listening ? '关闭收听' : '开启收听'}</ActionButton>
        <ActionButton iconKind="leave" className="voice-leave" onClick={leave}>离开大厅</ActionButton>
        {voice.playbackBlocked && <ActionButton iconKind="listen" className="voice-playback primary" onClick={() => void connection.startAudio()}>点击启用声音</ActionButton>}
      </> : entryAction()}</div>
    </dialog>
  </>;
}
function format(value: number | null, unit: string): string { return value === null ? '—' : `${value.toFixed(1)} ${unit}`; }
