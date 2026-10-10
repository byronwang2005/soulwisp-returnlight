export type Faction = 'human' | 'wolf';
export type Profession = 'warden'|'scout'|'scavenger'|'broker'|'medic'|'engineer'|'forensic'|'bellkeeper'|'ranger';
export type Phase = 'LOBBY'|'PREP'|'EXPLORE'|'DISCUSS'|'VOTE'|'DRAFT'|'EXTRACT'|'RESULT';
export interface Vec2 { x: number; y: number }
export interface GameConfig { players:number; humans:number; wolves:number; chapters:number; exploreSeconds:number; discussionSeconds:number; voteSeconds:number; draftSeconds:number; prepSeconds:number; extractionSeconds:number; beacons:number; moonLimit:number; shadowBudget:number; permanentRemovalCap:number; wolfFinisherGameCap:number; darkAltars:number; mapNodes:number; guaranteedSupply:number; professions:Profession[]; statementSeconds:number; ruleVersion:string; }
export interface MapNode extends Vec2 { id:string; name:string; radius:number }
export interface WorldObject extends Vec2 { id:string; kind:'resource'|'beacon'|'altar'|'core'|'cleanse'|'elite'|'chest'|'deposit'|'exit'|'bridge'; name:string; active:boolean; progress:number; amount?:number; hp?:number; owner?:string; }
export interface PlayerView { id:string; name:string; slot:number; profession:Profession; form:number; cosmetic:string; ready:boolean; connected:boolean; sealed:boolean; down:boolean; hp:number; maxHp:number; x:number|null; y:number|null; shield:number; transformed:boolean; carryingCore:boolean; }
export interface Evidence { id:string; source:'system'|'observation'|'claim'; text:string; chapter:number; at:number; author?:string; }
export interface RelicItem { id:string; contentId:string; name:string; value:number; stored?:boolean; }
export interface FeedbackEvent { id:number;kind:'hit'|'hurt'|'block'|'push'|'collision'|'pickup'|'complete'|'down'|'rescue'|'cast'|'dodge';x:number;y:number;targetId?:string;power:number;at:number; }
export interface SelfView { id:string; faction:Faction|null; wolfAllies:string[]; resources:number; supplies:number; loot:RelicItem[]; relics:string[]; boons:string[]; evidence:Evidence[]; ghostVote:boolean; skillCooldown:number; wolfBudget:number; draftOptions:string[]; voted:boolean; offers?:{from:string;itemId:string;name:string;expiresIn:number;escrow:boolean}[]; interaction?:{targetId:string;progress:number}; feedback?:FeedbackEvent[]; inputSeq?:number; }
export interface GameResult { winner:Faction|'invalid'; reason:string; factions:Record<string,Faction>; rewards:Record<string,{fragments:number;secrets:number}>; }
export interface GameView { roomId:string; invite:string; config:GameConfig; phase:Phase; chapter:number; remaining:number; elapsed:number; moon:number; sharedResources:number; beaconsLit:number; eliteDefeated:boolean; corePurified:boolean; holdProgress:number; eligibleVoters:number; removalCount:number; players:PlayerView[]; self:SelfView; nodes:MapNode[]; objects:WorldObject[]; evidence:Evidence[]; messages:{id:string;author:string;text:string;at:number}[]; result:GameResult|null; voice:{enabled:boolean;epoch:string|null;speakerId:string|null;open:boolean}; }
export type GameCommand =
 | {type:'choose';profession:Profession;form:number;cosmetic?:string}
 | {type:'ready';ready:boolean} | {type:'move';x:number;y:number;seq:number}
 | {type:'interact';targetId:string} | {type:'cancel'} | {type:'attack';targetId?:string}
 | {type:'skill';targetId?:string;x?:number;y?:number} | {type:'dodge';x:number;y:number}
 | {type:'corrupt';targetId:string} | {type:'fog';x:number;y:number} | {type:'transform'} | {type:'finish';targetId:string}
 | {type:'vote';targetId:string|null} | {type:'draft';boonId:string}
 | {type:'publish';evidenceId:string} | {type:'say';text:string}
 | {type:'drop';itemId:string} | {type:'offer';to:string;itemId:string} | {type:'accept';from:string;itemId:string}
 | {type:'restart'};
export interface Settlement { matchId:string;ruleVersion:string;mapSeed?:number;winner:Faction|'invalid';reason:string;players:{id:string;faction:Faction;sealed:boolean;storedValue:number;carriedValue:number;profession:Profession;lootIds?:string[]}[];events:Evidence[]; }
export type CampPreset = CampData['equipment'] & {name:string};
export interface CampData { fragments:number;secrets:number;cosmetics:string[];research:string[];equipment:{cosmeticId:string;profession:Profession;form:number};presets:CampPreset[];tutorialStep:number;tutorialCompleted:boolean;matches:number;wins:number;displayName:string; }
export interface Recipe { id:string;name:string;description:string;fragments:number;secrets:number;kind:'cosmetic'|'research'|'decoration';profession?:Profession;grants:string; }
export const PROFESSION_NAMES:Record<Profession,string>={warden:'灯卫',scout:'斥候',scavenger:'拾荒者',broker:'行商',medic:'药师',engineer:'机关师',forensic:'验痕师',bellkeeper:'守钟人',ranger:'巡林客'};
export const RECIPES:Recipe[]=[
 ...(['warden','scout','scavenger','broker'] as Profession[]).map(profession=>({id:`outfit-${profession}`,name:`${PROFESSION_NAMES[profession]}·归灯礼装`,description:'在远征与营地中实际穿戴的归灯行会礼装。',fragments:40,secrets:0,kind:'cosmetic' as const,profession,grants:`outfit-${profession}`})),
 ...(['warden','scout','scavenger','broker'] as Profession[]).map(profession=>({id:`research-${profession}`,name:`${PROFESSION_NAMES[profession]}·异式蓝图`,description:'收藏第二技能形态，并获得银絮配色。标准局所有玩家均可免费试用该形态。',fragments:60,secrets:6,kind:'research' as const,profession,grants:`research-${profession}`})),
 {id:'camp-lantern',name:'余灯集市·记忆灯',description:'营地中的永久灯饰。',fragments:30,secrets:0,kind:'decoration',grants:'camp-lantern'},
 {id:'first-thread',name:'第一缕·絮灯饰',description:'第一局后即可制作的银白灯饰。',fragments:10,secrets:0,kind:'cosmetic',grants:'first-thread'}
];
export interface VoiceLobbyInfo { available: boolean; online: number; capacity: 10; url: string | null }
export interface VoiceLobbyTicket { token: string; url: string; epoch: string }
