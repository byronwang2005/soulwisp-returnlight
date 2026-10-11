import type { CampData } from '@wangxu/shared';
export const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
export interface User { id: string; name: string; email: string; image?: string|null }
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error?.message || (typeof data.error === 'string' ? data.error : `请求失败 (${response.status})`));
  return data as T;
}
export async function getSession(): Promise<User | null> { const data = await request<{user?: User}>('/auth/get-session'); return data?.user || null; }
export async function getCamp(): Promise<CampData> { const data = await request<CampData | {camp:CampData}>('/camp'); return 'camp' in data ? data.camp : data; }
export function requestId() { return crypto.randomUUID(); }
