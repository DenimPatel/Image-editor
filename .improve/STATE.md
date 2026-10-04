# Improver state — resume point

## Session

- **Branch:** `improve/auto-20261004` (created from `main` at `10ade26`)
- **Started:** 2026-10-04
- **Never push:** `.git/hooks/pre-push` installed (blocks all pushes).
- **State dir committed:** yes, `.improve/**` except `artifacts/` (which is in `.git/info/exclude`).

## Conflicting instruction, and how it is resolved

`AGENTS.md` says "**Do not commit.** Work is expected to stay in the working tree unless explicitly told."
The orchestrator operator explicitly instructed an autonomous commit-per-feature loop. Resolved by:
committing only to `improve/auto-20261004`, never to `main`, never pushing. `main` stays exactly as found.

## Repo profile (one line)

Client-side, local-first image editor web app. React + TypeScript + Vite, WebGL2 backend with a
Canvas2D fallback, IndexedDB persistence, vitest (jsdom) unit tests, Playwright e2e (3 projects).
Verified commands are in `REPO_PROFILE.md`; pre-existing red gates in `.improve/reports/recon-runbook.md`.

## Phase

**Phase 2 — Reconnaissance.** Five sub-agents running in parallel:
`recon-journeys`, `recon-architecture`, `recon-runbook`, `recon-quality`, `recon-experience`.

The operator's explicit priority: **full user journeys, dead ends and loopholes first**, then
general UI/UX polish. The owner's worked example: after picking a stock image and editing it, there
must be a visible way back to choosing or uploading a different image. Treat that as the first
family of items the backlog must cover.

## Counters

| Metric                              | Value |
| ----------------------------------- | ----- |
| Items DONE                          | 0     |
| Items BLOCKED                       | 0     |
| Items NEEDS-HUMAN                   | 0     |
| Commits on branch                   | 0     |
| Commits since last regression sweep | 0     |

## Current item

(none — backlog not yet created)

## Next action on resume

1. `cat .improve/STATE.md`
2. Read the summaries of the five recon agents' reports in `.improve/reports/`
3. Launch the Profile Writer sub-agent → `REPO_PROFILE.md`
4. Launch the Backlog Architect → `FEATURES.md` (>= 100 items, journeys first)
5. Launch the Backlog Critic → sharpen in place
6. Commit `chore(improve): initial improvement backlog (N items)`, then start the loop

## Stop conditions

- `.improve/STOP` exists
- two consecutive discovery rounds yield < 10 valuable new items
- environment broken beyond one dedicated repair attempt
