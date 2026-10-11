import type {ActionCandidate,GameView} from '@wangxu/shared';
export function pickAction(view:GameView,action:ActionCandidate['action'],previousId?:string){
  const candidates=(view.self.actions??[]).filter(candidate=>candidate.action===action);
  const enabled=candidates.filter(candidate=>candidate.enabled);
  const list=enabled.length?enabled:candidates;
  const nearest=list[0];
  const pinned=action==='interact'?list.find(candidate=>candidate.targetId===view.self.interaction?.targetId):undefined;
  if(pinned)return pinned;
  const previous=list.find(candidate=>candidate.targetId===previousId);
  if(previous&&nearest&&previous.distance-nearest.distance<10)return previous;
  return nearest;
}
