import {useState} from 'react';
import {API} from './api';

export function UserAvatar({image,name,className='',alt='你的头像'}:{image?:string|null;name:string;className?:string;alt?:string}){
  const [failed,setFailed]=useState<string>();
  const source=image?.startsWith('/api/avatars/')?`${API}${image.slice(4)}`:image;
  return source&&failed!==source?<img className={className} src={source} alt={alt} referrerPolicy="no-referrer" onError={()=>setFailed(source)}/>:<span className={`avatar-fallback ${className}`} aria-label={alt}>{name.slice(0,1)||'灯'}</span>;
}
