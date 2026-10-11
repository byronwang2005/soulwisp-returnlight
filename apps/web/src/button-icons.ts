import type {IconInput} from 'morphicons/react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,Bell,Binoculars,BookOpen,Cog,Crosshair,Check,CheckCheck,ChevronDown,ChevronUp,CloudFog,Compass,Copy,Flag,Flame,Footprints,Hand,Handshake,HeadphoneOff,Headphones,HeartPulse,Library,LoaderCircle,LogIn,LogOut,Menu,Mic,MicOff,MonitorCog,Moon,Package,PackageOpen,Pickaxe,RotateCcw,Scale,ScanSearch,Save,ScrollText,Send,Settings,Shield,Shirt,SkipForward,Sparkles,Swords,UserRound,UserRoundPlus,Users,Volume2,VolumeX,Vote,Wrench,X} from 'lucide';

export const BUTTON_ICONS={
  enter:LogIn,register:UserRoundPlus,leave:LogOut,close:X,camp:Flame,rooms:Users,training:BookOpen,
  music:Volume2,settings:Settings,quality:MonitorCog,save:Save,copy:Copy,craft:Wrench,research:Library,
  outfit:Shirt,moveUp:ArrowUp,moveDown:ArrowDown,moveLeft:ArrowLeft,moveRight:ArrowRight,
  attack:Swords,skill:Shield,dodge:Footprints,interact:Hand,heal:HeartPulse,vote:Vote,abstain:UserRound,
  evidence:ScrollText,send:Send,mic:Mic,listen:Headphones,retry:RotateCcw,menu:Menu,expand:ChevronDown,
  next:SkipForward,moon:Moon,fog:CloudFog,drop:PackageOpen,play:Flag,boon:Sparkles,target:Compass,
  count:Users,bag:Package,transfer:Handshake,
  warden:Shield,scout:Binoculars,scavenger:Pickaxe,broker:Scale,medic:HeartPulse,engineer:Cog,forensic:ScanSearch,bellkeeper:Bell,ranger:Crosshair,
} satisfies Record<string,IconInput>;
export type ButtonIcon=keyof typeof BUTTON_ICONS;
export type ButtonState='default'|'busy'|'success'|'on'|'off'|'expanded'|'collapsed';
/** Only a confirmed application state can change a glyph. Hover never changes its meaning. */
export function buttonGlyph(kind:ButtonIcon,state:ButtonState):IconInput{
  if(state==='busy')return LoaderCircle;
  if(state==='success')return kind==='copy'?CheckCheck:Check;
  if(kind==='mic'&&state==='off')return MicOff;
  if(kind==='listen'&&state==='off')return HeadphoneOff;
  if(kind==='music'&&state==='off')return VolumeX;
  if(kind==='expand'||kind==='menu')return state==='expanded'?ChevronUp:state==='collapsed'?ChevronDown:BUTTON_ICONS[kind];
  return BUTTON_ICONS[kind];
}
