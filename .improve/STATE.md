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

**Phase 4 — the improvement loop.** Recon complete. Backlog at 128 items. **Shipped: IMP-041,
IMP-042, IMP-144, and the headline block IMP-001/002/005/006/007/008/009/010.** 12 DONE, 110 TODO,
6 NEEDS-HUMAN, 0 BLOCKED. Nothing has been pushed; `main` is untouched at `10ade26`.

## The operator's headline defect — SHIPPED

**"There is no way to open a different image."** Confirmed against the code and in
`desktop-17-more-menu.png`: `Editor.tsx:482` unmounts the import screen forever, the More menu had
nothing that changes the photo, and `useDocStore` being a module singleton (`docStore.ts:80`) made
the Hub reopen the *same* image. Only a full browser reload escaped.

Fixed in `0cb3b9b` — a More-menu **New image** action, a named Hub entry policy, and a confirmation
convention. Verified by a hard reload 48 ms after confirming (inside the 1000 ms autosave window):
import screen, mirror null, IndexedDB row absent, 0 Resume cards. Took three attempts; see the commit
message for what the first two got wrong, including a genuine data-loss bug.

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

**None — between items.** Next by score: IMP-054 (bottom-sheet detent keyboard route, 12.5, no deps),
then IMP-053 (exit path within reach at 390px, 12.5), IMP-114 (recipe to a shareable file, 12.5).

## Counters

| Metric                              | Value |
| ----------------------------------- | ----- |
| Backlog items                       | 128   |
| Items DONE                          | 12    |
| Items BLOCKED                       | 0     |
| Items NEEDS-HUMAN                   | 6     |
| Commits on branch                   | 8     |
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
| 15 | IMP-144 second baseline set at default appearance | none |
| 12.5 | IMP-054 bottom-sheet detent keyboard route | none |
| 12.5 | IMP-053 put the exit path within reach at 390px | IMP-042 **DONE** |
| 12.5 | IMP-114 recipe to a shareable file | none |
| 12 | IMP-141 crop readout one line at textScale xlarge | IMP-041 **DONE** |
| 12 | IMP-143 pin scroll-padding-inline for focused chips | IMP-042 **DONE** |
| 10 | IMP-002 confirm before replacing a doc that has edits | none |
| 10 | IMP-140 fixed error panel occludes crop handles on mobile | none |
| 10 | IMP-142 replace the vacuous frameFit assertion | IMP-041 **DONE** |
| 10 | IMP-005 (in the headline block) | none |
| 8 | IMP-139 recover the mobile crop preview area | IMP-041 **DONE** |

**The operator's headline fix is IMP-001 + IMP-002 + IMP-005 + IMP-006 (+ IMP-019 for its e2e case).**
That is the "no way to open a different image" defect they named. IMP-002, IMP-005 and IMP-006 are
dependency-free; do all four as a block so the headline lands whole rather than shipping a
"New image" button that can silently destroy unsaved work. IMP-019 is its e2e case.

## Learned in the loop — apply these

- **A verifier must judge PAINT, not declarations.** IMP-042 attempt 1 shipped a mask that
  composited fully opaque (both edges invisible) behind a test asserting a CSS declaration string.
  It passed. Ask for pixel/byte evidence.
- **Mutate to prove a test bites.** Both verifiers did this and it is what caught the ungated metric.
- **Always check what appearance settings a screenshot was taken at.** They were roomy+xlarge, and
  it silently skewed every visual magnitude quoted so far.
- `git notes add` accepts no `-q` flag.

## Stop conditions

- `.improve/STOP` exists
- two consecutive discovery rounds yield < 10 valuable new items
- environment broken beyond one dedicated repair attempt