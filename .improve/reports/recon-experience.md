# Experience audit — visual baseline and UX/UI defects

**Agent:** EXPERIENCE AUDITOR
**Date:** 2026-10-04
**Branch observed:** `improve/auto-20261004`

## Method

Real-browser. I used the **Playwright MCP browser tools** (`playwright_browser_navigate`,
`_resize`, `_click`, `_find`, `_evaluate`, `_take_screenshot`, `_console_messages`) — **not** a
hand-written script against `@playwright/test`. Every geometry, overflow, colour and z-order claim
below was measured in the real engine with `getBoundingClientRect()` / `getComputedStyle()`
inside `browser_evaluate`, never read off the source. Nothing here is inferred from jsdom.

## Environment

| Item | Value |
| --- | --- |
| **Exact URL tested** | `http://localhost:5173/Image-editor/` |
| Basename | `import.meta.env.BASE_URL` = `/Image-editor/` — `GET /` returns `302 → /Image-editor/`, so the bare origin is not the app |
| Server | **Already listening on 5173** (PID 27068, `vite --host 0.0.0.0 --port 5173 --strictPort`, cwd = this repo). Reused. Not killed, not restarted, no second server started. |
| Confirmation | `GET /Image-editor/` → **200**, `GET /Image-editor/editor` → **200** |
| **Desktop viewport** | `1280 × 800`, DPR 1, screenshots at `scale: 'css'` |
| **Mobile viewport** | `390 × 844`, DPR 1, screenshots at `scale: 'css'` |
| Mobile caveat | This is a **narrow-viewport desktop context**, not an emulated device — `hasTouch` / `isMobile` were **not** set. It is therefore *not* the Pixel 7 profile `e2e/journey.mobile*.spec.ts` uses. Layout-at-390px findings are in scope; touch-specific behaviour is not claimed. |
| Routes exercised | `/`, `/editor`, and via the tool bar `/editor/crop`, `/editor/adjust`, `/editor/filters`, `/editor/retouch`, `/editor/draw`, `/editor/layers`, `/editor/passport`, `/editor/export` |
| Image used | Built-in **"Sample 1"** (1271 × 1920 portrait). Chosen to avoid the file chooser and any network fetch. |
| Not exercised | Background removal (≈42 MB from the imgly CDN — `AGENTS.md` forbids it). **Text, Stickers, Redact, Frame never opened.** |

## Screenshot index — 30 files, 21 desktop + 9 mobile

All paths relative to `.improve/artifacts/baseline/`.

| # | File | State shown |
| --- | --- | --- |
| 1 | `desktop-01-hub-hero.png` | Hub, full-page. **All 8 tool cards invisible** (opacity 0) — see H-01 |
| 2 | `desktop-02-hub-tools-grid.png` | Hub at scrollY 1100. Sticky header slices the top card row; 2-card orphan final row |
| 3 | `desktop-03-hub-grid-full.png` | Hub grid at scrollY 820. 3 columns, ragged last row, teal "featured" border on "Open Full Editor" |
| 4 | `desktop-04-editor-empty.png` | `/editor` empty state, top of scroll. "Continue editing?" card sliced at the fold, no scroll cue |
| 5 | `desktop-05-editor-empty-scrolled.png` | Empty state at scrollTop 585 (max 585). Resume card + 3 sample tiles + Pexels credit |
| 6 | `desktop-06-editor-loaded.png` | Editor workspace, image loaded, no panel open. 13-tool bottom bar |
| 7 | `desktop-07-skiplink-focus.png` | "Skip to the canvas" focused — green pill, white ring, sits below the header |
| 8 | `desktop-08-crop-panel.png` | Crop sheet at scrollTop 0. Readout + "Reset crop"/"Perspective" overlay the photo |
| 9 | `desktop-09-crop-rotate-flip-belowfold.png` | Crop sheet at scrollTop 300 (max 299). **Rotate/flip are icon-only, invisible until you scroll.** Collapsed PLATFORM disclosure |
| 10 | `desktop-10-crop-readout-occludes-handle.png` | **Bottom-centre crop handle focused — focus ring entirely hidden.** See H-03 |
| 11 | `desktop-11-adjust-panel.png` | Adjust sheet opened at **carried scrollTop 300** — top row sliced. See H-04 |
| 12 | `desktop-12-looks-panel.png` | Looks sheet. 24 near-identical thumbnails, full-width "None" bar, bottom row cut by the tab bar |
| 13 | `desktop-13-passport-panel.png` | Passport sheet. Ragged 1-2-1-1-1-1 chip packing; "US visa" chip cut in half |
| 14 | `desktop-14-layers-empty.png` | Layers sheet, "No layers yet". Clean, well-written |
| 15 | `desktop-15-export-panel.png` | Export sheet top. **SIZE control conflates 5 concepts**; METADATA row cut |
| 16 | `desktop-16-export-download-belowfold.png` | Export sheet bottom. **Download sits 1280 px below the opening view**; 4 equal-weight buttons |
| 17 | `desktop-17-more-menu.png` | Overflow menu. "Reset all edits" styled as a routine item — see H-06 |
| 18 | `desktop-18-retouch-panel.png` | Retouch sheet. Healing preview with the circle drawn on the face; "Add heal spot" below the fold |
| 19 | `desktop-19-draw-tool-panel.png` | Draw sheet, no layer: only "New drawing layer" |
| 20 | `desktop-20-draw-controls.png` | Draw sheet with a layer: 19 controls, ragged blend grid, unitless "Size 2" |
| 21 | `desktop-21-done-noop-with-panel-open.png` | **The frame after clicking "Done" with Draw open — identical to #20.** See C-01 |
| 22 | `mobile-01-hub-hero.png` | Hub at 390 px, full page. **Header wraps to 188 px over 3 rows** — see H-05 |
| 23 | `mobile-02-hub-grid.png` | Hub grid at 390 px, scrolled. **Sticky header occludes card tops and icon tiles** |
| 24 | `mobile-03-editor-empty.png` | Empty state at 390 px. Prose wall; the drop zone starts at y≈605 of 844 |
| 25 | `mobile-04-editor-empty-samples.png` | Samples at 390 px. **2-then-1 orphan, 120 px cards, 66 % of width used** |
| 26 | `mobile-05-editor-loaded.png` | Editor at 390 px. **"Background" clipped mid-word; 8 of 13 tools off-screen** — see H-02 |
| 27 | `mobile-06-crop-sheet.png` | Crop sheet at 390 px. **Canvas collapses to 135 × 204**; print-size row cut |
| 28 | `mobile-07-export-sheet.png` | Export sheet at 390 px. **1489 px below the fold to Download** |
| 29 | `mobile-08-appearance-panel.png` | Appearance dialog at 390 px. MOTION sliced; Icon size entirely invisible |
| 30 | `mobile-09-shortcuts-dialog.png` | Shortcuts dialog at 390 px. Title wraps to 2 lines; diagnostics block cut mid-sentence |

