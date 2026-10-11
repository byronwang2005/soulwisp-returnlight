import {segmentDistance,type MapNode,type RegionTheme} from '@wangxu/shared';
import {part,type Part,assembleArt,type ArtMaterials} from './art-geometry';
export const REGION_THEMES:RegionTheme[]=['hall','bell','mine','library','gate','garden','machine','echo','forest','grave','gallery'];
export function regionParts(theme:RegionTheme):Part[]{
 const stone='foundation',copper='bronze',wood='wood',cloth='cloth',box=(size:number[],at:[number,number,number],surface:Part['surface']=stone,rotation?:[number,number,number])=>part('box',size,at,surface,rotation),ring=(radius:number,at:[number,number,number],surface:Part['surface']=copper)=>part('torus',[radius,.045,16],at,surface,[Math.PI/2,0,0]);
 const arch=(x:number,h=2.5):Part[]=>[box([.35,h,.4],[x-1,h/2,0]),box([.35,h*.8,.4],[x+1,h*.4,0]),box([2.5,.3,.5],[x,h,0],stone,[0,0,.1])];
 switch(theme){
 case 'hall':return [ring(1.8,[0,.035,0],stone),ring(1.25,[0,.05,0]),ring(.8,[0,.065,0]),...[-1,0,1].flatMap(x=>[box([.09,1.5,.09],[x*1.3,.75,-1.4],copper),box([.35,.25,.35],[x*1.3,1.5,-1.4],copper)]),box([1.4,.4,.07],[0,.5,1.2],copper)];
 case 'bell':return [...arch(0,3.2),box([2.1,.14,.18],[0,2.9,0],wood),part('cone',[.6,.75,12],[0,2.05,0],copper),part('sphere',[.12],[0,1.62,0],copper),ring(1.5,[0,.035,0]),box([.07,.018,1.2],[0,.07,0],copper)];
 case 'mine':return [...[-1,1].flatMap(x=>[box([.14,.09,3.8],[x*.6,.08,0],copper),box([.3,2.3,.3],[x*1.7,1.15,-1.4],wood)]),box([3.9,.3,.32],[0,2.3,-1.4],wood),...[-1,0,1].map(z=>box([1.8,.1,.16],[0,.025,z],wood)),...[-1,1].map(x=>part('sphere',[1.1],[x*1.8,.3,.5],stone))];
 case 'library':return [...[-1,1].flatMap(x=>[box([1.4,1.9,.3],[x*1.1,.95,-1],wood),...[.3,.8,1.3].flatMap(y=>[box([1.45,.09,.45],[x*1.1,y,-.8],wood),...[-.4,0,.4].map(z=>part('cylinder',[.08,.08,.34,8],[x*1.1+z,y+.2,-.7],cloth))])]),box([1.1,.65,.08],[0,.35,1.2]),...[-.2,0,.2].map(z=>box([.65,.018,.018],[0,.35+z,1.25],copper))];
 case 'gate':return [...arch(0,3.4),box([3,.15,1.1],[0,.075,0]),...[-.6,0,.6].map(x=>box([.055,.025,4],[x,.17,1],copper))];
 case 'garden':return [...[-1,1].flatMap(x=>[box([1.2,.35,1.6],[x*1.2,.175,0]),...[-.3,0,.3].map(z=>box([.04,.8,.04],[x*1.2+z,.6,z],cloth,[0,0,z*.6])),box([.07,.85,.07],[x*1.2,.425,1.2],copper),box([.3,.23,.3],[x*1.2,.86,1.2],copper)])];
 case 'machine':return [box([2.4,.15,1.1],[0,1,0],wood),...[-1,1].map(x=>box([.18,1,.65],[x,.5,0],copper)),part('torus',[.75,.12,12],[0,2,-.7],copper),...Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return box([.25,.25,.25],[Math.cos(a)*.84,2+Math.sin(a)*.84,-.7],copper,[0,0,a]);}),...[-.9,.9].map(x=>box([.15,.12,3.6],[x,.08,.4],copper))];
 case 'echo':return [...[-1.3,1.3].flatMap(z=>arch(0,2.5).map(p=>({...p,at:[p.at[0],p.at[1],p.at[2]+z] as [number,number,number]}))),box([.8,.4,.08],[0,1.8,-1.05],copper),ring(.6,[0,.025,0]),ring(1,[0,.03,0])];
 case 'forest':return [...[-1,1].flatMap(x=>[box([.3,2.4,.3],[x*1.2,1.2,-.7],wood,[0,0,x*.15]),box([.15,1.5,.15],[x*1.1,1.7,-.7],wood,[0,0,x*.65]),box([1.8,.12,.15],[x*1.2,.5,1.1],wood)]),...[-1,0,1].map(x=>box([.5,.05,.8],[x*.65,.035,.5],stone,[0,x*.4,0]))];
 case 'grave':return [...[-1,0,1].map(x=>box([.55,.8+x*.2,.2],[x*1.3,.4+x*.1,-.9],stone,[0,0,x*.08])),box([1.3,.5,2],[0,.25,.8]),part('cylinder',[.25,.35,1.5,8],[1.9,.75,.7],stone),box([.7,.11,.7],[1.9,1.5,.7])];
 case 'gallery':return [...[-1,1].map(x=>box([.35,.65,4],[x*1.4,.325,0])),...arch(0,2),...[-1,0,1].map(z=>box([2.2,.03,.09],[0,.035,z],copper))];
 }
}
export interface RegionPlacement {nodeId:string;theme:RegionTheme;x:number;y:number;radius:number}
export function regionPlacements(nodes:MapNode[],edges:[string,string][]):RegionPlacement[]{return nodes.flatMap(node=>{
 if(!node.artTheme)return [];const radius=3.4;
 for(let i=0;i<32;i++){const a=-2.35+(i%2?1:-1)*Math.ceil(i/2)*.09,x=node.x+Math.cos(a)*(node.radius+radius+1),y=node.y+Math.sin(a)*(node.radius+radius+1);
  if(nodes.some(n=>n.id!==node.id&&Math.hypot(x-n.x,y-n.y)<n.radius+radius+.5)||edges.some(([a,b])=>segmentDistance({x,y},nodes.find(n=>n.id===a)!,nodes.find(n=>n.id===b)!)<1.75+radius+.5))continue;
  return [{nodeId:node.id,theme:node.artTheme,x,y,radius}];
 }return [];
});}
export function buildRegions(nodes:MapNode[],edges:[string,string][],materials:ArtMaterials){const parts=regionPlacements(nodes,edges).flatMap(place=>[part('box',[4.4,.72,4.4],[0,-.36,0],'foundation'),...regionParts(place.theme)].map(p=>({...p,at:[p.at[0]+place.x,p.at[1],p.at[2]+place.y] as [number,number,number]})));return assembleArt(parts,materials,'lost-city:regions');}
// All distant layers are static and combined by material.
export function citySilhouetteParts(nodes:MapNode[]):Part[]{
 const left=Math.min(...nodes.map(n=>n.x-n.radius))-12,right=Math.max(...nodes.map(n=>n.x+n.radius))+12,back=Math.min(...nodes.map(n=>n.y-n.radius))-18;
 return Array.from({length:22},(_,i)=>{const x=left+(right-left)*i/21,h=2+i%4;return [part('box',[2.1,h,.5],[x,h/2-.6,back-(i%3)*5],'foundation'),part('cone',[1.7,1.2,4],[x,h,back-(i%3)*5],'wood',[0,Math.PI/4,0]),...(i%4===0?[part('box',[.2,1.4,.2],[x-1,h+.7,back],'bronze'),part('box',[2.6,.2,.3],[x,h+1.3,back],'bronze')]:[])];}).flat();
}
