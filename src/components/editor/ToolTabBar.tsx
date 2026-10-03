import {
  AdjustToolGlyph,
  BackgroundToolGlyph,
  CropToolGlyph,
  DrawToolGlyph,
  ExportToolGlyph,
  FilterToolGlyph,
  FrameToolGlyph,
  LayersToolGlyph,
  PassportToolGlyph,
  RedactToolGlyph,
  RetouchToolGlyph,
  StickerToolGlyph,
  TextToolGlyph,
  type IconComponent,
} from '../ui/icons'
import { TOOL_IDS, useUiStore, type ToolId } from '../../store/uiStore'
import styles from './editor.module.css'

type Glyph = IconComponent

/**
 * The thirteen tabs, in `TOOL_IDS` order.
 *
 * Every label is the full word. "BG" was the only abbreviation here and the only
 * one in the product — its own panel is titled "Background", the shortcut help
 * says "Background", and the export panel has a *different* control called
 * "Background behind transparency". One surface, three names, and the shortest
 * one was the one a user had to remember. The bar scrolls horizontally
 * (`overflow-x: auto`, `white-space: nowrap`), so the extra nine pixels cost a
 * little scroll and buy a tab whose label matches the sheet it opens.
 *
 * "Stickers" stays plural: the panel is a library of sticker types you pick one
 * from, not one sticker, and every other entry names the panel's subject rather
 * than a count. "Retouch" used to stay for the opposite reason — it opened a
 * placeholder that said "Not built yet" in its first line, and the argument was
 * that a tab which admits it is inert is not asserting anything. It now writes
 * `doc.retouch`, so it is a peer of the rest and is named like them.
 *
 * "Looks" replaces "Filters", which is the decision `src/lib/copy.ts` records:
 * the orientation panel teaches the word — "Looks are settings, not filters" —
 * and then the tab, the sheet title and the shortcut table all said Filters over
 * a panel whose own first heading says LOOKS. A term the product has explained
 * and then not used is worse than one it has never mentioned. The `ToolId` and
 * the `FiltersPanel` component keep their names: that is code, and the LUT
 * catalogue in the GL backend is keyed by it.
 */
const META: Record<ToolId, { label: string; Glyph: Glyph }> = {
  crop: { label: 'Crop', Glyph: CropToolGlyph },
  adjust: { label: 'Adjust', Glyph: AdjustToolGlyph },
  filters: { label: 'Looks', Glyph: FilterToolGlyph },
  retouch: { label: 'Retouch', Glyph: RetouchToolGlyph },
  background: { label: 'Background', Glyph: BackgroundToolGlyph },
  text: { label: 'Text', Glyph: TextToolGlyph },
  draw: { label: 'Draw', Glyph: DrawToolGlyph },
  stickers: { label: 'Stickers', Glyph: StickerToolGlyph },
  redact: { label: 'Redact', Glyph: RedactToolGlyph },
  frame: { label: 'Frame', Glyph: FrameToolGlyph },
  layers: { label: 'Layers', Glyph: LayersToolGlyph },
  passport: { label: 'Passport', Glyph: PassportToolGlyph },
  export: { label: 'Export', Glyph: ExportToolGlyph },
}

export function ToolTabBar() {
  const activeTool = useUiStore((state) => state.activeTool)
  const setActiveTool = useUiStore((state) => state.setActiveTool)

  return (
    <nav className={styles.tabBar} aria-label="Editor tools">
      {TOOL_IDS.map((tool) => {
        const { label, Glyph } = META[tool]
        const active = activeTool === tool
        return (
          <button
            key={tool}
            type="button"
            className={`${styles.tab}${active ? ` ${styles.tabActive}` : ''}`}
            aria-current={active ? 'true' : undefined}
            // A tab opens a tool; it is not a toggle. This used to read
            // `active ? null : tool`, so a second tap on the open tool closed
            // its panel and dropped `aria-current` — after which the tab no
            // longer said which tool was open, and a user who opened Export to
            // change the format and tapped again to reach Download lost the
            // panel. Closing is the sheet's Close button, the backdrop, and
            // Escape.
            onClick={() => setActiveTool(tool)}
          >
            <Glyph />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