## Console, per state

**Clean.** On a fresh load every navigation and every panel switch reported **0 errors**. Walking
Crop → Adjust → Looks → Passport → Export on a fresh load, with `console.error`/`console.warn`
instrumented, produced **zero** new entries.

| State | Errors | Warnings |
| --- | --- | --- |
| Hub `/` (desktop + mobile) | 0 | 1 |
| Editor empty state (desktop + mobile) | 0 | 1 |
| Editor with image, no panel | 0 | 1 |
| Crop sheet | 0 | 1 |
| Adjust sheet | 0 | 1 |
| Looks sheet (24 thumbnails, 24 requests) | 0 | 1 |
| Retouch sheet | 0 | 1 |
| Draw sheet, before and after layer creation | 0 | 1 |
| Layers sheet | 0 | 1 |
| Passport sheet | 0 | 1 |
| Export sheet, top and scrolled to bottom | 0 | 1 |
| Overflow "…" menu | 0 | 1 |
| Appearance dialog | 0 | 1 |
| Keyboard-shortcuts dialog | 0 | 1 |

The single warning, on every page, pre-existing and benign:

```
React Router Future Flag Warning: React Router will begin wrapping state updates in
React.startTransition in v7. You can use the `v7_startTransition` future flag to opt-in early.
  @ node_modules/.vite/deps/react-router-dom.js:3614
```

**Console errors that are NOT baseline defects.** A full-session log
(`browser_console_messages({all:true})`) holds ~20 errors that are all hot-reload artefacts caused
by **other agents editing `src/` while this browser session was live**. The evidence is in the URLs
— every one carries a Vite HMR timestamp query (`CropRegionOverlay.tsx?t=1791036489798`,
`SegmentedControl.tsx?t=1791027170074`, `EditorCanvas.tsx?t=1791033277390`):

- `Failed to load resource: 500` and `404` on `CropRegionOverlay.tsx`, `SegmentedControl.tsx`
- `[vite] Failed to reload /src/components/canvas/CropRegionOverlay.tsx`
- `Rendered more hooks than during the previous render` — `EditorTopBar` / `useMenuPopover`
- `React has detected a change in the order of Hooks called by EditorTopBar` (hook 19 `useRef` → `useState`)
- `TypeError: Cannot read properties of null (reading 'getSnapshot')` — `EditorCanvas`
- `Failed to fetch dynamically imported module: …/src/pages/Editor.tsx`

The "order of Hooks" pair is the classic HMR false positive when a component's hook list changes
across a hot update. **Not filed as baseline defects** — a hard reload reproduces none of them.
Worth a follow-up glance anyway: `EditorTopBar`'s hook order is unstable under HMR, and a real
Rules-of-Hooks violation would present identically.
## The journey, step by step: is there a way BACK, is the way FORWARD obvious, is the location obvious?

| Step | Where you are | Way BACK | Way FORWARD | Is the location obvious? |
| --- | --- | --- | --- | --- |
| 1. Land on the Hub | `/` | n/a | **Yes** — "Start editing" (filled) and "See what it can do" (ghost), plus 8 named tool cards | Yes — hero H1 + status pill. But 44 % of the viewport is nav (see H-05) and the 8 cards are `opacity: 0` until you scroll (H-01) |
| 2. Choose a tool card | `/editor/crop` etc. | **Yes** — the X at top-left, `aria-label="Back to home"` | Yes — the tool sheet auto-opens | Yes — sheet title names the tool and the tool tab is highlighted green |
| 3. Empty state | `/editor` | **Yes** — X, and the browser Back | Yes — drop zone, and 3 one-tap samples | **Partly** — the top bar says "New image", not the app name; no wordmark |
| 4. Image loaded, no panel | `/editor` | **Yes** — X returns to the Hub | **Weak** — "Done" in the top-right. If it worked it would be the forward path. It does not (C-01) | Yes — document title in the top bar ("Sample 1") |
| 5. Inside a tool sheet | `/editor/crop` | **Yes, three ways** — X, the sheet's "Close", and Escape | **BROKEN** — "Done" is a no-op (C-01). The only forward path is scrolling the bottom bar to Export, which at 390 px is 629 px of hidden overflow (H-02) | Yes — sheet title + green tab |
| 6. Export sheet | `/editor/export` | Yes — X, "Close", Escape | **Yes but buried** — Download is 1280 px / 1489 px below the opening view (M-01) | Yes |
| 7. Back out to the Hub, then re-enter | `/` → `/editor` | — | — | **No — see C-02** |

