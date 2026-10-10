#!/usr/bin/env node
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { validateCommit } from './check-commit.mjs';

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const isZero = value => shaPattern.test(value ?? '') && /^0+$/.test(value);

function git(cwd, args, input) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], {
    cwd, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || 'Git failed.');
  }
  return result.stdout.trimEnd();
}

function commitObject(cwd, reference, label) {
  try { return git(cwd, ['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`]); }
  catch { throw new Error(`Cannot read ${label} commit ${reference}. Fetch complete history and the event's exact base/head commits before checking.`); }
}

export function eventRange(eventName, event) {
  if (eventName === 'push') {
    if (!shaPattern.test(event.before ?? '') || !shaPattern.test(event.after ?? '')) throw new Error('Push payload must contain valid before and after commit SHAs.');
    return { base: event.before, head: isZero(event.after) ? null : event.after };
  }
  if (eventName === 'pull_request') {
    const base = event.pull_request?.base?.sha;
    const head = event.pull_request?.head?.sha;
    if (!shaPattern.test(base ?? '') || !shaPattern.test(head ?? '') || isZero(base) || isZero(head)) throw new Error('Pull request payload must contain actual base and head commit SHAs.');
    return { base, head };
  }
  throw new Error(`Unsupported event ${eventName ?? '(missing)'}. Use push, pull_request, or the local --range command.`);
}

export function checkHistory({ base, head, cwd = process.cwd() }) {
  if (head === null) return { commits: [], failures: [] };
  const tip = commitObject(cwd, head, 'head');
  const fromRoot = base === 'ROOT' || isZero(base);
  const baseline = fromRoot ? null : commitObject(cwd, base, 'base');
  const selected = git(cwd, ['rev-list', '--reverse', tip, ...(baseline ? ['--not', baseline] : []), '--']);
  const commits = selected ? selected.split('\n') : [];
  const failures = [];
  for (const sha of commits) {
    const message = git(cwd, ['show', '--no-patch', '--no-show-signature', '--format=%B', sha]);
    const errors = validateCommit(message);
    if (errors.length) failures.push({ sha, subject: message.split('\n')[0], errors });
  }
  return { commits, failures };
}

function selfTest() {
  const cwd = mkdtempSync(join(tmpdir(), 'soulwisp-commit-history-'));
  try {
    git(cwd, ['init', '--bare', '--quiet']);
    const tree = git(cwd, ['mktree'], '');
    const write = (message, parents = []) => git(cwd, ['-c', 'user.name=History Fixture', '-c', 'user.email=history@example.test', 'commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-F', '-'], message);
    const valid = description => `test(tooling): ${description}\n\nWhy: Verify commit selection and message policy.\nValidation: Native Git history fixtures passed.\n`;
    const root = write(valid('create a history fixture'));
    const head = write(valid('check a branch change'), [root]);
    const invalid = write(valid('check a branch change').replace('check a branch change', '\u68c0\u67e5\u63d0\u4ea4'), [root]);
    const invalidBody = write(valid('check a message body').replace('Verify commit selection and message policy.', '\u5fc5\u987b\u4f7f\u7528\u82f1\u6587'), [root]);
    const synthetic = write('Merge pull request #1\n', [head, root]);
    const zero = '0'.repeat(40);
    const initial = checkHistory({ cwd, ...eventRange('push', { before: zero, after: head }) });
    assert.deepEqual(initial.commits, [root, head]); assert.equal(initial.failures.length, 0);
    assert.deepEqual(checkHistory({ cwd, base: root, head }).commits, [head]);
    assert.equal(checkHistory({ cwd, base: root, head: invalid }).failures.length, 1);
    assert.equal(checkHistory({ cwd, base: root, head: invalidBody }).failures.length, 1);
    assert.deepEqual(checkHistory({ cwd, base: head, head: invalid }).commits, [invalid]);
    const pr = checkHistory({ cwd, ...eventRange('pull_request', { after: synthetic, pull_request: { base: { sha: root }, head: { sha: head } } }) });
    assert.deepEqual(pr.commits, [head]); assert.equal(pr.failures.length, 0);
    assert.equal(checkHistory({ cwd, base: head, head: synthetic }).failures.length, 1);
    assert.deepEqual(checkHistory({ cwd, ...eventRange('push', { before: head, after: zero }) }).commits, []);
    assert.throws(() => checkHistory({ cwd, base: 'f'.repeat(40), head }), /Cannot read base commit/);
    assert.throws(() => eventRange('push', { before: zero, after: '--all' }), /valid before and after/);
    console.log('Commit history checker: 10 native Git range/message cases passed.');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--self-test') selfTest();
    else {
      let range;
      if (args.length === 3 && args[0] === '--range') range = { base: args[1], head: args[2] };
      else if (args.length === 0 && process.env.GITHUB_EVENT_PATH) range = eventRange(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
      else throw new Error('Usage: node scripts/check-commit-history.mjs [--self-test | --range <base-or-ROOT> <head>]. CI reads GITHUB_EVENT_NAME and GITHUB_EVENT_PATH.');
      const { commits, failures } = checkHistory(range);
      for (const failure of failures) {
        console.error(`Commit ${failure.sha.slice(0, 12)} ${JSON.stringify(failure.subject)} rejected:\n${failure.errors.map(error => `- ${error}`).join('\n')}`);
      }
      console.log(`Commit history: checked ${commits.length} introduced commit(s); ${failures.length} rejected.`);
      if (failures.length) { console.error('See CONTRIBUTING.md for the required English commit format.'); process.exitCode = 1; }
    }
  } catch (error) { console.error(`Cannot check commit history: ${error.message}`); process.exitCode = 2; }
}
