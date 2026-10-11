export type QualityMode='auto'|'high'|'medium'|'low';
export const QUALITY_MODES:QualityMode[]=['auto','high','medium','low'];
export const QUALITY_LABELS:Record<QualityMode,string>={auto:'自动画质',high:'高画质',medium:'均衡',low:'流畅'};
export function initialQuality():QualityMode {
  const saved=localStorage.getItem('wangxu-render-mode');
  if(QUALITY_MODES.includes(saved as QualityMode))return saved as QualityMode;
  const legacy=localStorage.getItem('wangxu-quality');
  if(legacy)localStorage.setItem('wangxu-manual-quality',legacy);
  return 'auto';
}
export function qualityProfile(level:number,nativeDpr:number){
  return {level,resolution:level>=2?'2k':'1k',dpr:Math.min(nativeDpr,level>=2?2:level===1?1.5:1),shadows:level>=3,shadowSize:level===4?2048:1024,normal:level>0,decorations:level>=3};
}
export class AutoQuality {
  level=4;private slow=0;private stable=0;private retryAt=0;private trial=false;
  sample(fps:number,now:number){
    if(fps<57){this.stable=0;if(++this.slow>=2){if(this.trial)this.retryAt=now+30000;this.level=Math.max(0,this.level-1);this.slow=0;this.trial=false;}}
    else{this.slow=0;if(fps>=59)this.stable+=2500;else this.stable=0;if(this.stable>=10000&&now>=this.retryAt&&this.level<4){this.level++;this.stable=0;this.trial=true;}else if(this.stable>=10000)this.trial=false;}
    return this.level;
  }
  resetSamples(){this.slow=0;this.stable=0;this.trial=false;}
}
