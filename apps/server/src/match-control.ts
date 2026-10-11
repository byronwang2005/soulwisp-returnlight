import { randomUUID } from 'node:crypto';
import type { LobbyCoordinator } from './lobby-coordinator.js';
export const INTERNAL_CREATE_KEY = randomUUID();
export let lobbyCoordinator: LobbyCoordinator | undefined;
export function setLobbyCoordinator(value: LobbyCoordinator) { lobbyCoordinator = value; }

export let notifySettlement: (ids: string[]) => void = () => {};
export function setSettlementNotifier(value: (ids: string[]) => void) { notifySettlement = value; }