**Summary of the two journey defects this produces:** the forward path out of an editing session
is a dead button in the state you are in whenever you are actually editing (C-01), and the return
path does not return you to a clean start (C-02).

### The Hub → editor → back → editor re-entry loop — CONFIRMED, and the user can notice it

Directly observed in this session. With Sample 1 loaded, I navigated `/editor` → `/` (Hub) →
`/editor`. The editor mounted **already showing Sample 1 on the canvas** — the import screen never
came back. I then clicked Crop, Adjust, Looks, Passport and Export in sequence and all five
succeeded without loading an image, which is only possible if the document was already live.

**Can a user notice?** Yes, in three ways, and none of them is signposted:

1. **The import screen is gone for the rest of the session.** There is no "New image" or "Open a
   different photo" control anywhere I could find. The overflow menu (`desktop-17`) has seven
   items: Keyboard shortcuts, Appearance…, Reset all edits, Copy edits, Paste edits, Save preset…,
   Photo details — **none of them opens a new file.**
2. **The only signal of which document is open is the title text "Sample 1" in the top bar.** There
   is no thumbnail, no filename, no "New" affordance. A user who clicks "Open Editor" from the Hub
   expecting to choose a photo lands in a photo they may not recognise, with no breadcrumb and no
   obvious way to change it.
3. **The word "New" appears in exactly the wrong place.** The empty state's top bar reads
   **"New image"** (`mobile-03`, `desktop-04`) — a label describing the *pending action*. Once an
   image is loaded the same bar shows the document name instead. So the label that means "you have
   nothing yet" is gone precisely when a user most wants a way to get back to it.

Corroborated independently by the journey recon as D-01: `Editor.tsx:482` unmounts `ImportScreen`
permanently once `source` exists, and `docStore` is a module singleton, so Hub "Start editing"
(`Hub.tsx:165`) and Nav "Open Editor" (`Nav.tsx:42`) reopen the *same* document. Only a full
browser reload returns to the import screen.

**Minimal fix:** add a **"New image"** item to the overflow menu that clears the doc, the session
and the mirror, and confirms first when the document has edits. It belongs in that menu because the
top bar has no room (see H-05) and the Hub re-entry path is the trap.

## Hover-only and pointer-only discoverability

I drove this session entirely from `browser_evaluate` and the MCP click helpers — **no hover was
required to complete any task, and no task was blocked by a missing hover.** That is a positive
result. Two specifics:

- **Nothing useful is hover-only.** The skip link is `:focus`-revealed (`desktop-07`) and works.
  Every tool in the bottom bar and every chip in every sheet carries a visible text label.
- **But two things are hover-or-pointer-only in the sense that matters:** the
  `title`-attribute-only help on "Auto tone" (the journey recon flagged this as D-08 — a `title`
  tooltip is unreachable on touch), and the **undocumented double-click-to-fit** on the canvas. A
  user on a phone cannot discover either.
- **Drag-only interactions with no keyboard alternative** are covered in M-05: the canvas has
  `tabindex=null`, `role=null`, `aria-label=null`, so **there is no keyboard way to place a draw
  stroke**. Every other Draw control (19 of them) *is* reachable, which makes the gap sharper, not
  softer. Crop handles are the counter-example and work correctly — see "correct" below.

**Icon-only controls with no visible label — the complete list I found:**

| Control | Panel | Visible label | Accessible name | Screenshot |
| --- | --- | --- | --- | --- |
| Rotate left | Crop | **none** — ↺ glyph only | `Rotate left` | `desktop-09` |
| Rotate right | Crop | **none** — ↻ glyph only | `Rotate right` | `desktop-09` |
| Flip horizontally | Crop | **none** — ⇄ glyph only | `Flip horizontally` | `desktop-09` |
| Fill frame after straightening | Crop | **none** — glyph only | `Fill frame after straightening` | `desktop-09` |
| Undo / Redo | Editor top bar | **none** — arrow glyphs only | present | `desktop-06` |
| Close editor | Editor top bar | **none** — ✕ only | `Close editor` | `desktop-06` |
| More options | Editor top bar | **none** — `…` only | `More options` | `desktop-06` |
| Colour swatch | Draw | **none** — bare red square | *(empty — `input[type=color]` with no `aria-label`)* | `desktop-20` |

Two of these are load-bearing problems rather than nits:

1. **The four Crop icon buttons hold the only rotate/flip controls in the entire app.** The Hub's
   "Crop & Straighten" card copy sells exactly this — *"Crop to any ratio, straighten, rotate or
   flip — with precision."* They are unlabelled **and** invisible until you scroll 299 px past the
   print-size list. So a promised capability is behind an unlabelled glyph behind a scroll.
