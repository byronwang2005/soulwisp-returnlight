#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const types = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'style', 'build', 'ci', 'chore', 'revert'];
const headerPattern = new RegExp(`^(${types.join('|')})\\([a-z][a-z0-9-]*\\)(!)?: ([a-z][\\x20-\\x7e]*)$`);

export function validateCommit(message) {
  const lines = message.replace(/\r\n?/g, '\n').split('\n').filter(line => !line.startsWith('#'));
  while (lines.at(-1)?.trim() === '') lines.pop();
  const errors = [];
  const header = lines[0] ?? '';
  if (!headerPattern.test(header)) errors.push('Use type(scope): lowercase English action with a supported type and lowercase scope.');
  if (header.length > 72) errors.push('Keep the subject at most 72 characters.');
  if (header.endsWith('.')) errors.push('Omit the final period from the subject.');
  if (header !== header.trimEnd()) errors.push('Remove trailing whitespace from the subject.');
  if (/[^\x09\x0a\x20-\x7e]/.test(lines.join('\n'))) errors.push('Write the subject, body, and footers in English using printable ASCII text.');
  if (lines[1] !== '') errors.push('Separate the subject from the body with a blank line.');

  const whyIndex = lines.findIndex((line, index) => index > 1 && /^Why:(?: |$)/.test(line));
  const validationIndex = lines.findIndex((line, index) => index > 1 && /^Validation:(?: |$)/.test(line));
  const sectionContent = (index, end) => index < 0 ? '' : [lines[index].replace(/^[^:]+:\s*/, ''), ...lines.slice(index + 1, end)].join('\n').trim();
  if (whyIndex < 0 || !sectionContent(whyIndex, validationIndex > whyIndex ? validationIndex : whyIndex + 1)) errors.push('Add a nonempty Why: section explaining the reason for the change.');
  const footerIndex = lines.findIndex((line, index) => index > validationIndex && /^(?:BREAKING CHANGE|Refs|Closes|Fixes|Co-authored-by|Signed-off-by):/.test(line));
  if (validationIndex < 0 || !sectionContent(validationIndex, footerIndex < 0 ? lines.length : footerIndex)) errors.push('Add a nonempty Validation: section naming checks and actual results.');
  if (whyIndex >= 0 && validationIndex >= 0 && validationIndex < whyIndex) errors.push('Place Why: before Validation:.');
  if (headerPattern.exec(header)?.[2] && !lines.some(line => /^BREAKING CHANGE: \S/.test(line))) errors.push('Explain the impact and migration in a nonempty BREAKING CHANGE: footer.');
  return errors;
}

function selfTest() {
  const valid = 'fix(render): improve frame pacing and character facing\n\nWhy: Movement needs a clear direction.\nValidation: Type checking and the production build passed.';
  const cases = [
    [valid, true],
    [valid.replaceAll('\n', '\r\n'), true],
    [valid + '\n# Git template comment\n', true],
    [valid.replace('Why: Movement needs a clear direction.', 'Why:\nMovement needs a clear direction.'), true],
    [valid.replace('fix(render):', 'fix(render)!:') + '\n\nBREAKING CHANGE: Update clients before connecting.', true],
    [valid.replace('fix(render):', 'fix:'), false],
    [valid.replace('fix(render):', 'unknown(render):'), false],
    [valid.replace('fix(render):', 'fix(Render):'), false],
    [valid.replace('improve frame pacing and character facing', 'Improve frame pacing'), false],
    [valid.replace('improve frame pacing and character facing', 'improve rendering.'), false],
    [valid.replace('improve frame pacing and character facing', 'a'.repeat(70)), false],
    [valid.replace('improve frame pacing and character facing', '\u6539\u5584\u6e32\u67d3'), false],
    [valid.replace('Movement needs a clear direction.', '\u79fb\u52a8\u9700\u8981\u660e\u786e\u65b9\u5411'), false],
    [valid.replace('\n\nWhy:', '\nWhy:'), false],
    [valid.replace('Why: Movement needs a clear direction.', 'Why:'), false],
    [valid.replace('Validation: Type checking and the production build passed.', 'Validation:'), false],
    [valid.replace('Validation: Type checking and the production build passed.', 'Validation:\n\nRefs: #12'), false],
    [valid.replace('fix(render):', 'fix(render)!:'), false],
    ['# Git template comment\n', false],
    [valid.replace('Why: Movement needs a clear direction.\nValidation: Type checking and the production build passed.', 'Validation: Type checking passed.\nWhy: Movement needs a clear direction.'), false],
  ];
  for (const [message, accepted] of cases) assert.equal(validateCommit(message).length === 0, accepted, message);
  console.log(`Commit validator: ${cases.length} cases passed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = process.argv[2];
  if (argument === '--self-test') selfTest();
  else if (!argument || process.argv.length !== 3) {
    console.error('Usage: node scripts/check-commit.mjs <message-file> | --self-test');
    process.exitCode = 2;
  } else {
    try {
      const errors = validateCommit(readFileSync(argument, 'utf8'));
      if (errors.length) {
        console.error('Commit message rejected:\n' + errors.map(error => `- ${error}`).join('\n'));
        console.error('See CONTRIBUTING.md for the required English commit format.');
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`Cannot read commit message: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
