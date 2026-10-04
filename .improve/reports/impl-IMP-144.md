# IMP-144 — Capture a second baseline set at default appearance

**Agent:** implementer
**Date:** 2026-10-04
**Branch / commit:** `improve/auto-20261004` @ `7c30292`, working tree clean
**Changes to product code:** none. This item touches no `src/`, no `e2/`, no `scripts/`.

## What was delivered

| Path | What |
| --- | --- |
| `.improve/artifacts/baseline-default/` | **30 new PNGs** — the same 21 desktop + 9 mobile states, at 1280 × 800 and 390 × 844, at **default appearance** |
| `.improve/artifacts/baseline-default/README.md` | per-shot viewport and scroll, the six settings, every measured magnitude, and the two non-appearance differences |
| `.improve/artifacts/baseline/README.md` | **added, nothing else touched** — labels the existing set and records its six settings |
| `.improve/REPO_PROFILE.md` § 11 (and a pointer in § 5.4) | the **committed** record, because `.improve/artifacts/` is git-excluded |

The existing 30 PNGs in `baseline/` were **not** overwritten, renamed or deleted. Verified:
`ls baseline/*.png | wc -l` = 30, and every file's mtime is still 2026-10-03 20:27–20:44.

---

## 1. How the appearance was set to defaults

The six settings live in one `localStorage` key (`APPEARANCE_STORAGE_KEY =
'image-editor-appearance'`, `src/lib/appearance.ts:26`) and are applied pre-paint by the
generated script in `index.html`. So:

```js
localStorage.removeItem('image-editor-appearance')
localStorage.removeItem('image-editor-theme')   // the legacy key
// then a hard reload
```

followed by a full page load so the pre-paint bootstrap script re-read storage before the
first paint. The legacy `image-editor-theme` key had to go too: with no
`image-editor-appearance` payload present, `readAppearance()` falls through to
`migrateLegacyTheme()` (`src/lib/appearance.ts:332-339, 366-378`), which would have
silently promoted `theme` to a stale `light`/`dark` from that key. It was `null` here, but
removing it removes the possibility rather than relying on that.

**What the profile held before the change** — read, not assumed:

```
localStorage['image-editor-appearance'] = {"density":"roomy","textScale":"xlarge"}
localStorage['image-editor-theme']      = null
<html> attributes                        = lang=en data-density=roomy data-text=xlarge
```

That is the defect, caught in the act. `coerceAppearance()` fills the four absent keys
from `DEFAULT_APPEARANCE`, so the six effective values were `theme: system`,
`density: roomy`, `textScale: xlarge`, `motion: full`, `iconScale: default`,
`accent: green`. Only two data-attributes were present because
`appearanceAttributes()` omits defaults.

## 2. How it was verified to be the real defaults

The instruction was to read `src/lib/appearance.ts` rather than assume, so the values came
from `DEFAULT_APPEARANCE` at `src/lib/appearance.ts:58-65`. Four independent checks, all
after the reset and before the first capture:

1. **`readAppearance()` deep-equals `DEFAULT_APPEARANCE`**, both imported live from
   `/Image-editor/src/lib/appearance.ts` inside the page:
   ```
   readAppearance()            → {theme:"system", density:"default", textScale:"default",
                                  motion:"full", iconScale:"default", accent:"green"}
   DEFAULT_APPEARANCE          → identical
   appearanceAttributes(DEFAULTS) → {}
   ```
2. **No appearance attributes on `<html>`.** `[]` — and that is the *correct* encoding of
   "at defaults", not a missing setting (§4 below).
3. **The UI, radio by radio.** The Appearance dialog at 1280 × 800 showed every group on
   its default: Theme **Match system ✓** · Accent **Evergreen ✓** · Density **Default ✓**
   · Text size **Default ✓** · Motion **Animations on ✓** · Icon size **Default ✓**.
4. **The app's own assertion.** `Reset to defaults` is `disabled={isDefault(settings)}`
   (`src/components/ui/AppearanceMenu.tsx:518`) and rendered **disabled**. It is
   **enabled** in `baseline/mobile-08-appearance-panel.png`. That check needs no tooling at
   all and is the one to teach a verifier.

Re-checked **after all 30 captures**: `localStorage` still `null`, `<html>` still `[]`,
`readAppearance()` still equal to the defaults. Nothing in the app wrote appearance during
the session, so the defaults held for every frame in both sets of navigation.

