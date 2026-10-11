export const AVATAR_LIMITS={fileBytes:10*1024*1024,pixels:24_000_000,outputBytes:64*1024,size:256} as const;
export interface CropArea {x:number;y:number;width:number;height:number}
export interface AvatarSource {url:string;width:number;height:number}
export interface AvatarDraft {image:string|null;source?:AvatarSource;avatarData?:string}
export type AvatarDraftAction={type:'load';source:AvatarSource}|{type:'cancel'}|{type:'use';data:string}|{type:'select'|'saved';image:string|null};
export function avatarDraftReducer(draft:AvatarDraft,action:AvatarDraftAction):AvatarDraft{
  switch(action.type){
    case 'load':return {...draft,source:action.source};
    case 'cancel':return {...draft,source:undefined};
    case 'use':return {...draft,source:undefined,avatarData:action.data};
    case 'select':case 'saved':return {image:action.image};
  }
}

export async function loadAvatar(file:File):Promise<AvatarSource>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPEG、PNG 或 WebP 图片');
  if(file.size>AVATAR_LIMITS.fileBytes)throw new Error('原图须小于 10 MiB');
  // ImageBitmap applies EXIF orientation before drawing, so crop coordinates use the visible image.
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}).catch(()=>{throw new Error('无法读取图片，请重新选择');});
  try{
    if(bitmap.width*bitmap.height>AVATAR_LIMITS.pixels)throw new Error('原图最多支持 2400 万像素');
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('当前浏览器无法处理图片');
    context.drawImage(bitmap,0,0);
    const blob=await canvasBlob(canvas,'image/png');
    return {url:URL.createObjectURL(blob),width:bitmap.width,height:bitmap.height};
  }finally{bitmap.close();}
}
export function validCrop(area:CropArea,width:number,height:number):CropArea{
  if(!Object.values(area).every(Number.isFinite)||area.x<0||area.y<0||area.width<=0||area.height<=0||Math.abs(area.width-area.height)>1||area.x+area.width>width+1||area.y+area.height>height+1)throw new Error('裁剪范围无效，请重新框选');
  const size=Math.min(area.width,area.height,width,height);
  return {width:size,height:size,x:Math.min(area.x,width-size),y:Math.min(area.y,height-size)};
}
function canvasBlob(canvas:HTMLCanvasElement,type:string,quality?:number):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片压缩失败，请重试')),type,quality));
}
export async function cropAvatar(source:AvatarSource,area:CropArea,background:string):Promise<string>{
  const crop=validCrop(area,source.width,source.height),image=new Image();
  image.src=source.url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=AVATAR_LIMITS.size;
  const context=canvas.getContext('2d');if(!context)throw new Error('当前浏览器无法处理图片');
  context.fillStyle=background;context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
  const blob=await canvasBlob(canvas,'image/jpeg',.85);
  if(blob.size>AVATAR_LIMITS.outputBytes)throw new Error('压缩后的头像过大，请重新框选');
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('图片读取失败，请重试'));reader.readAsDataURL(blob);
  });
}
