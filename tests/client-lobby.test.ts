import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({slots:[] as any[],index:0,request:vi.fn(),consume:vi.fn(),reconnect:vi.fn()}));
// Isolate async connection ownership without launching a DOM or a browser.
vi.mock('react',()=>({
  useState:(initial:unknown)=>{const i=fake.index++;if(!(i in fake.slots))fake.slots[i]=typeof initial==='function'?(initial as Function)():initial;return [fake.slots[i],(value:unknown)=>{fake.slots[i]=typeof value==='function'?(value as Function)(fake.slots[i]):value;}];},
  useRef:(initial:unknown)=>{const i=fake.index++;if(!(i in fake.slots))fake.slots[i]={current:initial};return fake.slots[i];},
  useCallback:(callback:Function)=>callback,useEffect:()=>{},
}));
vi.mock('@colyseus/sdk',()=>({Client:class{consumeSeatReservation=fake.consume;reconnect=fake.reconnect;}}));
vi.mock('../apps/web/src/api.js',()=>({request:fake.request}));
import { useExpedition } from '../apps/web/src/game';
class Connection {
  reconnection={};reconnectionToken='token';handlers=new Map<string,Function>();drop?:Function;reconnected?:Function;left?:Function;
  leave=vi.fn(async()=>{});send=vi.fn();
  onMessage(type:string,callback:Function){this.handlers.set(type,callback);}
  onDrop(callback:Function){this.drop=callback;}onReconnect(callback:Function){this.reconnected=callback;}onLeave(callback:Function){this.left=callback;}onError(){}
  async emit(type:string,value:unknown){await this.handlers.get(type)?.(value);}
}
let storage:Map<string,string>;const errors=vi.fn();
const render=()=>{fake.index=0;return useExpedition(errors);};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
beforeEach(()=>{
  fake.slots=[];fake.index=0;vi.clearAllMocks();storage=new Map();
  vi.stubGlobal('sessionStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  vi.stubGlobal('location',{protocol:'http:',hostname:'test.invalid'});vi.stubGlobal('window',new EventTarget());
  fake.request.mockResolvedValue({room:{roomId:'waiting'},sessionId:'reserved'});
});
describe('client lobby transfer ownership',()=>{
  it('cancels an in-flight waiting join when the user leaves',async()=>{
    const request=deferred<unknown>();fake.request.mockReturnValue(request.promise);const hook=render();const joining=hook.joinWaiting();await hook.leaveWaiting();request.resolve({});await joining;
    expect(fake.consume).not.toHaveBeenCalled();expect(storage.has('wangxu-waiting-listen')).toBe(false);expect(render().lobby).toBeNull();
  });
  it('does not resurrect a game whose seat response arrives after transfer rollback',async()=>{
    const waiting=new Connection();fake.consume.mockResolvedValueOnce(waiting);await render().joinWaiting();const seat=deferred<Connection>();fake.consume.mockReturnValueOnce(seat.promise);
    const transfer=waiting.emit('matchSeat',{});expect(render().connecting).toBe(true);await waiting.emit('returned',{message:'取消入场'});const game=new Connection();seat.resolve(game);await transfer;
    expect(game.leave).toHaveBeenCalledOnce();expect(render().view).toBeNull();expect(render().connected).toBe(false);expect(storage.has('wangxu-reconnect')).toBe(false);
  });
  it('does not let an old game leave event clear a newer game session',async()=>{
    const waiting=new Connection(),oldGame=new Connection(),newGame=new Connection();fake.consume.mockResolvedValueOnce(waiting);await render().joinWaiting();
    fake.consume.mockResolvedValueOnce(oldGame);await waiting.emit('matchSeat',{});await oldGame.emit('returnToLobby',{});
    fake.consume.mockResolvedValueOnce(newGame);await waiting.emit('matchSeat',{});oldGame.left?.();await newGame.emit('view',{roomId:'new'});
    expect(render().connected).toBe(true);expect(render().view?.roomId).toBe('new');expect(newGame.leave).not.toHaveBeenCalled();
  });
});
