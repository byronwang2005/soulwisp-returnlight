import { Client, type Room, type SeatReservation } from '@colyseus/sdk';

/** Helpers for explicitly requested live tests; never imported by unit tests. */
export async function startLiveMatch(accounts: {cookie:string}[], client:Client, base:string, origin:string, onGame:(room:Room,index:number)=>void) {
  const waiting:Room[]=[],games:Promise<Room>[]=[];
  for(let index=0;index<accounts.length;index++){
    const response=await fetch(`${base}/api/lobby/join`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:accounts[index]!.cookie,Origin:origin},body:'{}'});
    if(!response.ok)throw new Error(`Waiting admission failed: ${await response.text()}`);
    const room=await client.consumeSeatReservation(await response.json() as SeatReservation);waiting.push(room);
    room.onMessage('lobbyView',()=>{});room.onMessage('returned',()=>{});room.onMessage('settlementCommitted',()=>{});room.onMessage('error',()=>{});
    games.push(new Promise<Room>((resolve,reject)=>room.onMessage('matchSeat',async(reservation:SeatReservation)=>{
      try{const game=await client.consumeSeatReservation(reservation);game.onMessage('returnToLobby',()=>{});onGame(game,index);resolve(game);}catch(error){reject(error);}
    })));
  }
  waiting.forEach(room=>room.send('lobbyCommand',{type:'ready',ready:true}));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return {waiting,games:await Promise.race([Promise.all(games),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Waiting transfer timed out')),45000);})])};}
  finally{if(timer)clearTimeout(timer);}
}
export async function waitForIdle(base:string,timeout=45000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const state=await fetch(`${base}/api/lobby`).then(response=>response.json()) as {game:unknown};if(!state.game)return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw new Error('Single game slot did not become idle');
}
