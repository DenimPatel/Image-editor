import { ChipRow } from '../controls/ChipRow';
import { ColorField } from '../controls/ColorField';
import { IconButton } from '../controls/IconButton';
import { SegmentedControl } from '../controls/SegmentedControl';
import { Slider } from '../controls/Slider';
import { EyeGlyph, EyeOffGlyph, TrashGlyph } from '../ui/editorIcons';import { createDrawLayer, createFrameLayer, createRedactLayer, createShapeLayer, createStickerLayer, createTextLayer, createWatermarkLayer } from '../../features/layers/factory';
import { ensureFont, FONTS } from '../../features/layers/fonts';
import { STICKERS } from '../../features/layers/stickers';
import type { DrawLayer, FrameStyle, Layer } from '../../model/types';
import { addLayerToDoc, clearDrawStrokes, nudgeLayer, removeLayer, updateLayerPatch } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import styles from './tools.module.css';

function useSelectedLayer(): Layer | undefined {
  const layerId = useUiStore((state) => state.selectedLayerId);
  return useDocStore((state) => state.present.layers.find((layer) => layer.id === layerId));
}

function TransformControls({ layer }: { layer: Layer }) {
  const { transform } = layer;
  const set = (patch: Partial<typeof transform>) => updateLayerPatch(layer.id, { transform: { ...transform, ...patch } });
  return (
    <>
      <p className={styles.sectionTitle}>Transform</p>
      <Slider label="X" value={Math.round(transform.x * 100)} min={-20} max={120} unit="%" onChange={(x) => set({ x: x / 100 })} />
      <Slider label="Y" value={Math.round(transform.y * 100)} min={-20} max={120} unit="%" onChange={(y) => set({ y: y / 100 })} />
      <Slider label="Scale" value={Math.round(transform.scale * 100)} min={5} max={400} unit="%" onChange={(scale) => set({ scale: scale / 100 })} />
      <Slider label="Rotation" value={transform.rotation} min={-180} max={180} unit="°" onChange={(rotation) => set({ rotation })} />
      <Slider label="Opacity" value={Math.round(transform.opacity * 100)} min={0} max={100} unit="%" onChange={(opacity) => set({ opacity: opacity / 100 })} />
    </>
  );
}

