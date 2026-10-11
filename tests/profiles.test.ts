import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {avatarUrl,compressAvatar,saveProfile,type ProfileRepository,type ProfileUser,type StoredAvatar} from '../apps/server/src/profiles';

class Repository implements ProfileRepository {
  users=new Map<string,ProfileUser>([['a',{id:'a',name:'测试甲',email:'a@example.test',image:null}],['b',{id:'b',name:'测试乙',email:'b@example.test',image:null}]]);
  avatars=new Map<string,StoredAvatar>();failUpdate=false;
  async transaction<T>(work:Parameters<ProfileRepository['transaction']>[0]):Promise<T>{
    const users=new Map(this.users),avatars=new Map(this.avatars);
    const result=await work({
      user:async id=>users.get(id),avatar:async id=>avatars.get(id),
      putAvatar:async avatar=>{avatars.set(avatar.userId,avatar);},deleteAvatar:async id=>{avatars.delete(id);},
      updateUser:async(id,name,image)=>{if(this.failUpdate)throw new Error('Transaction failed');const user={...users.get(id)!,name,image};users.set(id,user);return user;},
    });
    this.users=users;this.avatars=avatars;return result as T;
  }
  async findAvatar(assetId:string,version:string){return [...this.avatars.values()].find(avatar=>avatar.assetId===assetId&&avatar.version===version);}
}
const jpeg=async(color:string,size=256)=>'data:image/jpeg;base64,'+(await sharp({create:{width:size,height:size,channels:3,background:color}}).jpeg().withMetadata({orientation:1}).toBuffer()).toString('base64');

describe('validated, atomic account avatars without a database service',()=>{
  it('reencodes cropped JPEG to metadata-free WebP',async()=>{
    const data=await compressAvatar(await jpeg('red')),metadata=await sharp(data).metadata();
    expect(metadata).toMatchObject({format:'webp',width:256,height:256});expect(metadata.exif).toBeUndefined();expect(data.length).toBeLessThanOrEqual(65536);
  });
  it('rejects malformed, oversized, disguised and wrong-sized images',async()=>{
    for(const value of [null,'data:image/jpeg;base64,','data:image/png;base64,AAAA','data:image/jpeg;base64,%%%%','data:image/jpeg;base64,'+Buffer.alloc(65537).toString('base64'),await jpeg('red',512)])await expect(compressAvatar(value)).rejects.toMatchObject({code:'BAD_AVATAR'});
    const png=await sharp({create:{width:256,height:256,channels:3,background:'red'}}).png().toBuffer();
    await expect(compressAvatar('data:image/jpeg;base64,'+png.toString('base64'))).rejects.toMatchObject({code:'BAD_AVATAR'});
  });
  it('saves a public versioned URL, retains own image during name changes, and replaces one asset',async()=>{
    const repo=new Repository(),first=await saveProfile(repo,'a',{name:' 新名字 ',avatarData:await jpeg('red')});
    const stored=repo.avatars.get('a')!;expect(first.image).toBe(avatarUrl(stored));expect(first.name).toBe('新名字');
    expect(await repo.findAvatar(stored.assetId,stored.version)).toBe(stored);
    await saveProfile(repo,'a',{name:'再改名字',image:first.image});expect(repo.avatars.get('a')).toBe(stored);
    const second=await saveProfile(repo,'a',{name:'再改名字',avatarData:await jpeg('blue')});
    expect(second.image).not.toBe(first.image);expect(repo.avatars.size).toBe(1);expect(repo.avatars.get('a')?.assetId).toBe(stored.assetId);
    expect(await repo.findAvatar(stored.assetId,stored.version)).toBeUndefined();
  });
  it('rejects foreign and arbitrary URLs, ambiguous payloads, and invalid names',async()=>{
    const repo=new Repository(),first=await saveProfile(repo,'a',{name:'测试甲',avatarData:await jpeg('red')});
    for(const image of [first.image,'https://example.test/avatar.jpg','/api/avatars/fake/hash.webp',undefined])await expect(saveProfile(repo,'b',{name:'测试乙',image})).rejects.toMatchObject({code:'BAD_AVATAR'});
    await expect(saveProfile(repo,'a',{name:'测试甲',image:null,avatarData:await jpeg('red')})).rejects.toMatchObject({code:'BAD_AVATAR'});
    for(const name of ['a','a'.repeat(21),'名称\u0000'])await expect(saveProfile(repo,'a',{name,image:null})).rejects.toMatchObject({code:'BAD_NAME'});
  });
  it('restores presets or initials and deletes uploaded bytes',async()=>{
    const repo=new Repository();
    for(const image of ['/avatars/lantern-3.svg',null]){
      await saveProfile(repo,'a',{name:'测试甲',avatarData:await jpeg('red')});
      expect((await saveProfile(repo,'a',{name:'测试甲',image})).image).toBe(image);expect(repo.avatars.has('a')).toBe(false);
    }
  });
  it('rolls back both new bytes and deletion when profile update fails, and allows retry',async()=>{
    const repo=new Repository(),original=await saveProfile(repo,'a',{name:'测试甲',avatarData:await jpeg('red')}),stored=repo.avatars.get('a');
    repo.failUpdate=true;
    for(const payload of [{name:'新名字',avatarData:await jpeg('blue')},{name:'新名字',image:null}]){
      await expect(saveProfile(repo,'a',payload)).rejects.toThrow('Transaction failed');
      expect(repo.users.get('a')).toEqual(original);expect(repo.avatars.get('a')).toBe(stored);
    }
    repo.failUpdate=false;expect((await saveProfile(repo,'a',{name:'新名字',image:null})).image).toBeNull();
  });
});
