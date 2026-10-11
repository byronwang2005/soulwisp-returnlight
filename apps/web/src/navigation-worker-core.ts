import {navigationField,type NavigationTarget} from './navigation';
import type {GameView,Vec2} from '@wangxu/shared';
export interface NavigationRequest {generation:number;sequence:number;geometry?:Pick<GameView,'nodes'|'edges'|'objects'>;target?:NavigationTarget;start:Vec2}
export interface NavigationResponse {generation:number;sequence:number;route:Vec2[]}
export function navigationReplyCurrent(reply:NavigationResponse,generation:number,sequence:number){return reply.generation===generation&&reply.sequence===sequence;}
export function navigationWorkerHandler(send:(reply:NavigationResponse)=>void,build:typeof navigationField=navigationField){
 let generation=-1,field:ReturnType<typeof navigationField>|undefined;
 return (request:NavigationRequest)=>{
  if(request.generation<generation)return;
  if(request.geometry&&request.target){generation=request.generation;field=build(request.geometry,request.target);}
  if(generation===request.generation)send({generation,sequence:request.sequence,route:field?.route(request.start)??[]});
 };
}
