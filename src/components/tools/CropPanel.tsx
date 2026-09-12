import { ChipRow } from '../controls/ChipRow';
import { StraightenDial } from '../controls/StraightenDial';
import { IconButton } from '../controls/IconButton';
import { FlipHorizontalGlyph, GridGlyph, RedoGlyph, UndoGlyph } from '../ui/editorIcons';
import { ASPECT_PRESETS, PLATFORM_GROUPS, PRINT_SIZES } from '../../lib/crop/presets';
import { constrainToAspect, largestInscribedRect } from '../../lib/crop/geometry';
import { rotateBy, setAspectLock, setCrop, setOutput, setStraighten, toggleFlipH } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { useUiStore, type SafeAreaPreset } from '../../store/uiStore';
import styles from './tools.module.css';

const FULL = { x: 0, y: 0, width: 1, height: 1 };

function safeAreaFor(id: string): SafeAreaPreset {
  if (/story/i.test(id)) return 'story';
  if (/reel|tiktok/i.test(id)) return 'reel';
  if (/youtube/i.test(id)) return 'youtube';
  return 'none';
}

export function CropPanel() {
  const doc = useDocStore((state) => state.present);
  const aspectLock = doc.geometry.aspectLock;
  const setSafeArea = useUiStore((state) => state.setSafeArea);

  const applyAspect = (aspect: number | null, presetId = '') => {
    setAspectLock(aspect);
    setCrop(aspect ? constrainToAspect(FULL, aspect) : FULL);
    setSafeArea(safeAreaFor(presetId));
  };

  const platformOptions = PLATFORM_GROUPS.flatMap((group) =>
    group.presets.map((preset) => ({
      value: `${group.id}:${preset.id}`,
      label: `${preset.label}`,
      aspect: preset.aspect,
      id: preset.id,
    })),
  );

  const ratios = ASPECT_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
    aspect: preset.aspect,
  }));
  const activeRatio = ASPECT_PRESETS.find(
    (preset) => preset.aspect !== null && Math.abs((preset.aspect ?? 0) - (aspectLock ?? -1)) < 1e-6,
  );

  return (
    <div>
      <p className={styles.sectionTitle}>Aspect ratio</p>
      <ChipRow
        ariaLabel="Aspect ratio presets"
        options={ratios}
        value={activeRatio?.id ?? (aspectLock === null ? 'free' : null)}
        onChange={(id) => {
          const preset = ASPECT_PRESETS.find((candidate) => candidate.id === id);
          applyAspect(preset?.aspect ?? null, id);
        }}
      />

      <p className={styles.sectionTitle}>Platform</p>
      <ChipRow
        ariaLabel="Platform presets"
        options={platformOptions}
        value={null}
        onChange={(value) => {
          const option = platformOptions.find((candidate) => candidate.value === value);
          if (option) applyAspect(option.aspect, option.id);
        }}
      />

      <p className={styles.sectionTitle}>Print size</p>
      <ChipRow
        ariaLabel="Print sizes"
        options={PRINT_SIZES.map((size) => ({ value: size.id, label: size.label }))}
        value={null}
        onChange={(id) => {
          const size = PRINT_SIZES.find((candidate) => candidate.id === id);
          if (!size) return;
          const dpi = doc.output.dpi;
          setOutput({ resize: { mode: 'physical', widthMm: size.widthMm, heightMm: size.heightMm, dpi } });
          applyAspect(size.widthMm / size.heightMm, id);
        }}
      />

      <div className={styles.straightenHead}>
        <StraightenDial
          value={doc.geometry.straighten}
          onChange={setStraighten}
          onInteractionStart={() => useDocStore.getState().beginInteraction('straighten')}
          onInteractionEnd={() => useDocStore.getState().endInteraction()}
        />
      </div>

      <div className={styles.buttonRow}>
        <IconButton label="Rotate left" onClick={() => rotateBy(-90)}>
          <UndoGlyph />
        </IconButton>
        <IconButton label="Rotate right" onClick={() => rotateBy(90)}>
          <RedoGlyph />
        </IconButton>
        <IconButton label="Flip horizontally" onClick={toggleFlipH}>
          <FlipHorizontalGlyph />
        </IconButton>
        <IconButton
          label="Fill frame after straighten"
          onClick={() => {
            const sw = doc.source?.width ?? 1;
            const sh = doc.source?.height ?? 1;
            const aspect = aspectLock ?? sw / sh;
            const size = largestInscribedRect(sw, sh, doc.geometry.straighten, aspect);
            if (size.width <= 0 || size.height <= 0) return;
            setCrop({
              x: Math.max(0, 0.5 - size.width / (2 * sw)),
              y: Math.max(0, 0.5 - size.height / (2 * sh)),
              width: Math.min(1, size.width / sw),
              height: Math.min(1, size.height / sh),
            });
          }}
        >
          <GridGlyph />
        </IconButton>
      </div>

      <p className={styles.hint}>
        Tip: pinch to zoom, drag the crop corners, and use the dial to straighten. Grid overlays power safe areas.
      </p>
    </div>
  );
}