`prefers-color-scheme: dark` was `false`, so `theme: system` resolved to **light**.
`devicePixelRatio` was **1** at both viewports.

## 3. Every state captured

All 30, with the same filenames as set A. Full scroll/provenance tables are in
`artifacts/baseline-default/README.md`; the summary:

**Desktop, 1280 × 800** — `desktop-01-hub-hero` (fullPage, 1280 × 1699) · `-02-hub-tools-grid`
(scrollY 899 = page bottom) · `-03-hub-grid-full` (scrollY 731) · `-04-editor-empty`
(`main` scrollTop 0) · `-05-editor-empty-scrolled` (`main` 309 = max) · `-06-editor-loaded`
· `-07-skiplink-focus` · `-08-crop-panel` (sheet scrollTop 0) ·
`-09-crop-rotate-flip-belowfold` (sheet 117 = max) · `-10-crop-readout-occludes-handle`
(same + `Crop s handle` keyboard-focused) · `-11-adjust-panel` (carried scrollTop 91) ·
`-12-looks-panel` (scrollTop 0, 24/24 thumbnails decoded) · `-13-passport-panel` ·
`-14-layers-empty` · `-15-export-panel` (scrollTop 0) · `-16-export-download-belowfold`
(scrollTop 895 = max) · `-17-more-menu` · `-18-retouch-panel` · `-19-draw-tool-panel` ·
`-20-draw-controls` (19 controls) · `-21-done-noop-with-panel-open`.

**Mobile, 390 × 844** — `mobile-01-hub-hero` (fullPage, 390 × 2934) · `-02-hub-grid`
(scrollY 1159) · `-03-editor-empty` · `-04-editor-empty-samples` (`main` 559 = max) ·
`-05-editor-loaded` · `-06-crop-sheet` · `-07-export-sheet` · `-08-appearance-panel` ·
`-09-shortcuts-dialog`.

Pixel dimensions match set A file-for-file (21 × 1280 × 800, plus the two `fullPage`
shots at 1280 × 1699 / 390 × 2934, and 9 × 390 × 844).

**29 of the 30 captures were opened with the `read` tool and inspected** — every one except
`desktop-21`, which is md5-identical to `desktop-20` (verified below) and therefore the
same frame. Two captures were genuinely wrong on the first attempt and were redone *and
re-inspected*:

- **`desktop-04` (first attempt)** showed a persisted *Recent problems* panel
  ("Kept after a reload… 10-04 02:34 Could not save this session") sitting over the page
  heading, left over from an earlier failed session in this browser profile. It is a real,
  appearance-independent overlay (`src/components/controls/Toast.tsx:35-58`) but it is not
  part of the state set A captured, so I clicked its own **Delete these** button — a user
  action — and re-shot. See §6.
- **`mobile-03` (first attempt)** showed the resume card reading `1 edit · saved 3 minutes
  ago`, because the desktop pass had created a drawing layer. Set A reads `0 edits · saved
  just now`. I deleted the `image-editor` IndexedDB database and the `image-editor:doc-mirror`
  key, reloaded, re-loaded Sample 1 fresh, and re-shot. The replacement was re-opened and
  confirms `1271 × 1920 · 0 edits · saved just now`, exactly as set A does.

## 4. Two states that could not be reproduced byte-for-byte, and why

Both are honest limitations of "the same states" and neither is an appearance effect.

**a) Hub tool-card reveal.** `desktop-01` and `mobile-01` show **3** and **1** tool cards;
set A shows **0** in both. The Hub starts every card at `opacity: 0; transform:
translateY(16px)` and only the `.reveal` IntersectionObserver reveals it
(`src/pages/Hub.tsx:124-142` — IMP-043, still `TODO`). `page.screenshot({ fullPage: true })`
does not scroll the page, so cards outside the initial threshold never intersect before the
frame is taken. Which cards have been revealed by screenshot time is a **race**, and at
defaults the page is 254 px shorter, so fewer cards are inside the threshold in the time
available. Recorded rather than hidden — a verifier comparing `desktop-01` across the sets
needs to know this is the observer and not a regression. Everything else was captured after
an explicit scroll or interaction, so it is deterministic.

**b) The two sets are not appearance-only different.** Set A was captured at `aea8523`;
this set at `7c30292`. Two fixes landed in between and both change pixels:

