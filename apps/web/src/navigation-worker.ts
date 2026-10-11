import {navigationWorkerHandler,type NavigationRequest} from './navigation-worker-core';
const handle=navigationWorkerHandler(reply=>self.postMessage(reply));
self.onmessage=(event:MessageEvent<NavigationRequest>)=>handle(event.data);
