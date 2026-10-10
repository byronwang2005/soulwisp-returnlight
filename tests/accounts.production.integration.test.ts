import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const base = 'http://127.0.0.1:3024';
const gameBase = 'http://127.0.0.1:2584';
const prefix = `production-auth-${randomUUID()}`;
const password = `Test-${randomUUID()}`;
let server: ChildProcess;
let logs = '';
const email = (index: number) => `${prefix}-${index}@example.test`;

async function authRequest(path: string, body: object) {
  return fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(body),
  });
}
async function waitUntilReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Production test server exited: ${logs.slice(-1500)}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok && (await fetch(`${gameBase}/health`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Production test server did not become ready: ${logs.slice(-1500)}`);
}

describe('production authentication for ten players sharing one network', () => {
  beforeAll(async () => {
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
      env: { ...process.env, NODE_ENV: 'production', API_PORT: '3024', GAME_PORT: '2584',
        AUTH_BASE_URL: base, ALLOWED_ORIGINS: base },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', data => { logs += data; });
    server.stderr?.on('data', data => { logs += data; });
    await waitUntilReady();
  }, 25_000);

  afterAll(async () => {
    if (server?.exitCode === null) {
      const exited = new Promise<void>(resolve => server.once('exit', () => resolve()));
      server.kill('SIGTERM');
      await Promise.race([exited, new Promise<void>(resolve => setTimeout(() => {
        if (server.exitCode === null) server.kill('SIGKILL');
        resolve();
      }, 5000))]);
    }
    const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try { await database.query('DELETE FROM auth_user WHERE email LIKE $1', [`${prefix}-%@example.test`]); }
    finally { await database.end(); }
  }, 15_000);

  it('accepts ten registrations and logins, then returns real 429 responses beyond each configured threshold', async () => {
    // No forwarded address headers: every request uses the same shared fallback bucket.
    const registrations = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      authRequest('sign-up/email', { email: email(index), name: `同网玩家${index + 1}`, password })));
    for (const response of registrations) {
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get('set-cookie')).toBeTruthy();
    }
    const logins = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      authRequest('sign-in/email', { email: email(index), password })));
    for (let index = 0; index < logins.length; index++) {
      const response = logins[index]!;
      expect(response.status, await response.clone().text()).toBe(200);
      const login = await response.json() as { user: { id: string; email: string }; token: string };
      expect(login.user.email).toBe(email(index));
      expect(login.token).toBeTruthy();
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      const session = await fetch(`${base}/api/auth/get-session`, { headers: { Cookie: cookie } });
      expect(session.status).toBe(200);
      expect((await session.json() as { user: { id: string } }).user.id).toBe(login.user.id);
    }

    for (let index = 10; index < 12; index++) {
      const response = await authRequest('sign-up/email', { email: email(index), name: `注册余量${index}`, password });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const signupBlocked = await authRequest('sign-up/email', { email: email(12), name: '超过注册额度', password });
    expect(signupBlocked.status).toBe(429);
    expect(Number(signupBlocked.headers.get('x-retry-after'))).toBeGreaterThan(0);
    for (let index = 10; index < 20; index++) {
      const response = await authRequest('sign-in/email', { email: email(index % 10), password });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const signinBlocked = await authRequest('sign-in/email', { email: email(0), password });
    expect(signinBlocked.status).toBe(429);
    expect(Number(signinBlocked.headers.get('x-retry-after'))).toBeGreaterThan(0);

    const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      expect((await database.query('SELECT count(*)::integer AS total FROM auth_user WHERE email LIKE $1', [`${prefix}-%@example.test`])).rows[0].total).toBe(12);
      expect((await database.query('SELECT count(*)::integer AS total FROM auth_user WHERE email=$1', [email(12)])).rows[0].total).toBe(0);
    } finally { await database.end(); }
  }, 45_000);
});
