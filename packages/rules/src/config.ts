import type { GameConfig, MapNode, Profession, WorldObject } from '@wangxu/shared';

export const RULE_VERSION = 'wangxu-0.1.0';
const professions: Profession[] = ['warden','scout','scavenger','broker','medic','engineer','forensic','bellkeeper','ranger'];
const rows: Record<number, number[]> = {
  // humans, wolves, chapters, explore, discuss, beacons, E, shadow, removal, finisher, nodes, supply
  4:[3,1,3,150,60,2,5,2,1,0,5,12],
  5:[4,1,3,165,70,2,5,3,2,0,6,12],
  6:[4,2,4,170,75,3,5,2,3,1,7,16],
  7:[5,2,4,175,80,3,6,3,3,1,8,16],
  8:[6,2,4,180,90,3,6,3,4,2,9,16],
  9:[7,2,4,185,100,4,7,4,5,3,10,18],
  10:[7,3,4,185,110,4,7,3,6,3,11,18],
};

export function getConfig(players: number): GameConfig {
  if (!Number.isInteger(players) || !rows[players]) throw new Error('人数必须为4–10');
  const [humans,wolves,chapters,exploreSeconds,discussionSeconds,beacons,moonLimit,shadowBudget,permanentRemovalCap,wolfFinisherGameCap,mapNodes,guaranteedSupply] = rows[players]!;
  return {players,humans:humans!,wolves:wolves!,chapters:chapters!,exploreSeconds:exploreSeconds!,discussionSeconds:discussionSeconds!,beacons:beacons!,moonLimit:moonLimit!,shadowBudget:shadowBudget!,permanentRemovalCap:permanentRemovalCap!,wolfFinisherGameCap:wolfFinisherGameCap!,mapNodes:mapNodes!,guaranteedSupply:guaranteedSupply!,professions:players === 10 ? [...professions,'warden'] : professions.slice(0,players),voteSeconds:20,draftSeconds:15,prepSeconds:45,extractionSeconds:90,darkAltars:players >= 9 ? 3 : 2,statementSeconds:players <= 5 ? 10 : 8,ruleVersion:RULE_VERSION};
}

export interface LayoutObject extends WorldObject { chapter?:number; guaranteed?:boolean; nodeId?:string; }
export interface Layout { nodes:MapNode[]; objects:LayoutObject[]; edges:[string,string][]; variant:number; }
export function seedNumber(seed:number|string):number {
  if (typeof seed === 'number') return Number.isFinite(seed) ? seed >>> 0 : 1;
  let n=2166136261; for(const ch of seed) n=Math.imul(n ^ ch.charCodeAt(0),16777619); return n >>> 0;
}
export function getLayout(config:GameConfig, seed:number|string=1):Layout {
  const variant=seedNumber(seed)%3;
  const names=['归灯堂','余灯钟楼','旧城矿庭','秘文书库','归灯门','絮园','机关庭','回响廊','巡林苑','旧墓园','西回廊'];
  const nodes:MapNode[]=[{id:'sanctuary',name:names[0]!,x:500,y:350,radius:82}];
  for(let i=1;i<config.mapNodes;i++) {
    const angle=(i-1)*2*Math.PI/(config.mapNodes-1)-Math.PI/2+variant*0.12;
    nodes.push({id:`node-${i}`,name:names[i]!,x:500+Math.cos(angle)*(variant===1 ? 345 : 325),y:350+Math.sin(angle)*(variant===2 ? 240 : 225),radius:82});
  }
  const edges:[string,string][]=[];
  for(let i=1;i<nodes.length;i++) edges.push([nodes[i]!.id,nodes[i===nodes.length-1 ? 1 : i+1]!.id]);
  edges.push(['sanctuary',nodes[1]!.id],['sanctuary',nodes[1+Math.floor((nodes.length-1)/2)]!.id]);
  const objects:LayoutObject[]=[];
  const add=(id:string,kind:WorldObject['kind'],name:string,node:MapNode,dx=0,dy=0,extra:Partial<LayoutObject>={}) => objects.push({id,kind,name,x:node.x+dx,y:node.y+dy,active:true,progress:0,nodeId:node.id,...extra});
  const home=nodes[0]!; const exit=nodes[nodes.length-1]!;
  add('warehouse','deposit','公共仓库',home,-22,15);
  add('stash','deposit','一次寄存',home,25,15);
  add('cleanse','cleanse','降蚀台',home,-25,-25);
  add('purify','cleanse','归灯芯净化台',home,25,-25);
  add('exit','exit','归灯门',exit,0,20);
  add('core','core','归灯芯',nodes[1+(variant+1)%(nodes.length-1)]!,0,-18,{active:false,chapter:2});
  add('guardian','elite','守门精英',exit,0,-25,{active:false,chapter:config.chapters,hp:180+50*config.players});
  for(let i=0;i<config.beacons;i++) add(`beacon-${i}`,'beacon',`灯柱${i+1}`,nodes[1+(i+variant)%(nodes.length-1)]!,20,15);
  for(let i=0;i<config.darkAltars;i++) add(`altar-${i}`,'altar',`暗祭坛${i+1}`,nodes[1+(Math.floor((i+1)*(nodes.length-1)/(config.darkAltars+1))+variant)%(nodes.length-1)]!,-25,10);
  for(let chapter=1;chapter<=config.chapters;chapter++) {
    const count=Math.floor(config.guaranteedSupply/config.chapters)+(chapter <= config.guaranteedSupply%config.chapters ? 1 : 0);
    for(let j=0;j<Math.ceil(count/2);j++) add(`resource-${chapter}-${j}`,'resource','亡絮·工程份额',nodes[1+(j+chapter+variant)%(nodes.length-1)]!,j%2 ? -15 : 15,-22,{active:false,chapter,guaranteed:true,amount:Math.min(2,count-j*2)});
    add(`chest-${chapter}`,'chest','遗迹储藏点',nodes[1+(chapter+variant+1)%(nodes.length-1)]!,15,30,{active:false,chapter,amount:2});
  }
  return {nodes,objects,edges,variant};
}
