import type { ReactNode } from 'react'
import { BottomSheet } from '../controls/BottomSheet'
import { useUiStore, type ToolId } from '../../store/uiStore'
import { AdjustPanel } from '../tools/AdjustPanel'
import { BackgroundPanel } from '../tools/BackgroundPanel'
import { CropPanel } from '../tools/CropPanel'
import { ExportSheet } from '../tools/ExportSheet'
import { FiltersPanel } from '../tools/FiltersPanel'
import {
  DrawPanel,
  FramePanel,
  LayersPanel,
  RedactPanel,
  StickersPanel,
  TextPanel,
} from '../tools/LayerPanels'
import { PassportPanel } from '../tools/PassportPanel'
import { RetouchPanel } from '../tools/RetouchPanel'
import { EmptyState } from '../ui/EmptyState'

/**
 * The sheet title, audited against the panel it actually opens.
 *
 * Only one of these is not the tab's own name: "Crop & Straighten" is, because
 * that panel ships a `StraightenDial` next to the crop box, and the shorter tab
 * name would leave the control unnamed on the way in. "Background" is the other
 * end of the same fix — it used to read "BG" on the tab, so the sheet renamed
 * the thing the tab had abbreviated.
 *
 * The Looks title is the tab's name for the same reason the tab's name is the
 * tab's name: the sheet is the panel, and a sheet called "Filters" over a
 * heading called "LOOKS" asks the user to hold two names for one thing.
 */
const TITLES: Record<ToolId, string> = {
  crop: 'Crop & Straighten',
  adjust: 'Adjust',
  filters: 'Looks',
  retouch: 'Retouch',
  background: 'Background',
  text: 'Text',
  draw: 'Draw',
  stickers: 'Stickers',
  redact: 'Redact',
  frame: 'Frame',
  layers: 'Layers',
  passport: 'Passport',
  export: 'Export',
}

/**
 * The empty state a tool falls through to when it has no panel.
 *
 * Shown by `EmptyState` for a tool that has no panel yet. Every string here is a
 * claim about what ships, so none of them may promise a control that does not
 * exist. A feature that is genuinely absent is named as absent rather than
 * described in the present tense.
 *
 * The table is empty, and it was not always: `retouch` carried a paragraph here
 * saying the pass was in the pipeline and no control wrote to it — true in both
 * halves, and it still shipped a tab that looked like a peer of Crop. The panel
 * now writes the fields, so the entry went with it. A tool only earns an entry
 * the day it loses its panel, and `ToolSurface.test.tsx` asserts that: a
 * `\n  <tool>:` line for a tool with a panel is a failure, not a tidiness issue.
 */
type ToolEmpty = { title: string; description: string }

const DESCRIPTIONS: Partial<Record<ToolId, ToolEmpty>> = {}

export function ToolSurface({
  source,
  fileName,
  onAuto,
}: {
  source: ImageBitmap | null
  fileName: string
  onAuto: () => void
}) {
  const activeTool = useUiStore((state) => state.activeTool)
  const detent = useUiStore((state) => state.sheetDetent)
  const setDetent = useUiStore((state) => state.setSheetDetent)
  const setActiveTool = useUiStore((state) => state.setActiveTool)

  if (!activeTool) return null

  let panel: ReactNode
  switch (activeTool) {
    case 'crop':
      panel = <CropPanel />
      break
    case 'adjust':
      panel = <AdjustPanel source={source} onAuto={onAuto} />
      break
    case 'filters':
      panel = <FiltersPanel />
      break
    case 'retouch':
      panel = <RetouchPanel source={source} />
      break
    case 'background':
      panel = <BackgroundPanel source={source} />
      break
    case 'text':
      panel = <TextPanel />
      break
    case 'draw':
      panel = <DrawPanel />
      break
    case 'stickers':
      panel = <StickersPanel />
      break
    case 'redact':
      panel = <RedactPanel />
      break
    case 'frame':
      panel = <FramePanel />
      break
    case 'layers':
      panel = <LayersPanel />
      break
    case 'passport':
      panel = <PassportPanel source={source} />
      break
    case 'export':
      panel = <ExportSheet source={source} fileName={fileName} />
      break
    default:
      // The fallback is a claim too, so it is the weakest one that is still
      // true: we know there is no panel, and we do not know when one is coming.
      // "Coming soon." used to be here, which promised a schedule nobody in this
      // file can keep.
      panel = <EmptyState {...placeholderFor(activeTool)} />
  }

  return (
    <BottomSheet
      open
      detent={detent}
      onDetent={setDetent}
      onClose={() => setActiveTool(null)}
      title={TITLES[activeTool]}
    >
      {panel}
    </BottomSheet>
  )
}

function placeholderFor(tool: ToolId): ToolEmpty {
  return (
    DESCRIPTIONS[tool] ?? {
      title: 'No panel for this tool yet',
      description: 'Nothing here changes the photo. The other tools still work.',
    }
  )
}
