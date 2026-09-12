import type { ReactNode } from 'react';
import { BottomSheet } from '../controls/BottomSheet';
import { useUiStore, type ToolId } from '../../store/uiStore';
import { AdjustPanel } from '../tools/AdjustPanel';
import { BackgroundPanel } from '../tools/BackgroundPanel';
import { CropPanel } from '../tools/CropPanel';
import { ExportSheet } from '../tools/ExportSheet';
import { FiltersPanel } from '../tools/FiltersPanel';
import { DrawPanel, FramePanel, LayersPanel, RedactPanel, StickersPanel, TextPanel } from '../tools/LayerPanels';
import { PassportPanel } from '../tools/PassportPanel';
import { PlaceholderPanel } from '../tools/PlaceholderPanel';

const TITLES: Record<ToolId, string> = {
  crop: 'Crop & Straighten',
  adjust: 'Adjust',
  filters: 'Filters',
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
};

const DESCRIPTIONS: Partial<Record<ToolId, string>> = {
  retouch: 'Skin smoothing, blemish healing and red-eye removal arrive with the portrait tools.',
  background: 'Remove and replace the background with a real subject matte.',
  text: 'Add text layers with self-hosted fonts, stroke, shadow and arc.',
  draw: 'Pressure-aware pen, marker, highlighter and neon brushes.',
  stickers: 'Built-in sticker set plus your own uploads.',
  redact: 'Pixelate, blur or cover regions — baked into the exported pixels.',
  frame: 'Solid, inset, polaroid, film, rounded and shadow-card frames.',
  layers: 'Reorder, rename and blend layers.',
  passport: 'Passport photo framing and compliance tools.',
};

export function ToolSurface({
  source,
  fileName,
  onAuto,
}: {
  source: ImageBitmap | null;
  fileName: string;
  onAuto: () => void;
}) {
  const activeTool = useUiStore((state) => state.activeTool);
  const detent = useUiStore((state) => state.sheetDetent);
  const setDetent = useUiStore((state) => state.setSheetDetent);
  const setActiveTool = useUiStore((state) => state.setActiveTool);

  if (!activeTool) return null;

  let panel: ReactNode;
  switch (activeTool) {
    case 'crop':
      panel = <CropPanel />;
      break;
    case 'adjust':
      panel = <AdjustPanel source={source} onAuto={onAuto} />;
      break;
    case 'filters':
      panel = <FiltersPanel />;
      break;
    case 'background':
      panel = <BackgroundPanel source={source} />;
      break;
    case 'text':
      panel = <TextPanel />;
      break;
    case 'draw':
      panel = <DrawPanel />;
      break;
    case 'stickers':
      panel = <StickersPanel />;
      break;
    case 'redact':
      panel = <RedactPanel />;
      break;
    case 'frame':
      panel = <FramePanel />;
      break;
    case 'layers':
      panel = <LayersPanel />;
      break;
    case 'passport':
      panel = <PassportPanel source={source} />;
      break;
    case 'export':
      panel = <ExportSheet source={source} fileName={fileName} />;
      break;
    default:
      panel = (
        <PlaceholderPanel description={DESCRIPTIONS[activeTool] ?? 'Coming soon.'} />
      );
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
  );
}
