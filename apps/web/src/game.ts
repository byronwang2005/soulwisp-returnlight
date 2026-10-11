import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, type Room, type SeatReservation } from '@colyseus/sdk';
import type { GameCommand, GameView, LobbyCommand, LobbyView } from '@wangxu/shared';
import { request } from './api';
const client = () => new Client(import.meta.env.VITE_GAME_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:2567`);
export function useExpedition(onError: (message: string) => void) {
  const [view, setView] = useState<GameView | null>(null);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [summary,setSummary]=useState<{waiting:number;game:LobbyView['game'];available?:boolean}>({waiting:0,game:null});
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [settlementVersion,setSettlementVersion] = useState(0);
  const room = useRef<Room | null>(null), waiting = useRef<Room | null>(null);
  const generation = useRef(0), joining = useRef(false);
  const errorRef = useRef(onError); errorRef.current = onError;
  const detachGame = useCallback(() => {
    generation.current++; const current = room.current; room.current = null;
    sessionStorage.removeItem('wangxu-reconnect'); setView(null); setConnected(false); setConnecting(false);
    void current?.leave();
  }, []);
  const bind = useCallback((joined: Room) => {
    room.current = joined; setConnected(true);
    joined.reconnection.enabled=true;joined.reconnection.minDelay=250;joined.reconnection.maxDelay=4000;joined.reconnection.maxRetries=20;
    joined.onDrop(()=>{if(room.current!==joined)return;window.dispatchEvent(new Event('soulwisp-game-audio-reset'));setConnected(false);setConnecting(true);errorRef.current('远征连接暂时中断，正在自动恢复席位。');});
    joined.onReconnect(()=>{if(room.current!==joined)return;setConnected(true);setConnecting(false);sessionStorage.setItem('wangxu-reconnect',joined.reconnectionToken);});
    joined.onMessage('view', (state: GameView) => {if(room.current===joined)setView(state);});
    joined.onMessage('error', (error: {message:string}) => errorRef.current(error.message));
    joined.onError((_code: number, message?: string) => errorRef.current(message || '远征连接出现错误。'));
    joined.onMessage('settlementCommitted',()=>setSettlementVersion(version=>version+1));
    joined.onMessage('returnToLobby', detachGame);
    joined.onLeave(() => { if(room.current!==joined)return;detachGame(); });
  }, [detachGame]);
  const bindWaiting = useCallback((joined: Room) => {
    waiting.current=joined;
    joined.reconnection.enabled=true;joined.reconnection.minDelay=250;joined.reconnection.maxDelay=4000;joined.reconnection.maxRetries=20;
    const remember=()=>sessionStorage.setItem('wangxu-lobby-reconnect',joined.reconnectionToken);remember();
    joined.onMessage('lobbyView',(state:LobbyView)=>{if(waiting.current===joined)setLobby(state);});
    joined.onMessage('error',(error:{message:string})=>errorRef.current(error.message));
    joined.onMessage('returned',(event:{message:string})=>{detachGame();errorRef.current(event.message);});
    joined.onMessage('settlementCommitted',()=>setSettlementVersion(v=>v+1));
    joined.onMessage('matchSeat',async(reservation:SeatReservation)=>{
      if(waiting.current!==joined||room.current)return;
      const currentGeneration=++generation.current;
      window.dispatchEvent(new Event('soulwisp-waiting-suspend'));setConnecting(true);
      try {
        const game=await client().consumeSeatReservation(reservation);
        if(generation.current!==currentGeneration||waiting.current!==joined){await game.leave();return;}
        bind(game);sessionStorage.setItem('wangxu-reconnect',game.reconnectionToken);
      } catch(error){if(generation.current===currentGeneration)errorRef.current((error as Error).message);}
      finally{if(generation.current===currentGeneration)setConnecting(false);}
    });
    joined.onDrop(()=>{if(waiting.current!==joined)return;errorRef.current('等待连接中断，准备已取消，正在重新连接。');setLobby(null);window.dispatchEvent(new Event('soulwisp-waiting-suspend'));});
    joined.onError((_code:number,message?:string)=>errorRef.current(message||'等待区连接出现错误，请重新加入。'));
    joined.onReconnect(remember);
    joined.onLeave(()=>{if(waiting.current!==joined)return;waiting.current=null;setLobby(null);sessionStorage.removeItem('wangxu-lobby-reconnect');window.dispatchEvent(new Event('soulwisp-waiting-exit'));});
  },[bind,detachGame]);
  const joinWaiting=useCallback(async()=>{
    if(waiting.current||joining.current)return;
    joining.current=true;const currentGeneration=generation.current;
    try{const reservation=await request<SeatReservation>('/lobby/join',{});if(generation.current!==currentGeneration)return;const joined=await client().consumeSeatReservation(reservation);if(generation.current!==currentGeneration){await joined.leave();return;}sessionStorage.setItem('wangxu-waiting-listen','true');bindWaiting(joined);}
    finally{joining.current=false;}
  },[bindWaiting]);
  const leaveWaiting=useCallback(async()=>{
    generation.current++;const current=waiting.current;waiting.current=null;setLobby(null);sessionStorage.removeItem('wangxu-lobby-reconnect');window.dispatchEvent(new Event('soulwisp-waiting-exit'));if(current)await current.leave();
  },[]);
  const send = useCallback((command: GameCommand) => { if (room.current && connected) room.current.send('command', command); }, [connected]);
  const sendLobby=useCallback((command:LobbyCommand)=>waiting.current?.send('lobbyCommand',command),[]);
  const leave = useCallback(async () => { if(view?.result&&waiting.current){waiting.current.send('returnEarly',{});return;}detachGame(); }, [detachGame,view?.result]);
  const reconnect = useCallback(async () => {
    const lobbyToken=sessionStorage.getItem('wangxu-lobby-reconnect');
    if(lobbyToken)try{bindWaiting(await client().reconnect(lobbyToken));}catch{sessionStorage.removeItem('wangxu-lobby-reconnect');}
    const token=sessionStorage.getItem('wangxu-reconnect');if(!token)return;
    setConnecting(true);
    try{bind(await client().reconnect(token));}catch{sessionStorage.removeItem('wangxu-reconnect');}finally{setConnecting(false);}
  }, [bind,bindWaiting]);
  useEffect(()=>{let alive=true;const refresh=()=>void request<{waiting:number;game:LobbyView['game']}>('/lobby').then(value=>{if(alive)setSummary({...value,available:true});}).catch(()=>{if(alive)setSummary(previous=>({...previous,available:false}));});refresh();const timer=setInterval(refresh,10000);return()=>{alive=false;clearInterval(timer);};},[]);
  useEffect(() => () => { generation.current++;void room.current?.leave();void waiting.current?.leave(); }, []);
  return {view,lobby,summary,connecting,connected,joinWaiting,leaveWaiting,sendLobby,send,leave,reconnect,settlementVersion};
}
