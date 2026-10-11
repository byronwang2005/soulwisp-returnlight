import type {Profession} from '@wangxu/shared';
export const ART_PALETTE={bronze:'#b58a58',verdigris:'#9ab7a5',paper:'#efe4ce',charcoal:'#171512',stone:'#777566',light:'#dfbc87',danger:'#e6978e'} as const;
export type ArtSurface='foundation'|'bronze'|'wood'|'cloth'|'leather';
export type Attachment='shoulder-lantern'|'scout-pouch'|'tools'|'cargo'|'medicine'|'goggles'|'gear'|'lens'|'documents'|'bell'|'clock'|'quiver'|'leaf-cape'|'short-cap'|'scarf';
export interface ProfessionArt {hide:string[];cloth:string;equipment:string;attachments:Attachment[];}
export const PROFESSION_ART:Record<Profession,ProfessionArt>={
  warden:{hide:[],cloth:'#64695c',equipment:ART_PALETTE.bronze,attachments:['shoulder-lantern']},
  scout:{hide:[],cloth:'#637f72',equipment:'#967a59',attachments:['scout-pouch']},
  scavenger:{hide:[],cloth:'#a08665',equipment:'#997047',attachments:['tools']},
  broker:{hide:['Mage_Hat'],cloth:'#8a795e',equipment:ART_PALETTE.bronze,attachments:['cargo','documents']},
  medic:{hide:['Mage_Hat'],cloth:ART_PALETTE.paper,equipment:'#8aab94',attachments:['medicine','scarf']},
  engineer:{hide:['Badge_Shield'],cloth:'#807965',equipment:'#b58a58',attachments:['goggles','gear','tools']},
  forensic:{hide:['Mage_Hat'],cloth:'#788c89',equipment:'#b6a080',attachments:['short-cap','lens','documents']},
  bellkeeper:{hide:['Barbarian_Hat'],cloth:'#72765f',equipment:'#bd9463',attachments:['bell','clock']},
  ranger:{hide:[],cloth:'#718565',equipment:'#8b765a',attachments:['quiver','leaf-cape']},
};
export const RETAINED_CLIPS=['Idle','Running_A','1H_Melee_Attack_Slice_Horizontal','Death_A','Spellcast_Raise','Dodge_Forward','Interact','Cheer','Hit_A','Blocking'] as const;
export function materialPaths(id:string,normal:boolean,colorSize=1024,dataSize=normal?1024:512){return {color:`/assets/materials/${id}_color_${colorSize}.webp`,arm:`/assets/materials/${id}_arm_${dataSize}.webp`,...(normal?{normal:`/assets/materials/${id}_normal_${dataSize}.webp`}:{})};}
export const LANDMARK_ART={beacon:'stone-lantern',altar:'broken-altar',cleanse:'verdigris-basin',purify:'core-cradle',exit:'returnlight-gate'} as const;

export function groundTexturePaths(name:string,profile:{normal:boolean;resolution:string}){return materialPaths(name,profile.normal,profile.resolution==='2k'?2048:1024,profile.resolution==='2k'?1024:512);}