2. **The Draw colour input has no accessible name at all** — measured `aria-label` absent, and the
   visible word "Colour" is a sibling `<span>`, not an associated `<label>`. A screen-reader user
   reaches a bare colour well with no name.

The rotate/flip/undo/redo/close/more glyphs are all reasonably conventional, so the missing names
are a polish gap rather than a blocker. The **Crop row** and the **unnamed colour input** are real.

---

# Findings

## Critical

### C-01 — "Done" is a dead control whenever any tool panel is open
**Shows it:** `desktop-21-done-noop-with-panel-open.png` (compare `desktop-20-draw-controls.png`)

"Done" occupies the top-right of the editor — the single most prominent exit affordance. It has
**two different behaviours**:

| State before the click | Result |
| --- | --- |
| **No** panel open | Opens the **Export** sheet. Measured: `panel: false → true`, `panelTitle: "Export"`, current tab `undefined → "Export"` |
| **Any** panel open (Draw measured) | **Nothing happens.** Measured: `panel: true → true`, `panelTitle: "Draw" → "Draw"`, current tab `Draw → Draw`, no navigation, 1500 ms wait |

`desktop-21` is the frame 1.2 s after the click and is **pixel-identical** to `desktop-20`. Since
opening a tool is the normal way to use this editor, "Done" is dead in the state a user is in
whenever they are actually editing. It also means "Done" has no consistent meaning: sometimes
"go to export", sometimes "nothing".

**Minimal fix:** in `Editor.tsx` change the handler from
`if (!activeTool) setActiveTool('export')` to an unconditional `setActiveTool('export')`.
`ToolTabBar.tsx:79-86` has already decided tabs are not toggles, so this is consistent.
*(Corroborated by journey recon D-02.)*

### C-02 — Leaving and re-entering the editor reopens the same photo, with no way to change it
**Shows it:** `desktop-06-editor-loaded.png`, `mobile-05-editor-loaded.png` (both show a loaded canvas reached with no import step)

Confirmed by direct observation: `/editor` → Hub `/` → `/editor` remounts **with the image already
loaded**; the import screen never returns. I then drove Crop, Adjust, Looks, Passport and Export
in sequence with no image load and all five worked. Three ways a user can notice, none signposted —
detailed in the journey table above. Headline: the overflow menu's seven items contain **no
"New image"**, and the word "New image" only appears on the empty state's top bar, i.e. exactly
when the user does not need it.

**Minimal fix:** add a **"New image"** item to the overflow menu (`EditorTopBar.tsx` menu array)
that clears doc + session + mirror, confirming first when `edits > 0`.
*(Corroborated by journey recon D-01.)*

## High

### H-01 — The Hub's entire primary content is `opacity: 0` until JS runs
**Shows it:** `desktop-01-hub-hero.png`

`Hub.tsx:124-142` observes `.reveal` and adds `.is-visible` on intersection; CSS starts every card
at `opacity: 0; transform: translateY(16px)`.

- On load at 1280 × 800, all **8 cards measure `opacity: 0`**.
- `page.screenshot({fullPage: true})` does **not** trigger the observer, so `desktop-01` renders the
  tool grid — the only content below the hero — as a **~1000 px blank void**. The page looks broken.
- Content is invisible to anything that does not scroll-and-wait: print, find-in-page, a
  screenshot-based visual regression test, a cold cache on a slow client.

Interactive scrolling does reveal them (verified 0 → 0.998 → 1), so a human is not blocked. But a
full-page screenshot is wrong today, and that is the cheapest automated visual check anyone will
write.

**Minimal fix:** invert the pattern — cards render at `opacity: 1` by default and the observer
*adds* an entrance transition. Keep the `prefers-reduced-motion` short-circuit at `Hub.tsx:125`.

### H-02 — At 390 px the tool bar overflows 629 px; 8 of 13 tools are off-screen with no affordance
**Shows it:** `mobile-05-editor-loaded.png`

Measured on `nav[aria-label="Editor tools"]`: `scrollWidth 1019`, `clientWidth 390`,
`overflow-x: auto`, **`offsetWidth - clientWidth === 0`** (overlay scrollbar, so nothing paints).

Fully off-screen: **Text, Draw, Stickers, Redact, Frame, Layers, Passport, Export — 8 of 13.**
"Background" spans x 307–409 and is **bisected at the 390 px edge with its label clipped mid-word**
("Backgroun"). No fade, no chevron, no page dot, no "scroll for more".

The two tools that get a user *out* of the editor — **Passport and Export — are last in the DOM and
therefore furthest off-screen.** The primary exit path is the hardest to reach at the viewport
where it matters most. This is the single highest-value mobile fix in the report.

**Minimal fix:** at ≤ 480 px render a 3-up icon grid or move tools 7–13 into a "More" sheet; or at
minimum add a right-edge `mask-image` fade plus `scroll-snap-type: x proximity` so the affordance
is visible. A fade alone does not fix *discoverability of Export* — the grid does.

### H-03 — The crop readout is painted over the bottom-centre crop handle, hiding its focus ring
**Shows it:** `desktop-10-crop-readout-occludes-handle.png`

Measured at 1280 × 800, Crop sheet at scrollTop 0:

