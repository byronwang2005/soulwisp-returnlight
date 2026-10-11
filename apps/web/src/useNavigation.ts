import {useEffect,useRef,useState} from 'react';
import {isSolid,type GameView,type Vec2} from '@wangxu/shared';
import type {NavigationTarget} from './navigation';
import {navigationReplyCurrent,type NavigationRequest,type NavigationResponse} from './navigation-worker-core';
export function useNavigation(view:GameView,target:NavigationTarget|undefined,start:Vec2|null){
 const worker=useRef<Worker|null>(null),generation=useRef(0),sequence=useRef(0),[answer,setAnswer]=useState<{key:string;route:Vec2[]}>({key:'',route:[]}),keyRef=useRef('');
 const key=JSON.stringify([view.roomId,view.nodes,view.edges,view.objects.filter(o=>o.active&&isSolid(o.kind)).map(o=>[o.id,o.kind,o.x,o.y]),target]);keyRef.current=key;
 const latest=useRef({view,target,start});latest.current={view,target,start};
 useEffect(()=>{const instance=new Worker(new URL('./navigation-worker.ts',import.meta.url),{type:'module'});worker.current=instance;
 instance.onmessage=(event:MessageEvent<NavigationResponse>)=>{if(navigationReplyCurrent(event.data,generation.current,sequence.current))setAnswer({key:keyRef.current,route:event.data.route});};
 return()=>{instance.terminate();worker.current=null;};},[]);
 useEffect(()=>{generation.current++;sequence.current++;setAnswer({key:'',route:[]});const current=latest.current;
 if(current.target&&current.start)worker.current?.postMessage({generation:generation.current,sequence:sequence.current,geometry:{nodes:current.view.nodes,edges:current.view.edges,objects:current.view.objects.filter(o=>o.active&&isSolid(o.kind))},target:current.target,start:current.start} satisfies NavigationRequest);
 },[key]);
 useEffect(()=>{if(!target||!start)return;sequence.current++;worker.current?.postMessage({generation:generation.current,sequence:sequence.current,start} satisfies NavigationRequest);},[key,start?.x===undefined?null:Math.round(start.x/5),start?.y===undefined?null:Math.round(start.y/5)]);
 return answer.key===key?answer.route:[];
}