- **`b957f90` (IMP-041)** moved the crop readout out of the crop frame. In set A,
  `desktop-09` and `desktop-10` are **byte-identical** (md5 `3f7850892c74ad653676cc3687c5ee09`)
  — that identity *was* the H-03 finding: the bottom crop handle's focus ring was entirely
  hidden behind the readout. Here they **differ**
  (`e311318d…` vs `3180d80c…`), the readout sits below the frame at y ≈ 713, and the
  keyboard-focused handle shows `outline: rgb(56,178,140) solid 3px`,
  `outline-offset: −3px`, `:focus-visible` true, at 446 × 661.6.
  **This is exactly the class of regression IMP-144 was raised for** — IMP-141's 2.4 px
  wrap doubling the readout to 83 px exists only at `textScale: xlarge`.
- **`cb3e7ef` (IMP-042)** fixed the 390 px tool bar, so set A's `mobile-05` shows
  "Background" clipped mid-word and this set's shows it whole.

`desktop-20`/`desktop-21` are byte-identical in **both** sets (set A `fee649a7…`, this set
`2d203c5e…`), so the "Done is a silent no-op with a panel open" defect (C-01 / D-02)
reproduces unchanged at defaults.

## 5. Console

**Zero errors, one warning**, on a fresh load for every navigation and every panel switch
across the whole session. The warning is the pre-existing, benign one set A also recorded:

```
React Router Future Flag Warning: React Router will begin wrapping state updates in
React.startTransition in v7. You can use the `v7_startTransition` future flag to opt-in early.
  @ node_modules/.vite/deps/react-router-dom.js:3614
```

`browser_console_messages({all: true})` also returns ~20 **older** errors — "Rendered more
hooks than during the previous render", "Should have a queue", "Cannot read properties of
null (reading 'getSnapshot')", "Objects are not valid as a React child", "Failed to fetch
dynamically imported module". Every one carries an HMR timestamp from **~17 hours before**
this capture (`?t=1791025550602`, `?t=1791027670354`, `?t=1791033277390`, …) and belongs to
a previous browser session in this profile, during which other agents were editing `src/`.
None occurred during these 30 captures, and no captured frame is degraded. This is the
artefact class `REPO_PROFILE.md` § 5.4 warns about.

## 6. Incidental observation, not fixed (no product code was touched)

`Toast.tsx:35-58` renders the persisted error log as a `role="region"` labelled *Recent
problems* that **survives reloads** and, on the editor empty state, covered the page `h1`
and part of the intro prose. It is not in any e2e spec and it is not in set A. It is
appearance-independent and it is a user-dismissible control, so it is a capture hazard
rather than a defect I am claiming — but a baseline capture pass will hit it again on any
profile that has a stored error. Recorded here rather than in
`discovered-IMP-144.md`, because it is not a source defect: the panel is doing what it was
written to do.

## 7. Gates

No product code changed, so no gate was re-run beyond what the capture required.
`npx prettier --check .` is not affected: `.improve/` is in `.prettierignore` (line 18),
which is why this report and the `REPO_PROFILE.md` section are format-exempt. Nothing was
committed — the whole change is in the working tree. `git status --porcelain` shows exactly
two entries and neither is product code:

```
 M .improve/REPO_PROFILE.md
?? .improve/reports/impl-IMP-144.md
```

The two `artifacts/*/README.md` files do not appear at all: `.improve/artifacts/` is in
`.git/info/exclude`, which is exactly why §11 of `REPO_PROFILE.md` had to carry the
committed record.

## 8. How a verifier tells the two sets apart, in one step

Open `mobile-08-appearance-panel.png` in each directory. Set A shows **Roomy ✓** and
**Extra large ✓** with **Reset to defaults enabled**; set B shows **Default ✓** and
**Default ✓** with **Reset to defaults disabled**. The setting is rendered inside the
artefact, so no `localStorage` archaeology and no trust in a README is required.

The programmatic equivalent, for a verifier who wants a number rather than an eye:

```js
// in the page, after a hard reload
JSON.stringify((await import('/Image-editor/src/lib/appearance.ts')).readAppearance())
  === JSON.stringify((await import('/Image-editor/src/lib/appearance.ts')).DEFAULT_APPEARANCE)
```

At defaults this is `true` and **all six data-attributes are absent from `<html>`** —
which is the correct encoding of "at defaults" (`appearanceAttributes()`,
`src/lib/appearance.ts:438-461`, omits defaults so the OS-preference
`:root:not([data-theme])` branch in `tokens.css` keeps working). Set A would show
`data-density="roomy"` and `data-text="xlarge"` and the comparison would be `false`.
**Do not read "no `data-density` attribute" as "density was not set."**
