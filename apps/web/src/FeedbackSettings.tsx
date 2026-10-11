import {ActionButton} from './ActionButton';
import {useFeedbackSettings} from './settings';

export function FeedbackSettings({onClose,global=false,embedded=false}:{onClose:()=>void;global?:boolean;embedded?:boolean}){
  const {settings,updateSettings}=useFeedbackSettings();
  return <section className={`effects-settings panel scroll-region ${global?'global-settings':''} ${embedded?'embedded-settings':''}`} role={embedded?undefined:"dialog"} aria-label="打击与交互反馈设置">
    {!embedded&&<div className="section-head"><h3>交互反馈</h3><ActionButton iconKind="close"  aria-label="关闭反馈设置" onClick={onClose}>×</ActionButton></div>}
    <label>背景音乐 · {Math.round(settings.musicVolume*100)}%<input aria-label="背景音乐音量" type="range" min="0" max="1" step="0.05" value={settings.musicVolume} onChange={e=>updateSettings({musicVolume:Number(e.target.value)})}/></label>
    <label className="check-label"><input type="checkbox" checked={settings.musicEnabled} onChange={e=>updateSettings({musicEnabled:e.target.checked})}/>开启场景背景音乐</label>
    <label>音效音量 · {Math.round(settings.volume*100)}%<input aria-label="音效音量" type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={e=>updateSettings({volume:Number(e.target.value)})}/></label>
    <label className="check-label"><input type="checkbox" checked={!settings.muted} onChange={e=>updateSettings({muted:!e.target.checked})}/>开启游戏声音</label>
    <label className="check-label"><input type="checkbox" checked={settings.haptics} onChange={e=>updateSettings({haptics:e.target.checked})}/>设备震动</label>
    <label className="check-label"><input type="checkbox" checked={!settings.motion} onChange={e=>updateSettings({motion:!e.target.checked})}/>减少动态效果</label>
    <small>音乐随场景淡入淡出，语音期间自动降低音量。{typeof navigator.vibrate==='function'?'震动遵循设备与浏览器支持。':'当前浏览器未提供设备震动接口。'}</small>
  </section>;
}
