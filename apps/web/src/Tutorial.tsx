import {ActionButton} from './ActionButton';
import {useEffect,useRef,useState} from 'react';
import {TrainingSession} from '@wangxu/rules';
import type {GameCommand} from '@wangxu/shared';
import {request,requestId} from './api';
import {GameScreen} from './GameUI';
import type {AssetManifest} from './World';
import {tutorialMusic,type MusicScene} from './music-catalog';

const LESSONS=[
  {title:'循灯而行',story:'我叫艾琳，曾是归灯行会的引路人。先沿旧城通路走到矿庭，替我接住散失的记忆。',description:'WASD 与触屏方向键跟随画面方向；连接道路会轻轻导向，转向即可离开。进入物件交互范围后自动锁定，停下按 E 或动作按钮采集。移动或受击会打断读条。'},
  {title:'点亮共同的归途',story:'珍藏可以寄存，亡絮则交给共同的灯火。看清每种装置的用途，再走向钟楼。',description:'在书库开箱，回归灯堂向公共仓库交付亡絮，并把珍藏存入寄存箱。最后前往钟楼点灯；两种箱子承担不同用途。'},
  {title:'战斗也会留下线索',story:'守卫忘了它保护过谁，阿芙却还在等我们。完成救援，再让城门灯柱与降蚀台恢复旧城的秩序。',description:'头顶五瓣心灯每瓣代表 20 点生命，危险时闪动。Q 使用职业技能，Shift 闪避。面对守卫按空格攻击，靠近倒地者按 E 救援。采集补给、点亮城门灯柱，然后返回归灯堂降蚀。'},
  {title:'让证据先于判断',story:'刚才的点灯、救援和降蚀都留下了痕迹。让亲历记录与陈述相互核对，再作判断。',description:'发布一条你实际获得的记录，发送陈述，然后进入表决。票数必须严格超过所有有权者的一半，弃权计入分母。'},
  {title:'选择这一程的祝福',story:'把刚才的记忆织成祝福，让下一段护送走得更稳。',description:'选择一个本局祝福。它影响移动、救援或工程，不会增加票权；下一局仍可选择新的构筑。'},
  {title:'护送唯一的归灯芯',story:'最后一盏灯仍在矿庭。带它回到净化台，再沿通路护送到真正的归灯门。',description:'先采集净化工程亡絮，再取得灯芯；灯芯占两格。回归灯堂净化，然后前往城门，在终钟最后八秒持续守圈。'}
];
function initialLesson(wolf:boolean,initialStep:number){
  const saved=Number(localStorage.getItem(wolf?'wangxu-wolf-tutorial':'wangxu-tutorial-step')||0);
  return Math.min(5,Math.max(0,initialStep>=6?0:initialStep,Number.isFinite(saved)&&saved<6?saved:0));
}
export function Tutorial({onMusicScene,assets,quality,initialStep,wolf,authenticated,onExit,onError}:{onMusicScene:(scene:MusicScene)=>void;assets:AssetManifest|null;quality:string;initialStep:number;wolf:boolean;authenticated:boolean;onExit:()=>void;onError:(message:string)=>void}){
  const [step,setStep]=useState(()=>initialLesson(wolf,initialStep));
  const sessionRef=useRef<TrainingSession|null>(null);if(!sessionRef.current)sessionRef.current=new TrainingSession(wolf,step);
  const session=sessionRef.current;
  const [view,setView]=useState(()=>session.view);const [done,setDone]=useState(false);const [complete,setComplete]=useState(false);const [busy,setBusy]=useState(false);
  const [compact,setCompact]=useState(()=>matchMedia('(max-width:600px)').matches);
  useEffect(()=>{if(session.step!==step)session.enter(step);setDone(false);setView(session.view);},[step,session]);
  useEffect(()=>{let previous=performance.now();const timer=setInterval(()=>{const now=performance.now();let budget=Math.min(1,(now-previous)/1000);previous=now;while(budget>0){const dt=Math.min(.05,budget);session.tick(dt);budget-=dt;}setDone(session.done);setView(session.view);},50);return()=>clearInterval(timer);},[session]);
  useEffect(()=>{onMusicScene(complete?'victory':step===3&&view.phase==='VOTE'?'vote':tutorialMusic[step]);},[step,view.phase,complete,onMusicScene]);
  function send(command:GameCommand){session.command(command);setView(session.view);}
  function beginVote(){session.beginVote();setView(session.view);}
  async function save(completed:boolean){
    const next=completed?6:step;localStorage.setItem(wolf?'wangxu-wolf-tutorial':'wangxu-tutorial-step',String(next));
    if(authenticated&&!wolf){const last=completed?6:step;for(let stage=Math.min(6,initialStep+1);stage<=last;stage++)await request('/tutorial',{step:stage,complete:completed&&stage===6,requestId:requestId()});}
  }
  async function exit(){setBusy(true);try{await save(false);}catch(error){onError((error as Error).message);}finally{setBusy(false);onExit();}}
  async function next(){if(!done)return;if(step<5){localStorage.setItem(wolf?'wangxu-wolf-tutorial':'wangxu-tutorial-step',String(step+1));setStep(step+1);}else{setBusy(true);try{await save(true);setComplete(true);}catch(error){onError((error as Error).message);}finally{setBusy(false);}}}
  const objective=session.objective();const destination=view.nodes.find(node=>node.id===objective.nodeId);
  return <div className="tutorial"><GameScreen view={view} send={send} assets={assets} quality={quality} training onLeave={()=>void exit()} trainingDestination={done?undefined:objective.nodeId} trainingTarget={done?undefined:objective.targetId} guide={<div className={`tutorial-guide panel ${compact?'compact':''}`}>
    <div className="section-head"><span className="eyebrow">{wolf?'蚀月者练习':'初行者训练'} / {step+1} / 6</span><div className="guide-tools"><ActionButton iconKind="expand" iconState={compact?'default':'expanded'} aria-expanded={!compact} aria-label="展开或收起训练指引" onClick={()=>setCompact(!compact)}>{compact?'展开':'收起'}</ActionButton><ActionButton iconKind="save" iconState={busy?'busy':'default'} disabled={busy} onClick={()=>void exit()} aria-label="保存并离开">离开</ActionButton></div></div>
    <h2>{LESSONS[step].title}</h2>{!compact&&<><blockquote className="story-memory"><span>艾琳 · 残留记忆</span><p>{LESSONS[step].story}</p></blockquote><p>{LESSONS[step].description}</p></>}
    {!compact&&wolf&&step===2&&<p className="wolf-hint">蚀月练习：在钟楼显形、腐化暗祭坛并使用灰雾，然后实际消除这次腐化。</p>}
    {!compact&&<div className="lesson-progress">{LESSONS.map((_,index)=><i key={index} className={index<=step?'active':''}/>)}</div>}
    <div className="lesson-task"><span data-training-target={objective.targetId} data-training-node={objective.nodeId}>{done?'✓':'◇'} {done?'本课实际操作已完成':objective.text}</span>{destination&&!done&&<small>循地面金色虚线前往{destination.name}，靠近目标后按提示操作。</small>}
    {step===3&&view.phase==='DISCUSS'&&<ActionButton iconKind="vote" className="primary" disabled={!session.flags.published||!session.flags.said} onClick={beginVote}>进入表决</ActionButton>}
    <ActionButton iconKind="next" iconState={busy?'busy':'default'} className="primary" disabled={!done||busy} onClick={()=>void next()}>{busy?'保存中…':step===5?'完成归灯训练':'下一课 →'}</ActionButton></div>
    {!compact&&<small>训练物品独立保存 · 可保存离开并继续本课</small>}
  </div>}/>{complete&&<div className="modal-overlay"><section className="panel training-complete"><span className="eyebrow">YOU KNOW THE WAY HOME</span><h1>你的第一束归灯，已点亮。</h1><p>{authenticated&&!wolf?'初行者灯饰已收入营地。现在可以与真正的同行者出征。':'你已完成独立训练。登录后可以保存营地收藏与真实远征记录。'}</p><ActionButton iconKind="camp" className="primary large" onClick={onExit}>返回余灯集市</ActionButton></section></div>}</div>;
}
