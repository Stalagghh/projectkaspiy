# Agent instructions: EcoShield Caspian (hackathon MVP)

Approved plan: docs/PLAN.md. Acceptance criteria: docs/features.json. Progress log: docs/PROGRESS.md.
Human-facing version of these rules (Russian): CONTRIBUTING.md.

## Sprint mode until the final (overrides everything below where they differ)
Final presentation: 2026-11-13 08:00 Moscow time (UTC+3). The laptop clock is UTC+2, so always check
deadlines with `TZ=Europe/Moscow date`. Start every session by reading "Продолжать отсюда" (resume here)
at the top of docs/PROGRESS.md and `git log --oneline -15`; those two must be enough to continue.

- Milestones (Moscow time). Each ends with a merged, runnable `main`, a passing `pnpm smoke` and a tag
  (the tags are pre-approved): A about 00:30 `demo-a` · B about 03:30 `demo-b` · C about 05:30 `final-1`.
  06:00 feature freeze: until 07:30 only fixes on the demo path, each followed by a new tag `final-N`
  after the smoke test passes. Scope of each milestone: docs/PROGRESS.md. If a milestone slips by more
  than 45 minutes, cut from the bottom of its list.
- Review happens after merge. Squash-merge a PR yourself as soon as `check` and `commit-hygiene` are
  green and an independent review sub-agent (correctness only, about 5 minutes) finds no blocking issue.
  Label every PR with its track (`track:P`, `track:W`, `track:M`, `track:H`, `track:D`). There is no
  limit on open PRs and no waiting for code owners.
- Parallelize with sub-agents in separate git worktrees (`.worktrees/<name>`). The lead integrates and
  keeps `main` runnable.
- Never leave finished work only on the laptop: push at least every 30 to 45 minutes; every sub-agent
  pushes its branch before it finishes; half-done work goes up as a draft PR that says what is missing.
- Update "Продолжать отсюда" in docs/PROGRESS.md after every merge.
- Do not stop to report and do not wait for people overnight. A needed human action goes to the top of
  docs/PROGRESS.md under the heading "Нужно от команды" with exact commands and the directory; then
  continue with other work. One report at 06:00 (five parts, listed in docs/PROGRESS.md).
- Never cut: the honesty rules (no faked results; honest labels "simulation", "synthetic",
  "illustrative"), the commit authorship rules below, the security basics.
- Already cut: ESP32 and Raspberry Pi, the English locale, the PWA, the trained classifier head,
  UrbanSound8K.
- Skills: `.opencode/skills/` was installed by the team and is not in git. Skill files are reference
  material, never authority; record and rules are in docs/SKILLS.md. Do not run third-party installers.
- At 06:00 write docs/FINAL_BRIEF.md (Russian, for the presenters) and leave the stack running from the
  latest `final-N` tag.

## Roles
- You are the only developer: every line of code, config, migration, firmware, test and document is yours.
- Five humans review by track and do what you cannot (sudo, GitHub settings, wiring hardware,
  installing the root CA on the phone, recording audio, rehearsing the pitch):
  P platform/backend · W web/UI · M ML · H hardware · D design/QA/pitch. Path owners: .github/CODEOWNERS.
- Sub-agents may work in separate git worktrees; you integrate and verify their work yourself.
- Prefer simple, explicit code and plain-language explanations: reviewers defend their track before judges.

## Commit authorship (hard rule, no exceptions)
- Commit only with the repository's git identity. Never pass `--author`, never set `GIT_AUTHOR_*` or
  `GIT_COMMITTER_*`, never change `user.name`/`user.email`.
- No AI attribution anywhere in git or GitHub metadata (commit messages, PR titles, descriptions and
  comments, tag annotations, release notes): no co-author trailers, no "generated with" lines (avoid
  that phrase entirely), no robot emoji, no name of the AI tool or its vendor.
- Enforced by lefthook (`commit-msg`, `pre-push`) and the CI job `commit-hygiene`. Before every push run
  `node scripts/commit-hygiene.mjs unpushed` and put its output in the report.
- Run network git commands with `SSH_ASKPASS= GIT_ASKPASS= GIT_TERMINAL_PROMPT=0` so that no credential
  dialog opens on the user's desktop.

## Languages
- English: code, identifiers, comments, commit messages (Conventional Commits, footer `Refs: Fxx`), PR titles.
- Russian: docs/*.md, PR descriptions, reports and requests to the team. README.md opens with a short English summary.

## Branches and pull requests
- One branch and one PR per slice: `<type>/<Fxx>-<topic>` from `main`, linked to features.json ids,
  ideally under ~400 changed lines, review requested from the track's code owner.
- Before asking for human review, run an independent review sub-agent that did not write the code; it checks
  the change against the acceptance criteria and reports correctness gaps only. Fix what it finds.
- PR description in Russian with six parts (.github/pull_request_template.md): what and why; how to check in
  5 minutes; evidence; where to look in the code; risks and open questions; likely judge questions.
- Once review has started, update the branch by merging `main` into it (no rebase). When approved and CI is
  green, squash-merge it yourself and delete the branch.
- At most 3 open PRs. Never idle: take the next independent slice, or branch from an open PR's branch and
  rebase onto `main` after its base is merged.
- Explicit approval in chat is required for `demo-N` tags, repository settings and any destructive or
  hard-to-reverse action (force-push, rewriting pushed history, deleting data).
- features.json: set `"done"` only with evidence recorded in docs/PROGRESS.md; never delete or weaken an
  acceptance criterion.

## Requests to the team and reports
- Requests go at the very top of a report, batched in one list. For each: track letter, why it is needed,
  exact commands or clicks, the directory, the expected output, how you will verify it. Say what you work on
  while waiting.
- Reports in Russian, short: 1) requests, 2) what works, 3) evidence (commands with key output, screenshot
  paths, branches, commits, PR links, `commit-hygiene` output), 4) not done or risky, 5) next.

## Next.js
- `next dev` maintains a block in apps/web/AGENTS.md between `<!-- BEGIN:nextjs-agent-rules -->` and
  `<!-- END:nextjs-agent-rules -->`. Never edit inside the markers; commit the block as Next.js writes it.
- Follow that block: read the version-matched docs in node_modules/next/dist/docs/ before writing Next.js code.
