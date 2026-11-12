# Agent instructions: EcoShield Caspian (hackathon MVP)

Approved plan: docs/PLAN.md. Acceptance criteria: docs/features.json. Progress log: docs/PROGRESS.md.
Human-facing version of these rules (Russian): CONTRIBUTING.md.

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
