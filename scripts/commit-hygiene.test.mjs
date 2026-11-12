// Tests for scripts/commit-hygiene.mjs. Run with: node --test scripts/
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cleanCommitMessage, findViolations, identityViolations } from './commit-hygiene.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'commit-hygiene.mjs');
const run = (args, options = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...options });

// The forbidden examples are assembled from parts so this file never contains them verbatim.
const TRAILER = ['Co', 'Authored', 'By:'].join('-');
const ROBOT = String.fromCodePoint(0x1f916);
const VENDOR_ADDRESS = ['noreply', 'anthropic.com'].join('@');

const CLEAN_MESSAGE = 'feat(alerts): add alert feed\n\nShows open alerts sorted by severity.\n\nRefs: F08\n';
const ATTRIBUTED_MESSAGE = `feat(alerts): add alert feed\n\n${TRAILER} Someone <${VENDOR_ADDRESS}>\n`;

test('rejects every forbidden pattern', () => {
  const cases = [
    [`${TRAILER} A <a@example.com>`, 'co-author trailer'],
    [`${TRAILER.toLowerCase()} lower case`, 'co-author trailer'],
    [`contact ${VENDOR_ADDRESS}`, 'AI vendor no-reply address'],
    ['Generated WITH some tool', 'tool attribution line ("generated with")'],
    [`${ROBOT} done`, 'robot emoji'],
    ['Written with Claude', 'mention of an AI tool or vendor'],
    ['an Anthropic model', 'mention of an AI tool or vendor'],
  ];
  for (const [text, rule] of cases) {
    assert.ok(findViolations(text).includes(rule), `"${text}" should violate "${rule}"`);
  }
});

test('accepts a normal conventional commit message', () => {
  assert.deepEqual(findViolations(CLEAN_MESSAGE), []);
});

test('allows the file names CLAUDE.md and .claude/ that are not attribution', () => {
  assert.deepEqual(
    findViolations('docs: update CLAUDE.md and ignore .claude/settings.local.json'),
    [],
  );
});

test('cleanCommitMessage drops git comments and the verbose diff below the scissors line', () => {
  const raw = `${CLEAN_MESSAGE}# Please enter the commit message\n# ------------------------ >8 ------------------------\n+ ${ROBOT} in a diff\n`;
  assert.deepEqual(findViolations(cleanCommitMessage(raw)), []);
});

test('identity check flags a foreign author and a foreign committer', () => {
  const identity = { name: 'Project', email: 'project@example.com' };
  const commits = [
    {
      sha: 'a'.repeat(40),
      authorName: 'Someone Else',
      authorEmail: 'else@example.com',
      committerName: 'Project',
      committerEmail: 'project@example.com',
    },
    {
      sha: 'b'.repeat(40),
      authorName: 'Project',
      authorEmail: 'project@example.com',
      committerName: 'GitHub',
      committerEmail: 'noreply@github.com',
    },
  ];
  const problems = identityViolations(commits, identity);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /author "Someone Else/);
  assert.match(problems[1], /committer "GitHub/);
});

test('identity check accepts the project identity, email compared case-insensitively', () => {
  const identity = { name: 'Project', email: 'project@example.com' };
  const commit = {
    sha: 'c'.repeat(40),
    authorName: 'Project',
    authorEmail: 'Project@Example.com',
    committerName: 'Project',
    committerEmail: 'project@example.com',
  };
  assert.deepEqual(identityViolations([commit], identity), []);
});

// Hook path: lefthook runs `msg <file>` for every commit.
test('commit-msg hook mode rejects an attributed message and accepts a clean one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-hygiene-'));
  try {
    writeFileSync(join(dir, 'attributed'), ATTRIBUTED_MESSAGE);
    writeFileSync(join(dir, 'clean'), CLEAN_MESSAGE);
    const rejected = run(['msg', join(dir, 'attributed')]);
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stderr, /co-author trailer/);
    const accepted = run(['msg', join(dir, 'clean')]);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// CI path: the PR title and description are piped into `text`.
test('CI text mode rejects an attributed PR body and accepts a clean Russian one', () => {
  const rejected = run(['text'], { input: `feat(map): add layers\n\n${ROBOT} Generated with a tool\n` });
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  const accepted = run(['text'], {
    input: 'feat(map): add layers\n\n## 1. Что сделано и зачем\nДобавлены слои карты.\n',
  });
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
});

// CI path: every commit of a PR is checked against the project identity.
test('CI range mode passes for the commit identity and fails for any other', (t) => {
  let fields;
  try {
    fields = execFileSync('git', ['log', '-50', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce'], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.split('\x1f'))
      .find(([sha, an, ae, cn, ce]) => sha && an === cn && ae === ce);
  } catch {
    fields = undefined;
  }
  if (!fields) {
    t.skip('no commit with identical author and committer in this checkout');
    return;
  }
  const [sha, name, email] = fields;
  const range = `${sha}^!`;
  const accepted = run(['range', range], {
    env: { ...process.env, HYGIENE_NAME: name, HYGIENE_EMAIL: email },
  });
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const rejected = run(['range', range], {
    env: { ...process.env, HYGIENE_NAME: name, HYGIENE_EMAIL: 'someone-else@example.invalid' },
  });
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
});
