import {useState,type ReactNode} from 'react';
import {API} from './api';

export function UserAvatar({image,name,className='',alt='你的头像',size}:{image?:string|null;name:string;className?:string;alt?:string;size?:24|32|40|56}){
  const source=image?.startsWith('/api/avatars/')?`${API}${image.slice(4)}`:image;
  const classes=`user-avatar ${size?`user-avatar--${size}`:''} ${className}`;
  const fallback=<span className={`avatar-fallback ${classes}`} role={alt?'img':undefined} aria-hidden={alt===''?true:undefined} aria-label={alt||undefined}>{Array.from(name)[0]||'灯'}</span>;
  return source?<AvatarImage key={source} source={source} className={classes} alt={alt} fallback={fallback}/>:fallback;
}

// A new URL gets fresh loading state, including when a previous URL is selected again.
function AvatarImage({source,className,alt,fallback}:{source:string;className:string;alt:string;fallback:ReactNode}){
  const [failed,setFailed]=useState(false);
  return failed?fallback:<img className={className} src={source} alt={alt} aria-hidden={alt===''?true:undefined} referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