| Element | Box |
| --- | --- |
| readout `1271 × 1920 px · 2:3` | x 374–546, y 687–719 |
| bottom-centre crop handle (`role="slider"`, `tabindex="0"`, `aria-label="Crop s handle"`) | x 446–474, y 699–727 |

They **overlap across x 446–474 × y 699–719 — a 28 × 20 px region.** Focusing that handle yields
**no visible focus indicator at all**: in `desktop-10` the handle's dark square peeks out below the
chip with its focus ring completely covered. A keyboard user tabbing the handles gets zero feedback
on the one that straddles the readout. Same overlap at 390 px (`mobile-06`), where the readout and
the whole bottom handle row share a 204 px-tall canvas.

**Minimal fix:** move the readout out of the crop frame — dock it below the canvas or in the sheet —
or give it a lower stacking order than the handles and shift it above the frame's bottom edge.
`z-index` alone does not fix the *overlap*, only the paint order; it must also move.

### H-04 — Switching tools never resets the sheet scroll, so you land mid-panel on a sliced row
**Shows it:** `desktop-11-adjust-panel.png`

One shared scroll container (`_sheetBody_xerem_239`, `overflow-y: auto`) is reused by every tool.
Measured:

| Action | `scrollTop` after |
| --- | --- |
| Crop sheet, user scrolled to bottom | 300 |
| click **Adjust** | **300** (carried) |
| click **Looks** | **300** (carried) |

`desktop-11` is the consequence: Adjust opens with the top row of adjustment chips **sliced in half** —
the bottom of three icons and a row of `0 0 0` values sit above the "Adjust" title, with nothing to
say the panel is scrolled.

**Minimal fix:** `useEffect(() => { bodyRef.current.scrollTop = 0 }, [activeTool])`, or give the
scroller a `key={activeTool}`.

### H-05 — The Hub header wraps to 188 px at 390 px, then permanently occludes scrolled content
**Shows it:** `mobile-01-hub-hero.png`, `mobile-02-hub-grid.png`

At 390 × 844, `documentElement.scrollWidth === 390` — so there is **no horizontal scroll**; the
header **wraps**. Height **188 px** vs 84 px on desktop.

| Control | Box |
| --- | --- |
| "Appearance" | x 28, y 56, **158 × 50** |
| "Switch to dark mode" | x 196, y 60, **43 × 43** |
| "Open Editor" (primary CTA) | x 28, **y 116**, 154 × 57 |

Three rows: wordmark; then Appearance + theme toggle; then the primary CTA alone on row three at
three different heights (50 / 43 / 57) and two baselines. 188 of 844 px — **22 % of the viewport**
spent on chrome before any content, and the CTA is on row three.

Worse, the sticky header then **occludes ~120 px of content permanently while scrolling**:
`mobile-02-hub-grid.png` shows the "Looks" card with its icon tile and top edge sliced off by the
header's lower boundary, with no shadow, fade or border saying "there is more above".

**Minimal fix:** a ≤ 480 px header variant — collapse "Appearance" to its icon, or move both
secondary controls into the Hub's own overflow menu. Add `scroll-padding-top: <header height>` to
`html` and a subtle bottom shadow on the header once `scrollY > 0`.

### H-06 — "Reset all edits" is irreversible, unconfirmed, and styled identically to "Copy edits"
**Shows it:** `desktop-17-more-menu.png`

`EditorTopBar.tsx:81-90`: `label: 'Reset all edits'`, `onSelect: onReset`, `icon: UndoGlyph`, no
confirmation. In the screenshot "Reset all edits", "Copy edits" and "Save preset…" are visually
identical grey rows with identical affordances — same colour, same icon treatment, same position in
the list. There is **zero `confirm()` anywhere in `src/`**.

The app's own onboarding (`Onboarding.tsx:15-18`) tells the user *"Reset all edits puts the photo
back the way the file arrived"*, and the source comment at `EditorTopBar.tsx:85-87` admits it
"throws away the undo history" — i.e. it is **not** undoable. One mis-tap in a seven-item menu loses
every edit **and** the means of recovery, with no warning and nothing to distinguish it from a
routine action.

**Minimal fix:** give the item the danger colour token already used for `tone: 'error'` toasts, and
gate `onReset` behind a confirm dialog when `edits > 0`. Two lines in
`EditorTopBar.tsx` plus a dialog component.
*(Corroborated by journey recon D-04.)*

## Medium

### M-01 — The Export panel's primary action is 1280 px (desktop) / 1489 px (mobile) below the opening view
**Shows it:** `desktop-15-export-panel.png` (opening view) vs `desktop-16-export-download-belowfold.png` (where Download is); `mobile-07-export-sheet.png`

Export sheet body: `scrollHeight 1957` in a `clientHeight` of **677** (desktop) / **468** (mobile).
Opening Export shows FORMAT, Quality, SIZE, DPI. **Download** is at the very bottom, after a
"FILES 1920 px" note, the FILE NAME field, a **six-line** token-syntax paragraph and METADATA —
all of which must be scrolled past, with an invisible overlay scrollbar
(`offsetWidth - clientWidth === 0`) and no sticky footer.

Compounding it, in `desktop-16` the four actions **Download / Share / Copy / Multi-size zip** are
four **identical outline buttons in a 2 × 2 grid** — the primary action carries exactly the visual
weight of the three secondaries, beneath a dense wall of body copy.

**Minimal fix:** add a sticky action footer pinned to the sheet body bottom containing Download, or
hoist Download above FORMAT. Either removes 1280 px of scrolling and restores hierarchy.

