import {useEffect,useRef,useState} from 'react';
import Cropper from 'react-easy-crop';
import {ActionButton} from './ActionButton';
import {cropAvatar,type AvatarSource,type CropArea} from './avatar-crop';

export function AvatarEditor({source,onUse,onCancel,disabled=false}:{source:AvatarSource;onUse:(data:string)=>void;onCancel:()=>void;disabled?:boolean}){
  const [crop,setCrop]=useState({x:0,y:0}),[zoom,setZoom]=useState(1),[area,setArea]=useState<CropArea>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const panel=useRef<HTMLElement>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function useCrop(){
    if(!area||busy||disabled)return;setBusy(true);setError('');
    try{const background=getComputedStyle(panel.current!).getPropertyValue('--surface').trim()||'#25251e';const data=await cropAvatar(source,area,background);if(alive.current)onUse(data);}
    catch(error){if(alive.current)setError((error as Error).message);}
    finally{if(alive.current)setBusy(false);}
  }
  return <section ref={panel} className="avatar-editor" aria-label="裁剪头像">
    <div className="avatar-crop-stage"><Cropper image={source.url} crop={crop} zoom={zoom} aspect={1} minZoom={1} maxZoom={3} restrictPosition onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_,pixels)=>setArea(pixels)} cropperProps={{'aria-label':'拖动图片选择头像范围'}}/></div>
    <label>缩放 · {zoom.toFixed(1)} 倍<input aria-label="头像缩放" type="range" min="1" max="3" step="0.05" value={zoom} disabled={busy||disabled} onChange={event=>setZoom(Number(event.target.value))}/></label>
    <p className="hint">拖动图片调整位置，也可用方向键移动或双指缩放。</p>
    <div className="avatar-editor-actions"><ActionButton iconKind="save" type="button" className="primary" disabled={busy||disabled||!area} onClick={()=>void useCrop()}>{busy?'正在压缩…':'使用此头像'}</ActionButton><ActionButton iconKind="close" type="button" disabled={busy} onClick={onCancel}>取消</ActionButton></div>
    {error&&<p role="alert" className="settings-message">{error}</p>}
  </section>;
}