export function TextPanel() {
  const layer = useSelectedLayer();
  const layers = useDocStore((state) => state.present.layers);
  const textLayers = layers.filter((candidate) => candidate.kind === 'text');
  const selectLayer = useUiStore((state) => state.selectLayer);

  if (!layer || layer.kind !== 'text') {
    return (
      <div>
        <button type="button" className={`${styles.textButton} ${styles.textButtonPrimary}`} onClick={() => selectLayer(addTextLayerAndReturn())}>
          Add text
        </button>
        <div className={styles.list}>
          {textLayers.map((candidate) => (
            <button key={candidate.id} type="button" className={styles.listItem} onClick={() => selectLayer(candidate.id)}>
              <span className={styles.grow}>{candidate.kind === 'text' ? candidate.text : ''}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const style = layer.style;
  const setStyle = (patch: Partial<typeof style>) => updateLayerPatch(layer.id, { style: { ...style, ...patch } });

  return (
    <div>
      <textarea
        className={styles.grow}
        style={{ width: '100%', minHeight: 60, borderRadius: 10, padding: 8 }}
        value={layer.text}
        onChange={(event) => updateLayerPatch(layer.id, { text: event.target.value })}
        aria-label="Text content"
      />
      <p className={styles.sectionTitle}>Font</p>
      <select
        className={styles.grow}
        style={{ width: '100%', minHeight: 40, borderRadius: 10, padding: 8 }}
        value={style.fontId}
        onChange={(event) => {
          setStyle({ fontId: event.target.value });
          void ensureFont(event.target.value);
        }}
      >
        {FONTS.map((font) => (
          <option key={font.id} value={font.id}>
            {font.label}
          </option>
        ))}
      </select>
      <Slider label="Size" value={style.size} min={2} max={40} unit="%" onChange={(size) => setStyle({ size })} />
      <ColorField label="Colour" value={style.color} onChange={(color) => setStyle({ color })} />
      <SegmentedControl
        ariaLabel="Alignment"
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ]}
        value={style.align}
        onChange={(align) => setStyle({ align })}
      />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} aria-pressed={style.bold} onClick={() => setStyle({ bold: !style.bold })}>
          B
        </button>
        <button type="button" className={styles.textButton} aria-pressed={style.italic} onClick={() => setStyle({ italic: !style.italic })}>
          I
        </button>
        <button type="button" className={styles.textButton} aria-pressed={style.shadow} onClick={() => setStyle({ shadow: !style.shadow })}>
          Shadow
        </button>
      </div>
      <Slider label="Stroke" value={style.strokeWidth} min={0} max={20} onChange={(strokeWidth) => setStyle({ strokeWidth })} />
      <Slider label="Arc" value={style.arc} min={-100} max={100} onChange={(arc) => setStyle({ arc })} />
      <TransformControls layer={layer} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(layer.id)}>
          Delete layer
        </button>
      </div>
      <p className={styles.sectionTitle}>Watermark</p>
      <button type="button" className={styles.textButton} onClick={() => selectLayer(addWatermarkAndReturn())}>
        Add watermark
      </button>
    </div>
  );
}

function addTextLayerAndReturn(): string {
  const layer = createTextLayer('Tap to edit');
  addLayerToDoc(layer);
  void ensureFont(layer.style.fontId);
  return layer.id;
}

function addWatermarkAndReturn(): string {
  const layer = createWatermarkLayer();
  addLayerToDoc(layer);
  return layer.id;
}

export function StickersPanel() {
  const selectLayer = useUiStore((state) => state.selectLayer);
  return (
    <div>
      <p className={styles.sectionTitle}>Stickers</p>
      <div className={styles.lookGrid}>
        {STICKERS.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            className={styles.lookItem}
            onClick={() => {
              const layer = createStickerLayer(sticker.id);
              addLayerToDoc(layer);
              selectLayer(layer.id);
            }}
          >
            {sticker.label}
          </button>
        ))}
      </div>
      <p className={styles.sectionTitle}>Shapes</p>
      <div className={styles.buttonRow}>
        {(['rect', 'ellipse', 'line', 'arrow'] as const).map((shape) => (
          <button
            key={shape}
            type="button"
            className={styles.textButton}
            onClick={() => {
              const layer = createShapeLayer(shape);
              addLayerToDoc(layer);
              selectLayer(layer.id);
            }}
          >
            {shape}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RedactPanel() {
  const layer = useSelectedLayer();
  const layers = useDocStore((state) => state.present.layers);
  const redactLayers = layers.filter((candidate) => candidate.kind === 'redact');
  const selectLayer = useUiStore((state) => state.selectLayer);
  if (!layer || layer.kind !== 'redact') {
    return (
      <div>
        <button
          type="button"
          className={`${styles.textButton} ${styles.textButtonPrimary}`}
          onClick={() => {
            const created = createRedactLayer();
            addLayerToDoc(created);
            selectLayer(created.id);
          }}
        >
          Add redaction
        </button>
        <div className={styles.list}>
          {redactLayers.map((candidate) => (
            <button key={candidate.id} type="button" className={styles.listItem} onClick={() => selectLayer(candidate.id)}>
              <span className={styles.grow}>{candidate.id}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const setRegion = (patch: Partial<typeof layer.region>) =>
    updateLayerPatch(layer.id, { region: { ...layer.region, ...patch } });
  return (
    <div>
      <SegmentedControl
        ariaLabel="Redaction mode"
        options={[
          { value: 'pixelate', label: 'Pixelate' },
          { value: 'blur', label: 'Blur' },
          { value: 'solid', label: 'Solid' },
          { value: 'emoji', label: 'Emoji' },
        ]}
        value={layer.mode}
        onChange={(mode) => updateLayerPatch(layer.id, { mode })}
      />
      {(layer.mode === 'pixelate' || layer.mode === 'blur') && (
        <Slider label="Strength" value={layer.strength} min={1} max={100} onChange={(strength) => updateLayerPatch(layer.id, { strength })} />
      )}
      {layer.mode === 'emoji' && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Emoji</span>
          <input
            type="text"
            value={layer.emoji}
            maxLength={4}
            onChange={(event) => updateLayerPatch(layer.id, { emoji: event.target.value })}
            style={{ width: 64, minHeight: 40, borderRadius: 10, textAlign: 'center' }}
          />
        </label>
      )}
      <p className={styles.sectionTitle}>Region</p>
      <Slider label="X" value={Math.round(layer.region.x * 100)} min={0} max={100} unit="%" onChange={(x) => setRegion({ x: x / 100 })} />
      <Slider label="Y" value={Math.round(layer.region.y * 100)} min={0} max={100} unit="%" onChange={(y) => setRegion({ y: y / 100 })} />
      <Slider label="Width" value={Math.round(layer.region.width * 100)} min={2} max={100} unit="%" onChange={(width) => setRegion({ width: width / 100 })} />
      <Slider label="Height" value={Math.round(layer.region.height * 100)} min={2} max={100} unit="%" onChange={(height) => setRegion({ height: height / 100 })} />
      <p className={styles.hint}>Redactions are baked into the exported pixels, so the original is not recoverable.</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(layer.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

export function FramePanel() {
  const layer = useSelectedLayer();
  const frame = layer && layer.kind === 'frame' ? layer : undefined;
  const stylesList: FrameStyle[] = ['solid', 'inset', 'polaroid', 'film', 'rounded', 'shadow-card'];
  return (
    <div>
      <p className={styles.sectionTitle}>Frame style</p>
      <ChipRow
        ariaLabel="Frame styles"
        options={stylesList.map((style) => ({ value: style, label: style }))}
        value={frame?.style ?? null}
        onChange={(style) => {
          if (frame) updateLayerPatch(frame.id, { style });
          else addLayerToDoc(createFrameLayer(style));
        }}
      />
      {frame && (
        <>
          <Slider label="Width" value={frame.width} min={1} max={25} onChange={(width) => updateLayerPatch(frame.id, { width })} />
          <ColorField label="Colour" value={frame.color} onChange={(color) => updateLayerPatch(frame.id, { color })} />
          <label className={styles.toggle}>
            <span>Inside the canvas</span>
            <input
              type="checkbox"
              checked={frame.inside}
              onChange={(event) => updateLayerPatch(frame.id, { inside: event.target.checked })}
            />
          </label>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.textButton} onClick={() => removeLayer(frame.id)}>
              Remove frame
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function DrawPanel() {
  const layer = useSelectedLayer();
  const drawLayer = layer && layer.kind === 'draw' ? layer : undefined;
  const layers = useDocStore((state) => state.present.layers);
  const drawLayers = layers.filter((candidate): candidate is DrawLayer => candidate.kind === 'draw');
  const selectLayer = useUiStore((state) => state.selectLayer);
  const target = drawLayer ?? drawLayers[0];
  if (!target) {
    return (
      <div>
        <p className={styles.hint}>No drawing layer yet — create one, then sketch on the canvas.</p>
        <button
          type="button"
          className={`${styles.textButton} ${styles.textButtonPrimary}`}
          onClick={() => {
            const created = createDrawLayer();
            addLayerToDoc(created);
            selectLayer(created.id);
          }}
        >
          New drawing layer
        </button>
      </div>
    );
  }
  return (
    <div>
      <SegmentedControl
        ariaLabel="Brush"
        options={[
          { value: 'pen', label: 'Pen' },
          { value: 'marker', label: 'Marker' },
          { value: 'highlighter', label: 'Highlight' },
          { value: 'neon', label: 'Neon' },
          { value: 'eraser', label: 'Eraser' },
        ]}
        value={target.brush}
        onChange={(brush) => updateLayerPatch(target.id, { brush })}
      />
      <ColorField label="Colour" value={target.color} onChange={(color) => updateLayerPatch(target.id, { color })} />
      <Slider label="Size" value={target.size} min={1} max={12} onChange={(size) => updateLayerPatch(target.id, { size })} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => clearDrawStrokes(target.id)}>
          Clear
        </button>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(target.id)}>
          Delete layer
        </button>
      </div>
      <p className={styles.hint}>Draw directly on the canvas.</p>
    </div>
  );
}

export function LayersPanel() {
  const layers = useDocStore((state) => state.present.layers);
  const selectedId = useUiStore((state) => state.selectedLayerId);
  const selectLayer = useUiStore((state) => state.selectLayer);
  return (
    <div>
      {layers.length === 0 && <p className={styles.hint}>No layers yet.</p>}
      <div className={styles.list}>
        {[...layers].reverse().map((layer) => (
          <div key={layer.id} className={`${styles.listItem}${layer.id === selectedId ? ` ${styles.listItemActive}` : ''}`}>
            <IconButton
              label={layer.visible ? 'Hide layer' : 'Show layer'}
              onClick={() => updateLayerPatch(layer.id, { visible: !layer.visible })}
            >
              {layer.visible ? <EyeGlyph /> : <EyeOffGlyph />}
            </IconButton>
            <button type="button" className={styles.grow} style={{ textAlign: 'left' }} onClick={() => selectLayer(layer.id)}>
              {layer.kind} · {layer.name}
            </button>
            <IconButton label="Move up" onClick={() => nudgeLayer(layer.id, 1)}>
              ▲
            </IconButton>
            <IconButton label="Move down" onClick={() => nudgeLayer(layer.id, -1)}>
              ▼
            </IconButton>
            <IconButton label="Delete layer" onClick={() => removeLayer(layer.id)}>
              <TrashGlyph />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}