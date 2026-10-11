import {isValidElement,useState,type ButtonHTMLAttributes,type ReactNode} from 'react';
import {MorphIcon,type IconInput} from 'morphicons/react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,ArrowUpRight,BookOpen,Check,CheckCheck,ChevronDown,ChevronLeft,ChevronRight,ChevronUp,CircleX,Compass,Copy,DoorOpen,Eye,Flame,Footprints,Hand,Handshake,Headphones,Heart,HeartPulse,Library,LoaderCircle,LogIn,LogOut,Menu,Mic,MicOff,Moon,Package,Pause,Play,RotateCcw,Save,ScrollText,Send,Settings,Shield,Shirt,SkipForward,Sparkles,Swords,Users,Volume2,VolumeX,Vote,WandSparkles,Wrench,X} from 'lucide';
import {useFeedbackSettings} from './settings';

type Pair=readonly [IconInput,IconInput];
const pairs={
  enter:[LogIn,ArrowRight],leave:[DoorOpen,LogOut],close:[X,CircleX],camp:[Flame,Sparkles],rooms:[Users,Handshake],training:[BookOpen,ScrollText],
  music:[Volume2,VolumeX],settings:[Settings,Wrench],save:[Save,Check],copy:[Copy,CheckCheck],craft:[Wrench,Sparkles],research:[Library,Eye],
  outfit:[Shirt,Check],moveUp:[ArrowUp,ChevronUp],moveDown:[ArrowDown,ChevronDown],moveLeft:[ArrowLeft,ChevronLeft],moveRight:[ArrowRight,ChevronRight],
  attack:[Swords,Flame],skill:[Shield,Sparkles],dodge:[Footprints,ArrowRight],interact:[Hand,Handshake],heal:[HeartPulse,Heart],
  vote:[Vote,Check],evidence:[ScrollText,Eye],send:[Send,ArrowUpRight],mic:[Mic,MicOff],listen:[Headphones,Volume2],retry:[RotateCcw,Play],
  menu:[Menu,ChevronDown],expand:[ChevronDown,ChevronUp],next:[ArrowRight,SkipForward],moon:[Moon,Flame],fog:[Moon,Eye],drop:[Package,ArrowDown],
  play:[Play,Flame],boon:[Sparkles,WandSparkles],target:[Compass,Eye],count:[Users,Check],generic:[Compass,ArrowUpRight],
} satisfies Record<string,Pair>;
export type ButtonIcon=keyof typeof pairs;
function textOf(node:ReactNode):string{
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(textOf).join(' ');
  if(isValidElement<{children?:ReactNode}>(node))return textOf(node.props.children);
  return '';
}
function identify(text:string,className:string):ButtonIcon{
  if(className.includes('brand'))return 'camp';
  if(className.includes('boon-card'))return 'boon';
  if(/移动↑/.test(text))return 'moveUp';if(/移动↓/.test(text))return 'moveDown';if(/移动←/.test(text))return 'moveLeft';if(/移动→/.test(text))return 'moveRight';
  if(/关闭反馈|关闭登录|关闭提示|离开远征/.test(text))return 'close';
  if(/音乐/.test(text))return 'music';if(/反馈设置|画质/.test(text))return 'settings';
  if(/麦克风|静音/.test(text))return 'mic';if(/收听|启用声音/.test(text))return 'listen';if(/语音/.test(text))return 'rooms';
  if(/复制/.test(text))return 'copy';if(/保存|穿戴/.test(text))return 'save';if(/已收藏/.test(text))return 'outfit';
  if(/研究|秘闻/.test(text))return 'research';if(/制作/.test(text))return 'craft';if(/外观|配装/.test(text))return 'outfit';
  if(/重试|恢复|重新载入|再开/.test(text))return 'retry';if(/退出|离开|返回|取消连接/.test(text))return 'leave';
  if(/展开|收起/.test(text))return 'expand';if(/手册/.test(text))return 'menu';if(/发送/.test(text))return 'send';
  if(/表决|投票|弃权/.test(text))return 'vote';if(/证据|公开|发布|验痕/.test(text))return 'evidence';
  if(/显形|蚀月|腐化|终结/.test(text))return 'moon';if(/灰雾/.test(text))return 'fog';
  if(/放下/.test(text))return 'drop';if(/交接|交给|接受物品/.test(text))return 'interact';
  if(/治疗/.test(text))return 'heal';if(/攻击|推挤/.test(text))return 'attack';if(/闪避/.test(text))return 'dodge';if(/交互|救援/.test(text))return 'interact';
  if(/下一课|完成归灯/.test(text))return 'next';if(/训练|练习/.test(text))return 'training';
  if(/登录|注册|账户|踏入/.test(text))return 'enter';if(/房间|大厅|邀请码/.test(text))return 'rooms';
  if(/准备|出征|开启归灯/.test(text))return 'play';if(/集市|营地/.test(text))return 'camp';
  if(/目标/.test(text))return 'target';if(/背包/.test(text))return 'drop';
  if(/盾|灯卫|单体|引路|形态|灯阵/.test(text))return 'skill';if(/^\d+$/.test(text.trim()))return 'count';
  return 'generic';
}
interface Props extends ButtonHTMLAttributes<HTMLButtonElement>{iconKind?:ButtonIcon}
export function ActionButton({children,iconKind,className='',disabled,onPointerEnter,onPointerLeave,onPointerDown,onPointerUp,onPointerCancel,onFocus,onBlur,...props}:Props){
  const [hovered,setHovered]=useState(false);const [focused,setFocused]=useState(false);const [pressed,setPressed]=useState(false);
  const {settings}=useFeedbackSettings();
  const text=`${props['aria-label']??''} ${textOf(children)}`;
  const kind=iconKind??identify(text,className);const pair=pairs[kind];
  const selected=/(^|\s)(active|selected)(\s|$)/.test(className);
  const busy=/连接中|正在连接|建立远征|保存中|制作中|研究中/.test(text);
  const active=!disabled&&(hovered||focused||pressed);
  const checked=/已复制|已收藏|已公开|已提交/.test(text);
  const icon=busy?LoaderCircle:checked?Check:selected&&!active?Check:active?pair[1]:pair[0];
  const content=typeof children==='string'&&/^[×↑↓←→⚙]$/.test(children.trim())?null:children;
  return <button {...props} disabled={disabled} className={`action-button ${className}`} data-icon-kind={kind} data-icon-active={active} data-icon-motion={settings.motion?'user':'always'}
    onPointerEnter={event=>{setHovered(true);onPointerEnter?.(event);}} onPointerLeave={event=>{setHovered(false);setPressed(false);onPointerLeave?.(event);}}
    onPointerDown={event=>{setPressed(true);onPointerDown?.(event);}} onPointerUp={event=>{setPressed(false);onPointerUp?.(event);}} onPointerCancel={event=>{setPressed(false);onPointerCancel?.(event);}}
    onFocus={event=>{setFocused(true);onFocus?.(event);}} onBlur={event=>{setFocused(false);setPressed(false);onBlur?.(event);}}>
    <MorphIcon className={`button-svg ${busy?'button-svg-busy':''}`} icon={icon} size={18} strokeWidth={1.65} spring="snappy" reducedMotion={settings.motion?'user':'always'} aria-hidden="true" focusable="false"/>{content}
  </button>;
}