### M-02 — The empty state's overflow is invisible: content is sliced at the fold with no scroll cue
**Shows it:** `desktop-04-editor-empty.png`, `mobile-03-editor-empty.png`

At 1280 × 800 the **document does not scroll** (`html.scrollHeight === 800`). Content scrolls inside
`main._editorMain_yb6c0_234` (`scrollHeight 1333`, `clientHeight 748`, `overflow-y: auto`).

So on first load the user sees the hero and the drop zone, and the **"Continue editing?" card is cut
in half at the fold** — its title baseline sits at y 782 with 30 px of the heading below the
viewport. Nothing indicates more exists: no scrollbar, no fade, no chevron.

At 390 px the same screen is worse: `mobile-03` is a **prose wall** — a 6-line hero paragraph plus an
8-line CDN disclaimer — and the drop zone, the only thing a first-time user needs, does not begin
until **y ≈ 605 of 844**.

**Minimal fix:** a bottom fade mask on `_editorMain` whenever `scrollHeight > clientHeight`, and at
≤ 480 px move the CDN disclosure behind the existing "How this editor works" link so the drop zone
lands above the fold.

### M-03 — Destructive "Discard" on the empty state is indistinguishable from a text link
**Shows it:** `desktop-05-editor-empty-scrolled.png`, `mobile-04-editor-empty-samples.png`

Measured on the "Continue editing?" card:

| Button | Background | Border | Radius | Padding | Colour |
| --- | --- | --- | --- | --- | --- |
| **Resume** | `rgb(31,111,92)` filled | none | **12 px** | `12px 22px` | white, 20 px |
| **Discard** | `transparent` | **none** | **0 px** | `0 12px` | `rgb(56,178,140)`, 18.75 px |

`rgb(56,178,140)` is the **same accent green as the "Pexels" credit link** immediately below. So the
control that destroys the photo and edits sits 12 px from a filled primary button, with zero button
chrome, wearing the colour of a footer credit. The card's own copy says *"it goes when you press
Discard"* — and there is no confirm. Worse on mobile, where the tap target is small.

**Minimal fix:** ghost-outline button with the danger tint, and a confirm step — same treatment as H-06.

### M-04 — Sample tiles are 120 px wide with 118 px of copy; 4–7 ragged lines, unequal heights, orphaned on mobile
**Shows it:** `desktop-05-editor-empty-scrolled.png`, `mobile-04-editor-empty-samples.png`

Measured, both viewports:

| Tile | Button width | Body-copy width | Lines | Height |
| --- | --- | --- | --- | --- |
| Sample 1 | **120 px** | **118 px** | **7** | 274 px |
| Sample 2 | 120 px | 118 px | 5 | 274 px |
| Sample 3 | 120 px | 118 px | 4 | **211 px** |

The `<p>` is 118 px inside a 120 px button — **effectively no horizontal padding** — so *"A bright
sky and a shadowed face — try Brightness and Exposure."* wraps to seven lines of two or three words.
Heights are unequal (274 / 274 / **211**) because nothing equalises them.

At 390 px the three tiles stay 120 px inside a 358 px container: two on row one, one **orphaned and
centred** on row two, using 236 of 358 px — **66 % of the available width** (`mobile-04`).

**Accessibility, same tiles:** the accessible name is alt text + visible title + description
concatenated with no separator, and the title appears **twice**:
`"Sample 1 Sample 1 A bright sky and a shadowed face — try Brightness and Exposure."`

**Minimal fix:** give the card `padding: 0 12px` so the copy column is ~96 px, set
`grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`, and rebuild the name with
`aria-labelledby` → title, `aria-describedby` → body, `alt=""` on the `img`.

### M-05 — Drawing is pointer-only: the canvas is not focusable and has no ARIA
**Shows it:** `desktop-19-draw-tool-panel.png`, `desktop-20-draw-controls.png`

The Draw panel's 19 controls are **all** keyboard-reachable — roving `tabindex` on the
Pen/Marker/Highlighter/Neon/Eraser group and on the blend-mode group, two `input[type=range]`, one
`input[type=color]`. But the canvas itself measures:

```
canvas[tabindex]    → null
canvas[role]        → null
canvas[aria-label]  → null
```

So there is **no keyboard way to place a stroke.** The panel's empty state says only *"create one,
then sketch on the canvas"* (`desktop-19`) with no note that a pointer is required. Note also that
"Skip to the canvas" targets `#editor-main`, which is the scroll `<main>` with `tabIndex={-1}` — it
skips to the *region*, not to the canvas, so the link slightly overpromises.

**Minimal fix:** give the canvas `tabIndex={0}`, `role="application"` and an
`aria-label="Drawing canvas"`, and let arrow keys move a caret that Enter drops and
Backspace lifts. Failing full drawing support, add `aria-describedby` text saying drawing needs a
pointer, so the limitation is at least announced.

### M-06 — Panel content is bisected by the tab bar in six separate places
**Shows it:** `desktop-08`, `desktop-12`, `desktop-13`, `desktop-15`, `desktop-20`, `mobile-06`

