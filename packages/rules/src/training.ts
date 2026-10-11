import {mapRoute,type GameCommand,type GameView} from '@wangxu/shared';
import {GameEngine} from './engine.js';
import {getConfig,type Layout,type LayoutObject} from './config.js';
import {BOONS} from './content.js';

export function trainingLayout():Layout {
  const nodes=[{id:'sanctuary',name:'归灯堂',x:500,y:350,radius:170},{id:'node-1',name:'余灯钟楼',x:500,y:-90,radius:155},{id:'node-2',name:'旧城矿庭',x:940,y:350,radius:155},{id:'node-3',name:'秘文书库',x:500,y:790,radius:155},{id:'node-4',name:'归灯门',x:60,y:350,radius:190}];
  const objects:LayoutObject[]=[];
  const add=(id:string,kind:LayoutObject['kind'],name:string,nodeId:string,dx:number,dy:number,extra:Partial<LayoutObject>={})=>{const n=nodes.find(n=>n.id===nodeId)!;objects.push({id,kind,name,x:n.x+dx,y:n.y+dy,nodeId,active:true,progress:0,...extra});};
  add('warehouse','deposit','公共仓库','sanctuary',-84,84);
  add('stash','deposit','珍藏寄存箱','sanctuary',84,84);
  add('cleanse','cleanse','降蚀台','sanctuary',-84,-84);
  add('purify','cleanse','归灯芯净化台','sanctuary',84,-84);
  add('beacon-0','beacon','钟楼灯柱','node-1',60,-60);
  add('beacon-1','beacon','城门灯柱','node-4',130,-15);
  add('resource-training-start','resource','矿庭亡絮','node-2',52,-40,{amount:4});
  add('resource-training-repair','resource','降蚀工程亡絮','node-4',-100,-72,{amount:2,active:false});
  add('resource-training-core','resource','净化工程亡絮','node-2',64,64,{amount:2,active:false});
  add('chest-training','chest','书库珍藏','node-3',48,48,{amount:1});
  add('guardian','elite','训练守卫','node-4',0,-100,{hp:66,active:false});
  add('core','core','归灯芯','node-2',-60,40,{active:false});
  add('altar-training','altar','钟楼暗祭坛','node-1',-60,-60,{active:false});
  add('exit','exit','归灯门','node-4',0,72);
  return {nodes,objects,edges:[['node-1','node-2'],['node-2','node-3'],['node-3','node-4'],['node-4','node-1'],['sanctuary','node-1'],['sanctuary','node-3']],variant:0};
}
export class TrainingSession {
  readonly engine:GameEngine;step=0;private escortRoute?:{x:number;y:number}[];
  flags={skill:false,dodge:false,published:false,said:false,voted:false,transformed:false,corrupted:false,fog:false,deposited:false};
  constructor(readonly wolf:boolean,step=0){
    this.engine=new GameEngine({roomId:'training-local',invite:'TRAIN',config:{...getConfig(4),prepSeconds:1,exploreSeconds:900,discussionSeconds:900,voteSeconds:900,draftSeconds:900,extractionSeconds:90},seed:17,layout:trainingLayout()});
    ['你','余灯·阿芙','回声·诺尔','行商·叶'].forEach((name,index)=>this.engine.addPlayer({id:index?`guide-${index}`:'trainee',name}));
    for(const id of this.engine.players.keys())this.engine.command(id,{type:'ready',ready:true});
    this.engine.tick(1);
    this.me.faction=wolf?'wolf':'human';
    for(const p of this.engine.players.values())if(p.id!=='trainee')p.faction=p.id==='guide-3'&&!wolf?'wolf':'human';
    const book=this.engine.layout.nodes[3]!;const guide=this.engine.players.get('guide-2')!;guide.x=book.x-60;guide.y=book.y-40;
    const ally=this.engine.players.get('guide-1')!;ally.x=60+80;ally.y=350+40;
    const altar=this.engine.objects.find(o=>o.id==='altar-training')!,guideWolf=this.engine.players.get('guide-3')!;guideWolf.x=altar.x-42;guideWolf.y=altar.y;
    for(let previous=0;previous<step;previous++)this.restoreCheckpoint(previous);
    this.enter(step);
  }
  get me(){return this.engine.players.get('trainee')!;}
  get view(){return this.engine.viewFor('trainee');}
  private object(id:string){return this.engine.objects.find(o=>o.id===id)!;}
  private restoreCheckpoint(step:number){
    if(step===0){this.object('resource-training-start').active=false;this.object('resource-training-start').amount=0;this.me.resources=4;this.me.x=992;this.me.y=310;}
    if(step===1){this.object('chest-training').active=false;this.object('chest-training').amount=0;this.me.stashUsed=true;this.me.supplies=1;this.me.resources=0;this.engine.sharedResources=2;this.object('beacon-0').progress=1;this.engine.beaconsLit=1;this.me.x=560;this.me.y=-110;}
    if(step===2){this.object('guardian').active=false;this.engine.eliteDefeated=true;this.object('beacon-1').progress=1;this.engine.beaconsLit=2;this.object('resource-training-repair').active=false;this.object('resource-training-repair').amount=0;this.engine.moon=0;this.me.x=416;this.me.y=266;this.me.evidence.push({id:'training-resumed-engineering',source:'observation',text:'续学记录：已完成钟楼点灯、城门救援与公共降蚀。',chapter:1,at:0});}
    if(step===3){this.engine.remaining=.01;this.engine.tick(.02);}
    if(step===4)this.me.boons.push(BOONS[0]!.id);
  }
  enter(step:number){
    this.step=step;const engine=this.engine;
    if(step===2&&!engine.eliteDefeated){
      this.object('guardian').active=true;this.object('resource-training-repair').active=true;this.object('altar-training').active=true;
      const ally=engine.players.get('guide-1')!;ally.down=true;ally.hp=0;ally.downUntil=Number.MAX_SAFE_INTEGER;
      if(!this.wolf){const guide=engine.players.get('guide-3')!,altar=this.object('altar-training');guide.x=altar.x-42;guide.y=altar.y;engine.command(guide.id,{type:'corrupt',targetId:altar.id});}
    }
    if(step===3){
      // Use the real chapter transition, including the normal return to the hall.
      engine.remaining=.01;engine.tick(.02);
    }
    if(step===4){engine.phase='DRAFT';engine.remaining=900;this.me.draftOptions=BOONS.slice(0,3).map(b=>b.id);}
    if(step===5){engine.phase='EXPLORE';engine.remaining=900;engine.chapter=engine.config.chapters;this.object('core').active=true;this.object('resource-training-core').active=true;}
  }
  command(command:GameCommand){
    const accepted=this.engine.command('trainee',command);
    if(accepted){
      if(command.type==='skill')this.flags.skill=true;if(command.type==='dodge')this.flags.dodge=true;
      if(command.type==='publish')this.flags.published=true;if(command.type==='say')this.flags.said=true;
      if(command.type==='vote')this.flags.voted=true;if(command.type==='transform')this.flags.transformed=true;
      if(command.type==='fog')this.flags.fog=true;
    }
    return accepted;
  }
  tick(dt:number){
    if(this.step===5&&this.engine.corePurified){
      const ally=this.engine.players.get('guide-1')!,exit=this.object('exit'),{nodes,edges}=this.engine.layout;
      this.escortRoute??=[...mapRoute(ally,nodes,edges,exit.nodeId!).map(id=>nodes.find(n=>n.id===id)!),exit];
      while(this.escortRoute.length>1&&Math.hypot(this.escortRoute[0]!.x-ally.x,this.escortRoute[0]!.y-ally.y)<8)this.escortRoute.shift();
      const next=this.escortRoute[0]!,dx=next.x-ally.x,dy=next.y-ally.y,length=Math.hypot(dx,dy);
      this.engine.command(ally.id,{type:'move',x:length>8?dx/length:0,y:length>8?dy/length:0,seq:ally.seq+1});
    }
    this.engine.tick(dt);
    if(this.step===1&&this.me.resources===0&&this.engine.sharedResources>=2)this.flags.deposited=true;
    if(this.step===2&&this.wolf&&this.engine.moon>0)this.flags.corrupted=true;
    if(this.step===5&&this.me.carryingCore&&this.engine.corePurified&&this.engine.phase==='EXPLORE'){this.engine.phase='EXTRACT';this.engine.remaining=25;}
  }
  get done(){
    if(this.step===0)return this.me.resources>=4&&Math.hypot(this.me.x-500,this.me.y-350)>70;
    if(this.step===1)return !this.object('chest-training').active&&this.me.stashUsed&&this.flags.deposited&&this.engine.beaconsLit>=1;
    if(this.step===2)return this.flags.skill&&this.flags.dodge&&this.engine.eliteDefeated&&!this.engine.players.get('guide-1')!.down&&this.engine.beaconsLit===2&&this.engine.moon===0&&!this.object('resource-training-repair').active&&(!this.wolf||this.flags.transformed&&this.flags.corrupted&&this.flags.fog);
    if(this.step===3)return this.flags.published&&this.flags.said&&this.flags.voted;
    if(this.step===4)return this.me.draftOptions.length===0;
    return this.engine.holdProgress>=7.95&&this.engine.result?.winner==='human';
  }
  beginVote(){this.engine.remaining=.01;this.engine.tick(.02);for(const id of this.engine.players.keys())if(id!=='trainee')this.engine.command(id,{type:'vote',targetId:null});}
  objective():{text:string;targetId?:string;nodeId?:string}{
    if(this.step===0)return {text:'前往矿庭，采集 4 份亡絮',targetId:'resource-training-start',nodeId:'node-2'};
    if(this.step===1){
      if(this.object('chest-training').active)return {text:'前往书库，打开珍藏储藏点',targetId:'chest-training',nodeId:'node-3'};
      if(!this.flags.deposited)return {text:'返回归灯堂，向公共仓库交付亡絮',targetId:'warehouse',nodeId:'sanctuary'};
      if(!this.me.stashUsed)return {text:'将刚取得的珍藏放入寄存箱',targetId:'stash',nodeId:'sanctuary'};
      return {text:'前往钟楼，点亮第一根灯柱',targetId:'beacon-0',nodeId:'node-1'};
    }
    if(this.step===2){
      if(!this.flags.skill)return {text:'按 Q 使用灯卫技能'};
      if(!this.flags.dodge)return {text:'先走离灯柱，再沿移动方向按 Shift 或触屏闪避'};
      if(!this.engine.eliteDefeated)return {text:'前往城门，面对守卫按空格攻击',targetId:'guardian',nodeId:'node-4'};
      if(this.engine.players.get('guide-1')!.down)return {text:'靠近倒地的阿芙，按 E 救援',targetId:'guide-1',nodeId:'node-4'};
      if(this.object('resource-training-repair').active)return {text:'采集城门旁的降蚀工程亡絮',targetId:'resource-training-repair',nodeId:'node-4'};
      if(this.engine.beaconsLit<2)return {text:'点亮城门灯柱',targetId:'beacon-1',nodeId:'node-4'};
      if(this.wolf&&(!this.flags.transformed||!this.flags.corrupted||!this.flags.fog))return {text:'前往钟楼：显形、腐化祭坛，并使用灰雾',targetId:'altar-training',nodeId:'node-1'};
      return {text:'返回归灯堂，用降蚀台消除蚀月',targetId:'cleanse',nodeId:'sanctuary'};
    }
    if(this.step===5){
      if(this.object('resource-training-core').active)return {text:'前往矿庭，采集 2 份净化亡絮',targetId:'resource-training-core',nodeId:'node-2'};
      if(!this.me.carryingCore)return {text:'取得矿庭中的唯一归灯芯',targetId:'core',nodeId:'node-2'};
      if(!this.engine.corePurified)return {text:'返回归灯堂，使用净化台',targetId:'purify',nodeId:'sanctuary'};
      return {text:'护送到归灯门，守住终钟最后八秒',targetId:'exit',nodeId:'node-4'};
    }
    return {text:this.step===3?'发布亲历证据、发言并完成表决':'选择一份本局祝福'};
  }
}
