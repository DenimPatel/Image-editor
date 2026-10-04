# Improver state — resume point

## Session

- **Branch:** `improve/auto-20261004` (created from `main` at `10ade26`)
- **Started:** 2026-10-04
- **Never push:** `.git/hooks/pre-push` installed (blocks all pushes).
- **State dir committed:** yes, `.improve/**` except `artifacts/` (which is in `.git/info/exclude`
  and `.prettierignore`).

## Conflicting instruction, and how it is resolved

`AGENTS.md` says "**Do not commit.** Work is expected to stay in the working tree unless explicitly told."
The orchestrator operator explicitly instructed an autonomous commit-per-feature loop. Resolved by:
committing only to `improve/auto-20261004`, never to `main`, never pushing. `main` stays exactly as found.

## Repo profile (one line)

Client-side, local-first image editor web app. React + TypeScript + Vite, WebGL2 backend with a
Canvas2D fallback, IndexedDB persistence, vitest (jsdom) unit tests, Playwright e2e (3 projects).
Verified commands are in `REPO_PROFILE.md`; the gate baseline is in `.improve/reports/recon-runbook.md`
— read its CORRECTION section, its FAIL-1 is stale.

## Phase

**Phase 3 — Backlog Critic.** Recon is complete: five reports in `.improve/reports/`,
`REPO_PROFILE.md`, and 30 baseline screenshots in `.improve/artifacts/baseline/`.
`FEATURES.md` was merged from four parallel tier analysts at 125 items; the Critic is sharpening it
in place. Next: commit the backlog, then start the loop on Tier 1.

## The headline finding, in one line

**There is no way to open a different image.** `Editor.tsx:482` unmounts the import screen forever;
the More menu has no such action; `useDocStore` is a module singleton (`docStore.ts:80`) so the Hub
reopens the *same* image; only a full browser reload escapes. This is the operator's own example,
confirmed against the code and in `desktop-17-more-menu.png`. Tier 1 leads with it.

## Sub-agent operating notes (learned the hard way — do not relearn)

- **`explore` sub-agents cannot write files.** No `write` tool, and every shell write path is denied.
  They can post long content to the board in numbered parts, but the orchestrator must transcribe it.
  **Use `subagent_type: "general"` for anything that must produce a file.**
- **A `general` sub-agent that calls `board_post` with malformed input aborts its whole turn.**
  Instruct agents explicitly: write the file, do not post to the board.
- **One agent reading five large reports times out before writing anything.** Split work across
  parallel agents with fixed ID ranges and tell them to write incrementally after ~6 tool calls of
  reading. The single-agent backlog attempt timed out twice at exactly this point.

## Counters

| Metric                              | Value |
| ----------------------------------- | ----- |
| Backlog items (pre-Critic)          | 125   |
| Items DONE                          | 0     |
| Items BLOCKED                       | 0     |
| Items NEEDS-HUMAN                   | 2+    |
| Commits on branch                   | 1     |
| Commits since last regression sweep | 0     |

## Current item

(none — Critic is editing `FEATURES.md`)

## Next action on resume

1. `cat .improve/STATE.md`
2. Check `.improve/FEATURES.md` item count and that its header matches the file
3. Commit `chore(improve): initial improvement backlog (N items)`
4. Start the loop on the highest-priority Tier 1 `TODO` whose `Depends on` are `DONE`

## Loop mechanics that must be followed

- One feature = one commit. `git add <only the paths that item touched>` plus the four `.improve/`
  state files. Never `git add -A`.
- Commit message format: `<type>(<scope>): <title> [IMP-###]` then `Why:` / `What:` / `Verified:` /
  `Backlog:` lines. Conventional types: feat, fix, docs, test, perf, refactor, style, chore, ci, a11y.
- After each commit, `git notes add -m "<verifier summary>" HEAD`.
- MAX_ATTEMPTS 3. On a third failure, `git restore <paths>` the item's files, mark `BLOCKED`.
- REGRESSION_EVERY 10 commits. Refill when open TODOs drop below 20.

## Stop conditions

- `.improve/STOP` exists
- two consecutive discovery rounds yield < 10 valuable new items
- environment broken beyond one dedicated repair attempt