The sheet body ends at y 729 and the bottom tab bar begins at y 729 with **no padding to clear it**,
so the last row of any overflowing panel is cut in half. Captured at: the **A3** print size
(`desktop-08`), the **CINEMATIC** look row (`desktop-12`), **"US visa"** (`desktop-13`), the
**METADATA** row (`desktop-15`), the **"Hard"** blend mode (`desktop-20`), and the **4 × 6 in** print
row at 390 px (`mobile-06`).

This is the same defect as M-01 and M-02 wearing a different hat: **every scroll container in this app
uses zero-width overlay scrollbars** — sheet body, Appearance body, shortcuts body, mobile tool bar.
Overflow is invisible *everywhere*, which is why so many panels read as "clipped" rather than
"scrollable".

**Minimal fix:** `padding-bottom: <tab-bar height>` on `_sheetBody`, plus a bottom fade mask that
appears only when `scrollTop + clientHeight < scrollHeight`.

### M-07 — The Export SIZE control conflates five different concepts in one unlabelled box
**Shows it:** `desktop-15-export-panel.png`, `mobile-07-export-sheet.png`

One bordered box holds a 2 × 2 grid — row 1 `No resize | Width | Height`, row 2
`Long edge | Percent`. Those are **five different concepts**: one mode toggle, two dimension
fields, and two *unit* choices. There are no dividers, no field labels, and nothing signalling that
"Long edge" and "Percent" are the **unit selector for the Width/Height row above them** rather than a
third row of modes. Nothing in the panel explains what "Long edge" is long *of*.

**Minimal fix:** split into a labelled `Resize` toggle (`Off | Width×Height | Long edge | Percent`)
and two `<input>`s with real `<label>`s that appear only in Width/Height mode. Also wrap the row in
`role="radiogroup"`.

### M-08 — All 24 look thumbnails are visually indistinguishable at chip size
**Shows it:** `desktop-12-looks-panel.png`

Portra, Gold, Ektar, Velvia, Superia, Provia, CineStill 800T, Vista, Polaroid, Warm Cinema, Cool
Cinema and Teal & Orange all render **the same sunset-with-a-red-buoy image**.

**This is not a broken generator.** I verified the files are byte-distinct: **24 files, 24 unique
srcs, 24 distinct SHA-1s, 24 distinct sizes (5157–9796 B)** under `public/look-thumbs/`. The LUT
deltas simply do not survive a 78 px thumbnail of that particular source strip — mostly blue sky and
orange water, where Portra vs Gold vs Ektar is imperceptible.

So the defect is that **the picker cannot do the one job a picker must do**: tell the options apart.
The Hub sells this as *"Twenty-four film looks in four families, each with an amount you can dial."*

**Minimal fix:** render each chip as a live preview of the **loaded** image with that LUT applied,
via the existing `src/gl/luts.ts` path, rather than a static generated strip. Failing that,
regenerate the thumbs from a source strip with strong mid-tone separation (greyscale steps plus
skin tones) and bump chip size above ~96 px.

### M-09 — The collapsed PLATFORM disclosure has no visible marker
**Shows it:** `desktop-09-crop-rotate-flip-belowfold.png`, `mobile-06-crop-sheet.png`

It is a native `<details>`, so it *is* keyboard-operable and the 22 platform presets are reachable —
but the disclosure triangle is suppressed, leaving a **64 px empty band** between
"PLATFORM / 22 sizes" and "PRINT SIZE" with nothing to indicate it expands. It holds **22 presets**
(Instagram, TikTok, LinkedIn, X, Facebook, YouTube, Pinterest across 1:1 / 4:5 / 1.91:1 / 9:16 /
16:9 / 2:3) — a substantial feature with no visual entry point.

**Minimal fix:** restore `summary { list-style: revert }` or add an explicit chevron that rotates on
`[open]`. One CSS rule.

## Low

### L-01 — Primary-action styling is inconsistent across four surfaces
**Shows it:** `desktop-05` (Resume = filled 20 px / 12 px radius), `desktop-06` (Done = bare green
text, no chrome), `desktop-12` ("None" = full-width 325 × 56 bar, unlike every other chip),
`desktop-16` (Download = same outline as Share / Copy / Multi-size zip),
`desktop-09` ("Auto tone" filled, "Reset Exposure" ghost — correct pair).
**Fix:** one rule — the primary action in any surface is a filled accent button; everything else is
ghost or bare.

### L-02 — Radius scale is not one scale
**Shows it:** `desktop-20-draw-controls.png` (chips `999px`; colour swatch `8px` at 50 × 50 with
`appearance: auto`, so its inner swatch paints with square corners inside a rounded frame),
`desktop-05` (Resume `12px`), `desktop-17` (menu items `0`).
**Fix:** pick `--ie-radius-pill` / `--ie-radius-card` / `--ie-radius-control` from
`src/styles/tokens.css` and use only those three.

### L-03 — Ragged flex-wrap packing reads as arbitrary
**Shows it:** `desktop-13-passport-panel.png` (rows of 1, 2, 1, 1, 1, 1 chips),
`desktop-20-draw-controls.png` (blend modes 2, 2, 3, 1 — "Hard" alone on the last row, cut by the
tab bar).
**Fix:** `grid-template-columns: repeat(auto-fill, minmax(<chip min>, 1fr))` so rows are even.

