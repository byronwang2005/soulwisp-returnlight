import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({create:vi.fn(),reserve:vi.fn(),settle:vi.fn(),camp:vi.fn()}));
vi.mock('@colyseus/core',()=>({
  matchMaker:{createRoom:fake.create,reserveSeatFor:fake.reserve},
  Room:class {
    roomId='test-game';maxClients=0;autoDispose=true;locked=false;clients:any[]=[];handlers=new Map<string,Function>();
    setPrivate=vi.fn(async()=>{});setSeatReservationTime=vi.fn();setFixedTimestep=vi.fn();setSimulationInterval=vi.fn();lock=vi.fn(async()=>{});unlock=vi.fn(async()=>{});
    onMessage(type:string,callback:Function){this.handlers.set(type,callback);}
    broadcast(type:string,message:unknown){for(const client of this.clients)client.send(type,message);}
    async disconnect(){await (this as any).onDispose?.();}
  },
}));
vi.mock('../apps/server/src/accounts.js',()=>({
  verifyGameTicket:(ticket:string)=>({userId:ticket,name:ticket}),issueGameTicket:(id:string)=>id,getCamp:fake.camp,settleMatch:fake.settle,
}));
vi.mock('../apps/server/src/deployment.js',()=>({assertAdmissionOpen:()=>{},isDraining:()=>false}));
import { WaitingRoom } from '../apps/server/src/waiting-room.js';
import { ExpeditionRoom, rooms, pendingSettlements, setVoiceLobby } from '../apps/server/src/rooms.js';
import { INTERNAL_CREATE_KEY } from '../apps/server/src/match-control.js';
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
function peer(id:string){return {sessionId:id,auth:{id,name:id,preference:'warden'},send:vi.fn(),leave:vi.fn(async()=>{})};}
let waiting:WaitingRoom;
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(0);vi.clearAllMocks();rooms.clear();
  fake.camp.mockResolvedValue({cosmetics:['base','outfit-warden'],equipment:{profession:'warden',form:1,cosmeticId:'outfit-warden'}});
  fake.settle.mockResolvedValue(undefined);
  fake.create.mockImplementation(async(_name,options)=>{const room=new ExpeditionRoom();room.roomId='test-game';await room.onCreate(options);return {roomId:room.roomId};});
  fake.reserve.mockImplementation(async(cache,options)=>({room:cache,options}));
  waiting=new WaitingRoom();waiting.roomId='test-waiting';waiting.onCreate({internalKey:INTERNAL_CREATE_KEY});
});
afterEach(async()=>{waiting.onDispose();for(const room of rooms.values())await room.onDispose();await Promise.all([...pendingSettlements]);vi.useRealTimers();});
async function launch(){
  const peers=['a','b','c','d'].map(peer);peers.forEach(p=>waiting.onJoin(p as never));peers.forEach(p=>waiting.coordinator.command(p.auth.id,{type:'ready',ready:true}));
  vi.setSystemTime(10000);waiting.coordinator.tick();await flush();return {peers,room:rooms.get('test-game')!};
}
async function admit(room:ExpeditionRoom){
  const clients=[];
  for(const [index,call] of fake.reserve.mock.calls.entries()){
    const options=call[1],auth=await room.onAuth({} as never,options),client={sessionId:`game-${index}`,auth,send:vi.fn(),leave:vi.fn(async()=>{})};
    (room.clients as any[]).push(client);room.onJoin(client as never);clients.push(client);
  }
  return clients;
}
describe('authoritative waiting room handoff',()=>{
  it('rejects public room creation, foreign seats and duplicate accounts',async()=>{
    await expect(new ExpeditionRoom().onCreate({})).rejects.toThrow('等待区');expect(()=>new WaitingRoom().onCreate({internalKey:INTERNAL_CREATE_KEY})).toThrow();
    const {room}=await launch();await expect(room.onAuth({} as never,{ticket:'foreign',seatKey:'invalid'})).rejects.toThrow('席位');
    expect(()=>waiting.onJoin(peer('a') as never)).toThrow('原页面');expect(waiting.coordinator.snapshot('a').selfArea).toBe('playing');
    await expect(room.onAuth({} as never,{ticket:'a',seatKey:'invalid'})).rejects.toThrow('席位');
  });
  it('waits for every reserved account before beginning forty-five second preparation',async()=>{
    const {room,peers}=await launch();expect(room.engine.phase).toBe('LOBBY');expect(peers.every(p=>p.send.mock.calls.some(([type])=>type==='matchSeat'))).toBe(true);
    const firstOptions=fake.reserve.mock.calls[0][1],first={sessionId:'first',auth:await room.onAuth({} as never,firstOptions),send:vi.fn(),leave:vi.fn()};
    (room.clients as any[]).push(first);room.onJoin(first as never);expect(room.engine.phase).toBe('LOBBY');
    for(let i=1;i<4;i++){const options=fake.reserve.mock.calls[i][1],client={sessionId:`${i}`,auth:await room.onAuth({} as never,options),send:vi.fn(),leave:vi.fn()};(room.clients as any[]).push(client);room.onJoin(client as never);}
    expect(room.engine.phase).toBe('PREP');expect(room.engine.remaining).toBe(45);expect(room.engine.viewFor('a').self.faction).toBeNull();
    const assigned=[...room.engine.players.values()];expect(assigned.filter(p=>p.profession==='warden')[0]).toMatchObject({form:1,cosmetic:'outfit-warden'});expect(assigned.filter(p=>p.profession!=='warden').every(p=>p.form===0&&p.cosmetic==='base')).toBe(true);
    await expect(room.onAuth({} as never,firstOptions)).rejects.toThrow('恢复原连接');
  });
  it('ignores player commands to replace assigned professions, restart or begin the match',async()=>{
    const {room}=await launch();const clients=await admit(room);const before=room.engine.players.get('a')!.profession;
    const handler=(room as unknown as {handlers:Map<string,Function>}).handlers.get('command')!;
    handler(clients[0],{type:'choose',profession:'scout',form:0});handler(clients[0],{type:'restart'});handler(clients[0],{type:'ready',ready:true});
    expect(room.engine.players.get('a')!.profession).toBe(before);expect(clients[0].send).toHaveBeenCalledWith('error',expect.objectContaining({message:'职业与开局由大厅分配'}));
  });
  it('returns all users even while settlement is pending and notifies them after commit',async()=>{
    let commit!:()=>void;fake.settle.mockImplementation(()=>new Promise<void>(resolve=>{commit=resolve;}));
    const {room,peers}=await launch();const clients=await admit(room);room.engine.invalidate('unit result');(room as unknown as {step():void}).step();await flush();
    expect(waiting.coordinator.snapshot('a').game?.stage).toBe('result');expect(room.engine.viewFor('a').result?.winner).toBe('invalid');
    vi.setSystemTime(25000);waiting.coordinator.tick();await flush();expect(waiting.coordinator.busy).toBe(false);expect(rooms.size).toBe(0);expect(pendingSettlements.size).toBe(1);
    expect(waiting.coordinator.snapshot('a').members.every(m=>!m.ready)).toBe(true);expect(clients[0].send).toHaveBeenCalledWith('returnToLobby',{});
    commit();await flush();expect(peers[0].send).toHaveBeenCalledWith('settlementCommitted',{});expect(pendingSettlements.size).toBe(0);
  });
  it('continues a failed settlement retry after the game room is disposed',async()=>{
    fake.settle.mockRejectedValueOnce(new Error('database retry')).mockResolvedValue(undefined);const logging=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {const {room,peers}=await launch();await admit(room);room.engine.invalidate('retry result');(room as unknown as {step():void}).step();await flush();expect(fake.settle).toHaveBeenCalledTimes(1);
      vi.setSystemTime(25000);waiting.coordinator.tick();await flush();expect(rooms.size).toBe(0);expect(pendingSettlements.size).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);await flush();expect(fake.settle).toHaveBeenCalledTimes(2);expect(pendingSettlements.size).toBe(0);expect(peers[0].send).toHaveBeenCalledWith('settlementCommitted',{});
    }finally{logging.mockRestore();}
  });
  it('cancels transfer when revoking waiting media fails and never sends game seats',async()=>{
    const revoke=vi.fn(async()=>{throw new Error('voice outage');});setVoiceLobby({removeParticipant:revoke} as never);
    const logging=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {const {peers}=await launch();expect(fake.reserve).not.toHaveBeenCalled();expect(peers.every(p=>!p.send.mock.calls.some(([type])=>type==='matchSeat'))).toBe(true);expect(waiting.coordinator.busy).toBe(false);}
    finally{setVoiceLobby(undefined as never);logging.mockRestore();}
  });
});
