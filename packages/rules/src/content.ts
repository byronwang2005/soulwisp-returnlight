import type { Profession } from '@wangxu/shared';

export const RULES = Object.freeze({
  tickSeconds:0.05, moveSpeed:105, visionRadius:185, interactRange:78, attackRange:72,
  attackCooldown:0.7, normalDamage:22, wolfDamage:28, pushDistance:24, pushStagger:0.35, pushImmunity:1.5,
  dodgeDistance:62, dodgeCooldown:6, maxHp:100, resourceCapacity:4, inventorySlots:4,
  channelResource:1.2, channelBeacon:4, channelCore:2, channelPurify:5, channelCleanse:4,
  channelRescue:4, channelFinish:3, channelChest:4, channelDeposit:1,
  corruptionChannel:4, corruptionCooldown:20, corruptionRetry:10, corruptionTeamCap:2,
  transformationSeconds:8, transformationCooldown:60, fogSeconds:8, fogRadius:105,
  downSeconds:20, containSeconds:20, containImmunity:10, reconnectMilliseconds:60_000,
  wardCooldown:18, wardSeconds:5, wardSingle:55, wardArea:25, skillCooldown:22,
  medicCooldown:18, holdSeconds:8, ghostMessageLimit:80, messageLimit:180, sayCooldown:1,
});
export const BOONS = [
  {id:'fleet',name:'轻絮',description:'移动速度提高10%'},
  {id:'guardian',name:'余灯',description:'获得护盾的数值提高15%'},
  {id:'rescuer',name:'援手',description:'救援读条缩短15%'},
  {id:'engineer',name:'巧工',description:'公共工程读条缩短15%'},
  {id:'watcher',name:'回望',description:'观察范围增加15%'},
  {id:'carrier',name:'稳灯',description:'携灯芯的移动减速减轻'},
  {id:'steadfast',name:'定心',description:'受到推挤的距离减少15%'},
  {id:'vigor',name:'回春',description:'章节开始恢复15点生命'},
] as const;
export const RELICS = [
  {id:'lantern',name:'旧巡灯',description:'观察范围增加10%'},
  {id:'spool',name:'银线轴',description:'公共工程读条缩短10%'},
  {id:'buckler',name:'碎月扣',description:'护盾数值提高10%'},
  {id:'boots',name:'归途靴',description:'携灯芯的移动减速减轻'},
] as const;
export function professionForms(profession:Profession):number[] {
  return ['warden','scout','scavenger','broker'].includes(profession) ? [0,1] : [0];
}
