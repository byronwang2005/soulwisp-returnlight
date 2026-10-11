import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, type Room } from '@colyseus/sdk';
import type { GameCommand, GameView } from '@wangxu/shared';
import { request } from './api';
export function useExpedition(onError: (message: string) => void) {
  const [view, setView] = useState<GameView | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [settlementVersion,setSettlementVersion] = useState(0);
  const room = useRef<Room | null>(null);
  const errorRef = useRef(onError); errorRef.current = onError;
  const bind = useCallback((joined: Room) => {
    room.current = joined; setConnected(true);
    joined.reconnection.enabled=true;joined.reconnection.minDelay=250;joined.reconnection.maxDelay=4000;joined.reconnection.maxRetries=20;
    joined.onDrop(()=>{window.dispatchEvent(new Event('soulwisp-game-audio-reset'));setConnected(false);setConnecting(true);errorRef.current('远征连接暂时中断，正在自动恢复席位。');});
    joined.onReconnect(()=>{window.dispatchEvent(new Event('soulwisp-game-audio-reset'));setConnected(true);setConnecting(false);sessionStorage.setItem('wangxu-reconnect',joined.reconnectionToken);});
    joined.onMessage('view', (state: GameView) => setView(state));
    joined.onMessage('error', (error: {message:string}) => errorRef.current(error.message));
    joined.onError((_code: number, message?: string) => errorRef.current(message || '远征连接出现错误。'));
    joined.onMessage('settlementCommitted',()=>setSettlementVersion(version=>version+1));
    joined.onLeave(() => { setConnected(false);setConnecting(false); if (room.current === joined) { room.current = null; setView(null); sessionStorage.removeItem('wangxu-reconnect'); } });
  }, []);
  const join = useCallback(async (capacity: number, invite?: string) => {
    setConnecting(true);
    try {
      const {ticket} = await request<{ticket:string;userId:string}>('/game-ticket', {});
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const client = new Client(import.meta.env.VITE_GAME_URL || `${scheme}//${location.hostname}:2567`);
      const options = {ticket,capacity,...(invite ? {invite:invite.trim().toUpperCase()} : {})};
      const joined = invite ? await client.joinOrCreate('expedition', options) : await client.create('expedition', options);
      bind(joined);
      sessionStorage.setItem('wangxu-reconnect', joined.reconnectionToken);
    } finally { setConnecting(false); }
  }, [bind]);
  const send = useCallback((command: GameCommand) => { if (room.current && connected) room.current.send('command', command); }, [connected]);
  const leave = useCallback(async () => { const current = room.current; room.current = null; sessionStorage.removeItem('wangxu-reconnect'); if (current) await current.leave(); setView(null); setConnected(false); }, []);
  const reconnect = useCallback(async () => {
    const token = sessionStorage.getItem('wangxu-reconnect'); if (!token) return;
    setConnecting(true);
    try { const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'; const client = new Client(import.meta.env.VITE_GAME_URL || `${scheme}//${location.hostname}:2567`); bind(await client.reconnect(token)); }
    catch { sessionStorage.removeItem('wangxu-reconnect'); } finally { setConnecting(false); }
  }, [bind]);
  useEffect(() => () => { void room.current?.leave(); }, []);
  return {view,connecting,connected,join,send,leave,reconnect,settlementVersion};
}
