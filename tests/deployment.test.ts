import { afterEach, expect, test } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertAdmissionOpen, createDeploymentAdmin } from '../apps/server/src/deployment.js';

const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

test('container-only maintenance blocks admissions, reports rooms, and resumes', async () => {
  let count = 2;
  let pending = 1;
  const server = createDeploymentAdmin(() => count, 0, () => pending);
  await once(server, 'listening');
  const address = server.address() as { port: number; address: string };
  expect(address.address).toBe('127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(url + '/drain')).status).toBe(404);
    expect(() => assertAdmissionOpen()).not.toThrow();
    expect(await (await fetch(url + '/drain', { method: 'POST' })).json()).toMatchObject({ draining: true, rooms: 2 });
    expect(() => assertAdmissionOpen()).toThrow('服务正在更新');
    count = 0;
    expect(await (await fetch(url + '/status')).json()).toMatchObject({ draining: true, rooms: 0, pendingSettlements: 1 });
    pending = 0;
    expect(await (await fetch(url + '/status')).json()).toMatchObject({pendingSettlements:0});
    await fetch(url + '/resume', { method: 'POST' });
    expect(() => assertAdmissionOpen()).not.toThrow();
  } finally {
    await fetch(url + '/resume', { method: 'POST' });
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

function release(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'soulwisp-deploy-'));
  fixtures.push(root);
  const sha = 'a'.repeat(40);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, 'deploy'));
  mkdirSync(join(root, 'releases', sha, 'deploy'), { recursive: true });
  writeFileSync(join(root, 'deploy', '.env'), 'private fixture');
  writeFileSync(join(root, 'releases', sha, 'deploy', 'Dockerfile'), 'fixture');
  const mock = `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2), name=process.argv[1].split('/').pop();
fs.appendFileSync(process.env.LOG,JSON.stringify({name,args})+'\\n');
const mode=process.env.MODE;
if(name==='timeout'){const r=require('node:child_process').spawnSync(args[1],args.slice(2),{stdio:'inherit'});process.exit(r.status??1)}
if(name==='curl'){console.log(JSON.stringify({ok:true,revision:mode==='health-failure'?'old':process.env.SHA}));process.exit(0)}
if(name==='sleep'||name==='flock')process.exit(0);
if(args[0]==='inspect'){console.log(args.includes('{{.Image}}')?'sha256:old':'RELEASE_SHA=old');process.exit(0)}
if(args[0]==='build')process.exit(mode==='build-failure'?1:0);
if(args.includes('ps'))console.log('running-app');
if(args.includes('config'))console.log(JSON.stringify({services:{app:{build:{args:{VITE_GAME_URL:'wss://game.example.test'}}}}}));
if(args.includes('/scripts/backup.sh'))process.exit(mode==='backup-failure'?1:0);
if(args.includes('node')){
 const action=args[args.length-1]==='POST'?args[args.length-2]:args[args.length-1];
 if(action==='status' && mode==='legacy')process.exit(1);
 console.log(JSON.stringify({draining:true,rooms:mode==='busy'?1:0,pendingSettlements:mode==='pending'?1:0}));
}
if(args.includes('up') && mode==='switch-failure'){
 const files=args.filter((_,i)=>args[i-1]==='-f');
 const text=fs.readFileSync(files[files.length-1],'utf8');
 if(!text.includes('rollback-'))process.exit(1);
}
`;
  for (const name of ['docker', 'curl', 'sleep', 'flock', 'timeout']) writeFileSync(join(bin, name), mock, { mode: 0o755 });
  const log = join(root, 'commands.jsonl');
  const result = spawnSync('bash', [resolve('deploy/release.sh'), root, sha], {
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, LOG: log, MODE: mode, SHA: sha, DRAIN_TIMEOUT_SECONDS: '0' },
    encoding: 'utf8', timeout: 10_000,
  });
  const commands = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { name: string; args: string[] });
  return { root, sha, result, commands };
}

test('release builds before draining, backs up, checks exact revision, and records the image', () => {
  const { root, sha, result, commands } = release('success');
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(join(root, 'deploy', 'current-revision'), 'utf8').trim()).toBe(sha);
  expect(readFileSync(join(root, 'deploy', 'runtime-image.yaml'), 'utf8')).toContain('soulwisp-app:' + sha);
  expect(commands.findIndex(c => c.args[0] === 'build')).toBeLessThan(commands.findIndex(c => c.args.includes('drain')));
  const ups = commands.filter(c => c.args.includes('up'));
  expect(ups).toHaveLength(1);
  expect(ups[0].args.slice(-1)).toEqual(['app']);
  expect(ups[0].args).toContain('--no-deps');
  expect(commands.some(c => c.args.includes('/scripts/backup.sh'))).toBe(true);
});

for (const mode of ['busy', 'backup-failure']) test(`${mode} resumes admissions without replacing the app`, () => {
  const { result, commands } = release(mode);
  expect(result.status).not.toBe(0);
  expect(commands.some(c => c.args.includes('resume'))).toBe(true);
  expect(commands.some(c => c.args.includes('up'))).toBe(false);
});
for (const mode of ['build-failure', 'legacy']) test(`${mode} leaves the running app untouched`, () => {
  const { result, commands } = release(mode);
  expect(result.status).not.toBe(0);
  expect(commands.some(c => c.args.includes('drain'))).toBe(false);
  expect(commands.some(c => c.args.includes('up'))).toBe(false);
});
for (const mode of ['switch-failure', 'health-failure']) test(`${mode} restores the exact previous image and fails the run`, () => {
  const { root, result, commands } = release(mode);
  expect(result.status).not.toBe(0);
  expect(readFileSync(join(root, 'deploy', 'runtime-image.yaml'), 'utf8')).toContain('soulwisp-app:rollback-');
  expect(commands.filter(c => c.args.includes('up'))).toHaveLength(2);
  expect(commands.some(c => c.args.includes('pg_restore'))).toBe(false);
});

test('release waits for pending settlements even with an empty game slot', () => {
  const {result,commands}=release('pending');expect(result.status).not.toBe(0);expect(commands.some(command=>command.args.includes('/scripts/backup.sh'))).toBe(false);
});
