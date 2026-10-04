# Other problems found while fixing the headline fix

Not part of the seven verifier issues, not fixed here, and not silently dropped. Each
one is something a person reading this change would otherwise trip over.

## 1. `.crash` painted over its own dialog — found by adding the confirmation

`--z-skip` is `100`; `--z-overlay` is `70`. `RouteError` now renders `<ConfirmDialog>`
as a *sibling* of `<ErrorFallback>`, and `.crash` is `position: fixed; inset: 0` — so
the crash screen covered the question it was asking. The `Start over` confirm control
was visible, correctly named and **unreachable**: Playwright's log showed the
`Start over — deletes your photo and edits` button underneath intercepting pointer
events, forever.

Fixed here as `--z-crash: 65` (see `src/styles/tokens.css`), because
`e2e/journey.hub-reentry.spec.ts` could not be made to pass without it. Recorded
because the underlying shape is worth a row of its own: **any** future full-bleed
surface that owns a dialog needs the same argument, and the ladder is the place where
that argument belongs.

## 2. `RouteError`'s store reset was lost and had to be restored — and it was never in `HEAD`

Re-reading `RouteError.tsx` for this pass, the "Start over" handler in the working tree
was a doubled `.catch().finally().catch().finally()` chain: **it navigated to
`/editor` twice**, and on the first pass. That is not in `git show HEAD` — it was
introduced by the previous attempt of this change, and it passed the e2e suite because
navigating twice to the same route is idempotent. Restored as a single chain, plus the
`useDocStore.getState().load(createDoc())` the handler actually needs: the store is a
module singleton that outlives the route, so clearing the durable copies alone
remounts the page on the same broken document and the crash screen puts itself back on
top. That is the loop the e2e case was written for, and it does not pass without the
reset.

## 3. Six e2e specs press a destructive control without answering a question

`journey.layer-panels`, `journey.layers`, `journey.shell`, `journey.reload-loss`,
`journey.hub-reentry` and `journey.new-image` all had to be updated to click through the
dialog. Two of them (`journey.desktop-truthfulness`, `journey.layer-verify`) *name* a
destructive control but never press it, so they were left alone. This is recorded
because it is the shape the convention creates: **every new e2e case that deletes
something is now a two-press test**, and that cost is real and recurring. It is not a
reason to not ask — see `D8-F39`'s row for why the ask is not conditional on
reversibility — but it is a reason to keep the dialog to one press on the common path,
which it is: the safe control has focus, so Enter declines.

## 4. `handleDiscard` reads `resume?.doc` for the edit count, and the object it reads is a `Doc`

`countEdits` walks `past.length`, so the discard dialog's number is right. Worth noting
because the *other* dialog in the same file (`Reset all edits`) reads
`useDocStore.getState().past.length` directly, and the two are deliberately different
quantities from deliberately different sources. `destructive.test.ts` pins which is
which, because a future implementer will otherwise "deduplicate" them into one number
and one of the two dialogs will start quoting a store the screen it is on does not have.

## 5. `Editor.tsx`'s `useEffect` for the post-replace focus depends on `entry.action`

That is the right dependency — it changes exactly when the branch swaps — but it means
the effect runs once per navigation into the editor, not once per replacement. The
`focusAfterReplace` ref is what narrows it. A future refactor that reads this effect
should know the ref is the whole mechanism, and the two jsdom cases in
`EditorNewImage.test.tsx` are what fail if it is dropped.

## 6. Not fixed: `src/pages/**` coverage is `Editor.tsx` alone

`Editor.tsx` measures `lines 67.79 / branches 54.95 / functions 59.01 / statements
67.04` against thresholds `65 / 52 / 55 / 64`, so the area gate passes — but it passes
by about half a point on branches, and the margin is entirely this change's doing. The
functions still uncovered are the ones jsdom cannot reach: the render-time `bitmapFor`
throw, the export handlers, the onboarding branch. Writing that down rather than
relying on the number: **the next person to add an untested branch to `Editor.tsx` will
turn this gate red**, and the correct response is a test in `src/pages/`, not a
threshold change (D9-F02's row already says this and says why).