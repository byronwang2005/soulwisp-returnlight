import {useState,type ButtonHTMLAttributes} from 'react';
import {MorphIcon} from 'morphicons/react';
import {buttonGlyph,type ButtonIcon,type ButtonState} from './button-icons';
import {useFeedbackSettings} from './settings';
export type {ButtonIcon,ButtonState} from './button-icons';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>{iconKind:ButtonIcon;iconState?:ButtonState}
export function ActionButton({children,iconKind,iconState='default',className='',disabled,onPointerEnter,onPointerLeave,onPointerDown,onPointerUp,onPointerCancel,onFocus,onBlur,...props}:Props){
  const [hovered,setHovered]=useState(false);const [focused,setFocused]=useState(false);const [pressed,setPressed]=useState(false);
  const {settings}=useFeedbackSettings();const active=!disabled&&(hovered||focused||pressed);
  const state=iconState==='default'&&typeof props['aria-expanded']==='boolean'?(props['aria-expanded']?'expanded':'collapsed'):iconState;
  const content=typeof children==='string'&&/^[×↑↓←→⚙]$/.test(children.trim())?null:children;
  return <button {...props} disabled={disabled} className={`action-button ${className}`} data-icon-kind={iconKind} data-icon-state={state} data-icon-active={active} data-icon-motion={settings.motion?'user':'always'}
    onPointerEnter={event=>{setHovered(true);onPointerEnter?.(event);}} onPointerLeave={event=>{setHovered(false);setPressed(false);onPointerLeave?.(event);}}
    onPointerDown={event=>{setPressed(true);onPointerDown?.(event);}} onPointerUp={event=>{setPressed(false);onPointerUp?.(event);}} onPointerCancel={event=>{setPressed(false);onPointerCancel?.(event);}}
    onFocus={event=>{setFocused(true);onFocus?.(event);}} onBlur={event=>{setFocused(false);setPressed(false);onBlur?.(event);}}>
    <MorphIcon className={`button-svg ${state==='busy'?'button-svg-busy':''}`} icon={buttonGlyph(iconKind,state)} size={18} strokeWidth={1.65} spring="smooth" reducedMotion={settings.motion?'user':'always'} aria-hidden="true" focusable="false"/>{content}
  </button>;
}
