import { CropIcon } from '../ui/icons';
import {
  AdjustGlyph,
  BackgroundGlyph,
  DrawGlyph,
  ExportGlyph,
  FilterGlyph,
  FrameGlyph,
  LayersGlyph,
  PassportGlyph,
  RedactGlyph,
  RetouchGlyph,
  StickerGlyph,
  TextGlyph,
} from '../ui/editorIcons';
import { TOOL_IDS, useUiStore, type ToolId } from '../../store/uiStore';
import styles from './editor.module.css';

const META: Record<ToolId, { label: string; Glyph: (props: { className?: string }) => JSX.Element }> = {
  crop: { label: 'Crop', Glyph: CropIcon },
  adjust: { label: 'Adjust', Glyph: AdjustGlyph },
  filters: { label: 'Filters', Glyph: FilterGlyph },
  retouch: { label: 'Retouch', Glyph: RetouchGlyph },
  background: { label: 'BG', Glyph: BackgroundGlyph },
  text: { label: 'Text', Glyph: TextGlyph },
  draw: { label: 'Draw', Glyph: DrawGlyph },
  stickers: { label: 'Stickers', Glyph: StickerGlyph },
  redact: { label: 'Redact', Glyph: RedactGlyph },
  frame: { label: 'Frame', Glyph: FrameGlyph },
  layers: { label: 'Layers', Glyph: LayersGlyph },
  passport: { label: 'Passport', Glyph: PassportGlyph },
  export: { label: 'Export', Glyph: ExportGlyph },
};

export function ToolTabBar() {
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);

  return (
    <nav className={styles.tabBar} aria-label="Editor tools">
      {TOOL_IDS.map((tool) => {
        const { label, Glyph } = META[tool];
        const active = activeTool === tool;
        return (
          <button
            key={tool}
            type="button"
            className={`${styles.tab}${active ? ` ${styles.tabActive}` : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => setActiveTool(active ? null : tool)}
          >
            <Glyph />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
