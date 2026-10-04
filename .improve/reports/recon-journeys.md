# Recon — user journeys, dead ends and loopholes

Agent was read-only and could not write; condensed by the orchestrator from its board report.
**This is the highest-priority report in the loop** — the operator named this class of defect first.

**32 journeys** mapped across the Hub, import screen, 13 tools, export, persistence, crash and
offline paths. **19 dead ends: 4 critical, 5 high, 7 medium, 3 low.** **12 journeys have no e2e spec.**

## The single most user-hostile gap

**D-01 CRITICAL — There is no way to open a DIFFERENT image.** This confirms the operator's example.

- `src/pages/Editor.tsx:482` unmounts `ImportScreen` permanently once `source` exists.
- The top bar holds only Close / Undo / Redo / More / Done (`EditorTopBar.tsx:116-175`).
- "Close editor" (`EditorTopBar.tsx:120` -> `Editor.tsx:522`) merely routes to `/`.
- `useDocStore` is a **module singleton** (`docStore.ts:80`), so the Hub's "Start editing"
  (`Hub.tsx:165`), "Open Editor" (`Nav.tsx:42`) and every tool card **reopen the same image**.
- The only exit is a **full browser reload**, then Resume or Discard.

Suggested fix: a More-menu "New image" (clear doc + `clearSession` + `clearMirror`), confirmed when
the doc has edits.

## Full dead-end list

| ID | Sev | Defect | Evidence |
|---|---|---|---|
| D-01 | CRITICAL | No way to open a different image | `Editor.tsx:482`, `EditorTopBar.tsx:116-175`, `docStore.ts:80` |
| D-02 | CRITICAL | "Done" is a silent no-op whenever a tool panel is open. `openExport = if (!activeTool) setActiveTool('export')` — open Crop, tap Done, nothing happens. `ToolTabBar.tsx:79-86` already decided tabs are not toggles, so the guard is wrong | `Editor.tsx:468-470`, `EditorTopBar.tsx:171` |
| D-03 | HIGH | "Reset all edits" does not put the photo back: `cloneSource` is kept, so a background-removal cut-out (which rewrites `doc.source`) survives. Contradicts onboarding | `docStore.ts:144-166`, `BackgroundPanel.tsx:67-77`, `Onboarding.tsx:15-18` |
| D-04 | HIGH | **Zero `confirm()` in all of `src/`.** Irreversible+unconfirmed: "Discard" (`ResumeSessionCard.tsx:57` -> `Editor.tsx:340-347`), "Start over — deletes your photo and edits" (`RouteError.tsx:34-54`), "Delete preset" (`PresetPopover.tsx:141` -> `Editor.tsx:453-460`). Undoable but unconfirmed: "Reset all edits", "Clear" strokes (`LayerPanels.tsx:1179`), "Delete layer", "Remove frame" | see cells |
| D-05 | HIGH | Preset delete is irreversible and the only feedback is a 3.2 s toast — `Editor.tsx:457` uses tone `'info'` while `uiStore.ts:269-272` persists only `'error'` | `Editor.tsx:457`, `uiStore.ts:269-272` |
| D-06 | MED | Tool shortcuts are live on the import screen and leak forward: `useKeyboardShortcuts` is mounted unconditionally. Press `a` there, then click a sample — Adjust opens with no cause | `Editor.tsx:462-466` |
| D-07 | MED | Import screen has no appearance/theme/help control, and the orientation-tour trigger lives only inside `ImportScreen`, unreachable once an image is loaded | `Editor.tsx:484-490`, `ImportScreen.tsx:124` |
| D-08 | MED | "Auto tone" self-describes only in a `title` attribute — unreachable on touch | `AdjustPanel.tsx:122` |
| D-09 | MED | Layer-row controls are raw Unicode glyphs; the "drawn, not merely named" gate covers only the swap glyph | `LayerPanels.tsx:1298,1301,1304,1307,1330,1333`, `journey.crop-shapes.spec.ts:83` |
| D-10 | MED | The Compare toggle **changes its own accessible name** when toggled — WCAG 3.2.4 (Label in Name) violation | `EditorCanvas.tsx:242-250` |
| D-11 | MED | A passport Document chip silently rewrites crop, output resize and background — three settings changed with no announcement | `PassportPanel.tsx:563-580` |
| D-12 | MED | Sample tiles stay enabled while offline although `describeOffline()` says they need a connection; clicking yields "Could not load that sample image." | `network.ts:29-34`, `Editor.tsx:289` |
| D-13 | LOW | Double-click-to-fit is undocumented; "Photo details" is a vanishing info toast; there is no "saved" indicator | `EditorCanvas.tsx:238`, `EditorTopBar.tsx:112`, `Editor.tsx:113-118` |

## Journeys with NO e2e coverage (12)

hub re-entry · changing image · "Done" · "Reset all edits" · preset apply/delete · Copy/Paste edits ·
Compare · double-click-to-fit · drag-drop import · paste import · "Photo details" · offline banner.

Every one of these is a place a regression ships silently. Note that **11 of the 12 are exactly the
dead-end and reversal paths above** — the untested set and the loophole set are the same set.