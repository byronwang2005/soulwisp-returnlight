import {and,eq} from 'drizzle-orm';
import {db,schema} from './db/index.js';
import type {ProfileRepository} from './profiles.js';

export const profileRepository:ProfileRepository={
  transaction:work=>db.transaction(async tx=>work({
    user:async id=>(await tx.select().from(schema.user).where(eq(schema.user.id,id)).for('update'))[0],
    avatar:async id=>(await tx.select().from(schema.profileAvatars).where(eq(schema.profileAvatars.userId,id)))[0],
    putAvatar:async avatar=>{await tx.insert(schema.profileAvatars).values(avatar).onConflictDoUpdate({target:schema.profileAvatars.userId,set:{assetId:avatar.assetId,version:avatar.version,data:avatar.data}});},
    deleteAvatar:async id=>{await tx.delete(schema.profileAvatars).where(eq(schema.profileAvatars.userId,id));},
    updateUser:async(id,name,image)=>(await tx.update(schema.user).set({name,image,updatedAt:new Date()}).where(eq(schema.user.id,id)).returning())[0],
  })),
  findAvatar:async(assetId,version)=>(await db.select().from(schema.profileAvatars).where(and(eq(schema.profileAvatars.assetId,assetId),eq(schema.profileAvatars.version,version))))[0],
};
