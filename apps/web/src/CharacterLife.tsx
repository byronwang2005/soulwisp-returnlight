import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
/** Five heart petals are twenty life each; a wounded heart drains rather than disappearing abruptly. */
export function CharacterLife({hp,maxHp,down,sealed,reduced}:{hp:number;maxHp:number;down:boolean;sealed:boolean;reduced:boolean}){
 const sprite=useRef<THREE.Sprite>(null),fraction=Math.max(0,Math.min(1,hp/maxHp));
 const texture=useMemo(()=>{
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=112;const ctx=canvas.getContext('2d')!;
  const color=sealed?'#d4e2dd':fraction>.6?'#a8f0c5':fraction>.3?'#ffe090':'#ff8f7d';
  ctx.fillStyle='#17251fe8';ctx.beginPath();ctx.roundRect(7,14,242,86,36);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
  for(let i=0;i<5;i++){const x=28+i*43,y=33;const heart=new Path2D();heart.moveTo(x+18,y+27);heart.bezierCurveTo(x-12,y+8,x+1,y-9,x+18,y+3);heart.bezierCurveTo(x+35,y-9,x+48,y+8,x+18,y+27);ctx.fillStyle='#52665b';ctx.fill(heart);ctx.save();ctx.clip(heart);ctx.fillStyle=color;ctx.fillRect(x-4,y-8,44*Math.max(0,Math.min(1,fraction*5-i)),42);ctx.restore();}
  ctx.fillStyle=color;ctx.font='bold 27px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(sealed?'回响':down?'救救我！':`${Math.ceil(hp)}`,128,79);
  const result=new THREE.CanvasTexture(canvas);result.colorSpace=THREE.SRGBColorSpace;return result;
 },[hp,maxHp,down,sealed]);
 useEffect(()=>()=>texture.dispose(),[texture]);
 useFrame(({clock})=>{if(sprite.current){const pulse=!reduced&&fraction<=.3&&!sealed?1+Math.sin(clock.elapsedTime*7)*.065:1;sprite.current.scale.set(2.05*pulse,.9*pulse,1);}});
 return <sprite ref={sprite} name="character-life" position={[0,3.05,0]} scale={[2.05,.9,1]}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false}/></sprite>;
}
