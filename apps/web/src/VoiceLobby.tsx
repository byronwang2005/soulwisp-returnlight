import { useEffect, useState, useSyncExternalStore } from 'react';
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
  return <section className={`voice-lobby panel ${joined ? 'is-connected' : ''}`} aria-labelledby="voice-lobby-title">
    <div className="voice-lobby-heading"><div className="voice-lobby-emblem" aria-hidden="true">⌁</div><div><span className="eyebrow">UNDER THE LANTERN / 公共语音</span><h2 id="voice-lobby-title">灯下语音大厅</h2><p>先聊几句，再一起出发。</p></div><div className="voice-lobby-count"><span className={voice.info.available ? 'signal-dot' : 'signal-dot offline'} aria-hidden="true"/><strong>{joined ? voice.members.length : voice.info.online}<small> / 10</small></strong><span>人在灯下</span></div></div>
    {joined ? <><ul className="voice-lobby-members" aria-label="大厅成员">{voice.members.map(member => <li key={member.id} className={member.speaking && !member.muted ? 'is-speaking' : ''}>
      <span className="voice-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><span className="voice-member-name"><strong>{member.name}{member.self && <small> · 你</small>}</strong><span>{member.muted ? '已静音' : member.speaking ? '正在说话' : '麦克风已开启'}</span></span><span className="voice-member-indicator" aria-label={member.muted ? '麦克风关闭' : '麦克风开启'}>{member.muted ? '◌' : '⌁'}</span>
    </li>)}</ul><div className="voice-lobby-controls"><button className={!voice.muted ? 'primary' : ''} disabled={voice.state !== 'connected' || voice.micBusy} aria-pressed={!voice.muted} onClick={() => void connection.toggleMic()}>{voice.micBusy ? '正在打开麦克风…' : voice.muted ? '开启麦克风' : '静音麦克风'}</button><button disabled={voice.state !== 'connected'} aria-pressed={voice.listening} onClick={() => connection.toggleListening()}>{voice.listening ? '关闭收听' : '开启收听'}</button><button onClick={() => connection.leave()}>离开大厅</button><span className={`voice-network ${quality}`}>{voice.state === 'reconnecting' ? '正在重连' : qualityLabel}</span></div>{voice.playbackBlocked && <button className="voice-playback primary" onClick={() => void connection.startAudio()}>点击启用声音</button>}<p className="voice-lobby-note">{voice.muted ? '麦克风已静音。' : '麦克风已开启。'}离开首页将退出大厅。首次开麦后，静音时麦克风设备仍保持连接。</p>
    </> : <div className="voice-lobby-entry"><p>{user ? '加入即可收听，准备好后再开启麦克风。' : '登录后加入，和同行者自由聊天。'}<span>纯语音 · 最多 10 人 · 自由开麦</span></p><div className="voice-lobby-entry-actions">{voice.state === 'joining' ? <><button disabled>正在连接…</button><button onClick={() => connection.leave()}>取消连接</button></> : !user ? <button className="primary" onClick={onLogin}>登录并加入</button> : voice.info.available ? <button className="primary" onClick={() => void connection.join()}>加入语音大厅 <span aria-hidden="true">↗</span></button> : <><span className="muted">大厅暂时离线</span><button onClick={() => void connection.refresh()}>重试连接</button></>}</div></div>}
    {voice.message && <p className="voice-lobby-message" role="status">{voice.message}</p>}
    {joined && voice.metrics.length > 0 && <details className="voice-diagnostics"><summary>连接诊断</summary><p>网络往返与缓冲统计；音频端到端延迟需单独测量。</p><div className="voice-diagnostics-scroll"><table><thead><tr><th>成员</th><th>网络往返</th><th>丢包</th><th>抖动</th><th>缓冲等待</th><th>路径</th></tr></thead><tbody>{voice.metrics.map(metric => <tr key={metric.trackId}><td>{voice.members.find(member => member.id === metric.peerId)?.name || '归灯者'}</td><td>{format(metric.roundTripMs, 'ms')}</td><td>{format(metric.lossPercent, '%')}</td><td>{format(metric.jitterMs, 'ms')}</td><td>{format(metric.bufferMs, 'ms')}</td><td>{metric.protocol?.toUpperCase() || '—'}{metric.relay === true ? ` / 中继${metric.relayProtocol ? ' '+metric.relayProtocol.toUpperCase() : ''}` : metric.relay === false ? ' / 直连' : ''}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
function format(value: number | null, unit: string): string { return value === null ? '—' : `${value.toFixed(1)} ${unit}`; }
