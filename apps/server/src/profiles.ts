import {createHash, randomUUID} from 'node:crypto';
import sharp from 'sharp';

export const AVATAR_BYTES = 64 * 1024;
export class ProfileError extends Error {
  constructor(public readonly code:string, message:string, public readonly status:400|404=400){super(message);}
}
export interface ProfileUser {id:string;name:string;email:string;image:string|null}
export interface StoredAvatar {userId:string;assetId:string;version:string;data:Buffer}
export interface ProfileTransaction {
  user(id:string):Promise<ProfileUser|undefined>;
  avatar(id:string):Promise<StoredAvatar|undefined>;
  putAvatar(avatar:StoredAvatar):Promise<void>;
  deleteAvatar(id:string):Promise<void>;
  updateUser(id:string,name:string,image:string|null):Promise<ProfileUser>;
}
export interface ProfileRepository {
  transaction<T>(work:(tx:ProfileTransaction)=>Promise<T>):Promise<T>;
  findAvatar(assetId:string,version:string):Promise<StoredAvatar|undefined>;
}
export const presetAvatar = (image:unknown):image is string|null => image===null || typeof image==='string' && /^\/avatars\/lantern-[1-6]\.svg$/.test(image);
export const avatarUrl = (avatar:StoredAvatar)=>`/api/avatars/${avatar.assetId}/${avatar.version}.webp`;

export async function compressAvatar(value:unknown):Promise<Buffer> {
  if(typeof value!=='string'||value.length>Math.ceil(AVATAR_BYTES/3)*4+23||!/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new ProfileError('BAD_AVATAR','头像图片格式无效');
  const input=Buffer.from(value.slice(23),'base64');
  if(!input.length||input.length>AVATAR_BYTES)throw new ProfileError('BAD_AVATAR','裁剪后的头像须小于 64 KiB');
  try {
    const image=sharp(input,{limitInputPixels:24_000_000,failOn:'warning'});
    const metadata=await image.metadata();
    if(metadata.format!=='jpeg'||metadata.width!==256||metadata.height!==256)throw new Error('Invalid cropped dimensions');
    const output=await image.rotate().resize(256,256).webp({quality:82}).toBuffer();
    if(output.length>AVATAR_BYTES)throw new Error('Output too large');
    return output;
  } catch {throw new ProfileError('BAD_AVATAR','头像图片无法处理，请重新裁剪');}
}

export async function saveProfile(repository:ProfileRepository,userId:string,body:unknown):Promise<ProfileUser> {
  if(!body||typeof body!=='object')throw new ProfileError('BAD_PROFILE','请求数据格式无效');
  const {name,image,avatarData}=body as Record<string,unknown>;
  if(typeof name!=='string'||name.trim().length<2||name.trim().length>20||/[\u0000-\u001f\u007f]/.test(name))throw new ProfileError('BAD_NAME','用户名须为 2–20 个字符');
  if(avatarData!==undefined&&image!==undefined)throw new ProfileError('BAD_AVATAR','请只提交一种头像');
  const data=avatarData===undefined?undefined:await compressAvatar(avatarData);
  return repository.transaction(async tx=>{
    const current=await tx.user(userId);
    if(!current)throw new ProfileError('NO_ACCOUNT','账户不存在',404);
    let next:string|null;
    if(data){
      const previous=await tx.avatar(userId);
      const avatar={userId,assetId:previous?.assetId??randomUUID(),version:createHash('sha256').update(data).digest('hex'),data};
      await tx.putAvatar(avatar);next=avatarUrl(avatar);
    } else if(presetAvatar(image)) {
      await tx.deleteAvatar(userId);next=image;
    } else {
      const own=await tx.avatar(userId);
      if(typeof image!=='string'||!own||image!==avatarUrl(own))throw new ProfileError('BAD_AVATAR','请选择自己的头像或上传图片');
      next=image;
    }
    return tx.updateUser(userId,name.trim(),next);
  });
}
