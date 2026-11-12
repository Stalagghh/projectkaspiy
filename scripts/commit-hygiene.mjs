#!/usr/bin/env node
/**
 * Commit hygiene check for this repository.
 *
 * It enforces two project rules (see CONTRIBUTING.md):
 *   1. No AI attribution in commit messages, pull request titles or descriptions.
 *   2. Every commit is authored and committed by the project identity.
 *
 * Usage:
 *   node scripts/commit-hygiene.mjs msg <file>     check a commit message file (lefthook commit-msg)
 *   node scripts/commit-hygiene.mjs text           check text from stdin (PR title and body in CI)
 *   node scripts/commit-hygiene.mjs range <range>  check every commit in a git revision range (CI)
 *   node scripts/commit-hygiene.mjs unpushed       check local commits that are on no remote (pre-push)
 *
 * The project identity comes from HYGIENE_NAME and HYGIENE_EMAIL (set in CI) or,
 * when they are empty, from this repository's git config user.name and user.email.
 *
 * Exit codes: 0 = clean, 1 = a rule is violated, 2 = usage or configuration error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Text that must never appear in commit messages or pull request texts. */
export const FORBIDDEN_PATTERNS = [
  { rule: 'co-author trailer', pattern: /co-authored-by:/i },
  { rule: 'AI vendor no-reply address', pattern: /noreply@anthropic\.com/i },
  { rule: 'tool attribution line ("generated with")', pattern: /generated with/i },
  { rule: 'robot emoji', pattern: /\u{1F916}/u },
];

// Names of the AI tool or its vendor. The agent instruction file (CLAUDE.md) and the
// local settings folder (.claude/) are file names, not attribution, so they are removed first.
const TOOL_NAME = /\b(?:claude|anthropic)\b/i;
const ALLOWED_FILE_NAMES = /\bCLAUDE\.md\b|\.claude\b(?:\/[\w./-]*)?/gi;

/** Returns the rules that a piece of text violates; an empty list means the text is clean. */
export function findViolations(text) {
  const violations = FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ rule }) => rule,
  );
  if (TOOL_NAME.test(text.replace(ALLOWED_FILE_NAMES, ''))) {
    violations.push('mention of an AI tool or vendor');
  }
  return violations;
}

/**
 * Removes what git itself strips from a commit message before committing:
 * comment lines and, for `git commit --verbose`, everything below the scissors line.
 */
export function cleanCommitMessage(raw) {
  const lines = raw.split('\n');
  const scissors = lines.findIndex((line) => /^# -+ >8 -+$/.test(line));
  return (scissors === -1 ? lines : lines.slice(0, scissors))
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

/** Lists commits whose author or committer is not the project identity. */
export function identityViolations(commits, identity) {
  const isProjectIdentity = (name, email) =>
    name === identity.name && email.toLowerCase() === identity.email.toLowerCase();
  const problems = [];
  for (const commit of commits) {
    const short = commit.sha.slice(0, 8);
    if (!isProjectIdentity(commit.authorName, commit.authorEmail)) {
      problems.push(
        `${short}: author "${commit.authorName} <${commit.authorEmail}>" is not the project identity`,
      );
    }
    if (!isProjectIdentity(commit.committerName, commit.committerEmail)) {
      problems.push(
        `${short}: committer "${commit.committerName} <${commit.committerEmail}>" is not the project identity`,
      );
    }
  }
  return problems;
}

class UsageError extends Error {}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitConfig(key) {
  try {
    return git(['config', '--get', key]).trim();
  } catch {
    return '';
  }
}

function projectIdentity() {
  const name = process.env.HYGIENE_NAME || gitConfig('user.name');
  const email = process.env.HYGIENE_EMAIL || gitConfig('user.email');
  if (!name || !email) {
    throw new UsageError(
      'project identity is unknown: set git config user.name/user.email or HYGIENE_NAME/HYGIENE_EMAIL',
    );
  }
  return { name, email };
}

// ASCII unit and record separators never occur in names, emails or commit messages.
const FIELD = '\x1f';
const RECORD = '\x1e';

function readCommits(revisionArgs) {
  const format = ['%H', '%an', '%ae', '%cn', '%ce', '%B'].join(FIELD) + RECORD;
  return git(['log', `--format=${format}`, ...revisionArgs])
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha, authorName, authorEmail, committerName, committerEmail, message] =
        record.split(FIELD);
      return { sha, authorName, authorEmail, committerName, committerEmail, message };
    });
}

function checkCommits(revisionArgs, label) {
  const identity = projectIdentity();
  const commits = readCommits(revisionArgs);
  const problems = identityViolations(commits, identity);
  for (const commit of commits) {
    for (const rule of findViolations(commit.message)) {
      problems.push(`${commit.sha.slice(0, 8)}: commit message contains a ${rule}`);
    }
  }
  console.log(`commit-hygiene: project identity ${identity.name} <${identity.email}>`);
  console.log(`commit-hygiene: ${commits.length} commit(s) checked (${label})`);
  for (const commit of commits) {
    const subject = commit.message.split('\n')[0];
    console.log(
      `  ${commit.sha.slice(0, 8)}  author ${commit.authorName} <${commit.authorEmail}>` +
        ` | committer ${commit.committerName} <${commit.committerEmail}> | ${subject}`,
    );
  }
  return problems;
}

function main(argv) {
  const [mode, argument] = argv;
  let problems;
  if (mode === 'msg' && argument) {
    const message = cleanCommitMessage(readFileSync(argument, 'utf8'));
    problems = findViolations(message).map((rule) => `commit message contains a ${rule}`);
  } else if (mode === 'text') {
    problems = findViolations(readFileSync(0, 'utf8')).map((rule) => `text contains a ${rule}`);
  } else if (mode === 'range' && argument) {
    problems = checkCommits([argument], argument);
  } else if (mode === 'unpushed') {
    problems = checkCommits(['--branches', '--not', '--remotes'], 'local commits not on any remote');
  } else {
    throw new UsageError(
      'usage: commit-hygiene.mjs msg <file> | text | range <revision-range> | unpushed',
    );
  }
  if (problems.length > 0) {
    console.error('commit-hygiene: FAILED');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('See CONTRIBUTING.md, section "Авторство коммитов".');
    return 1;
  }
  console.log('commit-hygiene: OK');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`commit-hygiene: ${error instanceof UsageError ? error.message : error}`);
    process.exitCode = 2;
  }
}
