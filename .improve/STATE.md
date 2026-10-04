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

**Phase 4 — the improvement loop.** Recon complete (five reports in `.improve/reports/`,
`REPO_PROFILE.md`, 30 baseline screenshots). Backlog committed at 122 items (`5afcf02`), now 126
after the IMP-041 verifier filed four follow-ups. IMP-041 is shipped (`b957f90`); IMP-042 is in
progress.

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

**IMP-042 — mobile tool bar scroll affordance** (`IN-PROGRESS`, score 25, no deps). The 390px bottom
tool bar fits 5 of 13 tools and clips "Background" to "Backgroun" with no scroll indication.

## Counters

| Metric                              | Value |
| ----------------------------------- | ----- |
| Backlog items                       | 126   |
| Items DONE                          | 1 (IMP-041) |
| Items BLOCKED                       | 0     |
| Items NEEDS-HUMAN                   | 6     |
| Commits on branch                   | 3     |
| Commits since last regression sweep | 0     |

## Loop mechanics that must be followed

- One feature = one commit. `git add <only the paths that item touched>` plus the four `.improve/`
  state files. Never `git add -A`.
- Commit message format: `<type>(<scope>): <title> [IMP-###]` then `Why:` / `What:` / `Verified:` /
  `Backlog:` lines. Conventional types: feat, fix, docs, test, perf, refactor, style, chore, ci, a11y.
- After each commit: `git notes add -m "<verifier summary>" HEAD` — note `git notes add` takes **no
  `-q` flag**; that mistake cost one retry on IMP-041.
- MAX_ATTEMPTS 3. On a third failure, `git restore <paths>` the item's files, mark `BLOCKED`.
- REGRESSION_EVERY 10 commits. Refill when open TODOs drop below 20.

## Queue after IMP-042 (verify each `Depends on` before picking)

| Score | Item | Deps |
|---|---|---|
| 25 | IMP-042 mobile tool bar scroll affordance | none |
| 12.5 | IMP-054 bottom-sheet detent keyboard route | none |
| 12.5 | IMP-053 put the exit path within reach at 390px | IMP-042 |
| 12.5 | IMP-114 recipe to a shareable file | none |
| 12 | IMP-141 crop readout one line at textScale xlarge | IMP-041 **DONE** |
| 12 | IMP-019 e2e: the changing-image journey | IMP-001, IMP-005, IMP-006 |
| 10 | IMP-002 confirm before replacing a doc that has edits | none |
| 10 | IMP-140 fixed error panel occludes crop handles on mobile | none |
| 10 | IMP-001 "New image" action in the More menu | IMP-002, IMP-005 |

**The operator's headline fix is IMP-001 + IMP-002 + IMP-005 + IMP-006 (+ IMP-019 for its e2e case).**
IMP-002, IMP-005 and IMP-006 are all dependency-free or near-free; do them as a block so the headline
lands whole rather than shipping a "New image" button that can silently destroy unsaved work.

## Stop conditions

- `.improve/STOP` exists
- two consecutive discovery rounds yield < 10 valuable new items
- environment broken beyond one dedicated repair attempt