### L-04 — The same word means two different things in two panels
**Shows it:** `desktop-18-retouch-panel.png` reads **"Size 4 %"** ("The diameter of the next heal
spot, as a share of the photo's width"); `desktop-20-draw-controls.png` reads **"Size 2"** — no
unit, a brush index.
**Fix:** rename the Draw one to "Brush size" with a px value.

### L-05 — "TRANSFORM" introduces text saying transform is unavailable, then shows non-transform controls
**Shows it:** `desktop-20-draw-controls.png` — heading "TRANSFORM", body "This layer is placed by
its own size and position, not by the transform.", then Opacity and 8 blend modes.
**Fix:** rename the heading "Appearance" or "Layer".

### L-06 — Focus-ring colour is not one token
**Shows it:** `desktop-07-skiplink-focus.png` — interactive controls use `rgb(56,178,140)` at
`solid 2px`; the skip link uses `rgb(242,242,247)` at `solid 3px`. Two rings, two colours, one page.
**Fix:** one `--ie-focus-ring` token; if the skip link needs more contrast against the accent pill,
vary the *width*, not the hue.

### L-07 — AVIF has no chip, so its absence looks like an oversight
**Shows it:** `desktop-15-export-panel.png` — FORMAT shows JPEG/PNG/WebP/PDF only, with
"AVIF is missing because this browser cannot encode it." beneath. The Hub card promises "plus AVIF
where your browser can encode it".
**Fix:** render a disabled `AVIF` chip with `title`/`aria-disabled` so the row shows the full format
set and the missing one is visibly unavailable rather than absent.

### L-08 — The editor top bar has no wordmark
**Shows it:** `desktop-06-editor-loaded.png`, `mobile-05-editor-loaded.png` — an X, undo, redo, the
document name, `…`, "Done". On the one screen where a user spends their time there is no wordmark
and no indication of which app it is. The empty state is slightly better ("New image") but still
unbranded. Interacts with C-02: the document title is the *only* signal of what is open.
**Fix:** add the 16 px wordmark to the editor top bar at desktop widths, left of the document name.

### L-09 — Panel and dialog scroll positions are sticky and unresettable
**Shows it:** `mobile-08-appearance-panel.png` — Appearance body `scrollHeight 898` in
`clientHeight 664`; MOTION sliced at the viewport edge and **"Icon size" entirely invisible**.
`mobile-09-shortcuts-dialog.png` — 796 px tall in an 844 px viewport, title wrapped to two lines,
diagnostics block cut mid-sentence. Neither resets on reopen, and both have
`offsetWidth - clientWidth === 0`.
**Fix:** same as H-04 — reset on mount — plus the bottom fade from M-06.

## Sheet detents (390 px)

The bottom sheet has a visible **grab handle** (the grey pill centred at y ≈ 293 in `mobile-06`,
y ≈ 293 in `mobile-07`) and a backdrop, and it opens at a fixed detent: sheet top y 285,
bottom y 844 — **559 px of 844 = 66 % of the viewport**. The canvas above it shrinks from 543 px
tall to **204 px** in `mobile-06`, and to **195 px** in `mobile-07`.

Assessment: the detent itself is reasonable and the grab handle is a real affordance. The defect is
the **consequence** — at 66 % sheet, a portrait photo is reduced to a 135 × 204 thumbnail, small
enough that framing a crop against it is guesswork, and the Export sheet at that detent leaves
**1489 px** of content below the fold (M-01). A taller detent for the sheets that need canvas
reference (Crop, Retouch) would help; an explicit third "full" detent would fix it properly.

## Coverage gap in this audit, stated honestly

Background removal was **not** exercised: opening its panel is safe, but using it downloads ≈42 MB
from the imgly CDN, which `AGENTS.md` forbids. **Text, Stickers, Redact and Frame were never
opened at all.** Those four are exactly where drag-only placement and layer-transform handles live,
so **M-05 is likely understated** — its evidence covers Draw only.

---

## Recorded as correct, so they are not "fixed"

- **The skip link works properly.** First in the tab order (measured index 0 of 18 focusables),
  off-screen at `left: -9999`, revealed on focus at `left: 12 / top: 60` — **below** the header so it
  never covers the wordmark — with a high-contrast white ring on a green pill. `desktop-07`.
- **Crop handles are genuinely keyboard-operable.** 8 handles at `role="slider" tabindex="0"` with
  real `aria-label`s (`Crop nw handle`, `Crop s handle`, …) plus the straighten dial. H-03 is a
  **z-order defect laid on top of a working implementation**, not a missing feature.
- **Roving tabindex is used correctly** on the Pen/blend-mode and Heal-spot/Red-eye groups — the
  inactive member at `tabindex="-1"` is the right pattern, not a bug.
- **No horizontal document scroll at 390 px** on either the Hub or the editor
  (`documentElement.scrollWidth === 390`). H-05 is wrapping, not overflow.
- **Canvas framing is correct and symmetric** at 1280 × 800: canvas y 68–713, header ends 52, nav
  starts 729 — 16 px above and 16 px below.
- **Tool-bar tab order is logical** and every tool is labelled: Close editor → More options → Done
  → Compare → Crop … Export, all with a visible `solid 2px` focus ring.
- **Aspect ratio is preserved** — canvas 427 × 645 (0.662) for a 1271 × 1920 (0.662) source.
- **The 24 look thumbnails are genuinely distinct files** and "None" is correctly marked current.
- **The Retouch panel is the best-designed surface in the app** — labelled sliders with `%` readouts,
  per-control copy that states what 0 means, and a live preview with the heal circle drawn on the
  face. `desktop-18`.
