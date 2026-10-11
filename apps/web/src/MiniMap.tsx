import {useId,useState} from 'react';
import type {GameView,Vec2} from '@wangxu/shared';
import {ActionButton} from './ActionButton';
import {mapProjection,type NavigationTarget} from './navigation';

export function MiniMap({view,route,target,training,onDestination}:{view:GameView;route:Vec2[];target?:NavigationTarget;training:boolean;onDestination:(id?:string)=>void}) {
  const [open,setOpen]=useState(()=>!training&&matchMedia('(min-width:1101px) and (min-height:651px)').matches);
  const panelId=useId();const me=view.players.find(p=>p.id===view.self.id)!;
  const nodes=view.nodes.map(node=>({...node,...mapProjection(node)}));
  if(!nodes.length)return null;
  const left=Math.min(...nodes.map(n=>n.x-n.radius))-25,top=Math.min(...nodes.map(n=>n.y-n.radius))-25;
  const right=Math.max(...nodes.map(n=>n.x+n.radius))+25,bottom=Math.max(...nodes.map(n=>n.y+n.radius))+25;
  const position=me.x!==null&&me.y!==null?mapProjection({x:me.x,y:me.y}):undefined;
  const facing=mapProjection(me.facing??{x:0,y:1}),heading=Math.atan2(facing.y,facing.x)*180/Math.PI+90;
  const current=view.nodes.find(node=>me.x!==null&&me.y!==null&&Math.hypot(me.x-node.x,me.y-node.y)<=node.radius)?.name??'连接通路';
  const publicTargets=view.objects.filter(o=>o.active&&['beacon','deposit','cleanse','exit'].includes(o.kind));
  const destination=target?mapProjection(target):undefined;
  return <aside className={`navigation-map panel ${open?'expanded':''}`} aria-label="石城导航">
    <ActionButton iconKind="target" className="map-toggle" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(!open)}>{open?'收起地图':'小地图'} · {current}</ActionButton>
    {open&&<div id={panelId} className="map-content"><svg viewBox={`${left} ${top} ${right-left} ${bottom-top}`} role="img" aria-label={`当前位置：${current}${target?`，目的地：${target.name}`:''}`}>
      {(view.edges??[]).map(([a,b])=>{const from=nodes.find(n=>n.id===a),to=nodes.find(n=>n.id===b);return from&&to?<line key={`${a}-${b}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#60736a" strokeWidth={20}/>:null;})}
      {nodes.map(node=><g key={node.id}><ellipse cx={node.x} cy={node.y} rx={node.radius} ry={node.radius*.64} fill="#263b35" stroke="#82937a" strokeWidth={3}/><text x={node.x} y={node.y-node.radius*.65-10} textAnchor="middle">{node.name}</text></g>)}
      {route.length>1&&<polyline points={route.map(mapProjection).map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffe1a0" strokeWidth={7} strokeDasharray="12 8"/>}
      {view.players.filter(p=>p.id!==me.id&&p.x!==null&&p.y!==null).map(player=>{const p=mapProjection({x:player.x!,y:player.y!});return <circle key={player.id} cx={p.x} cy={p.y} r={8} fill="#9dcccd"/>;})}
      {publicTargets.map(object=>{const p=mapProjection(object);return <g key={object.id}><circle cx={p.x} cy={p.y} r={11} fill={object.kind==='exit'?'#9ab7a5':'#b58a58'} stroke="#efe4ce" strokeWidth={2}/><title>{object.name}</title></g>;})}
      {destination&&<circle cx={destination.x} cy={destination.y} r={17} fill="none" stroke="#ffe1a0" strokeWidth={5}/>}
      {position&&<g transform={`translate(${position.x} ${position.y})`}><circle r={23} fill="#f4ce8133"/><circle r={12} fill="#ffe1a0" stroke="#172b27" strokeWidth={4}/><path d="M 0 -31 L -8 -18 L 8 -18 Z" transform={`rotate(${heading})`} fill="#ffe1a0"/></g>}
    </svg><div className="map-legend"><span>● 你</span><span>● 可见同行者</span><span>◉ 公共设施</span></div>
    {training?<p>{target?`循地面金色虚线前往${target.name}`:'完成当前训练操作'}</p>:<label>导航目的地<select value={target?.id??''} onChange={event=>onDestination(event.target.value||undefined)}><option value="">选择地点</option>{view.nodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}{publicTargets.map(object=><option key={object.id} value={object.id}>{object.name}</option>)}</select></label>}
    </div>}
  </aside>;
}
