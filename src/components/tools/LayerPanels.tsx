import { useEffect, useRef, useState } from 'react'
import { ColorField } from '../controls/ColorField'
import { IconButton } from '../controls/IconButton'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Slider } from '../controls/Slider'
import { EmptyState } from '../ui/EmptyState'
import {
  ArrowRightGlyph,
  BLEND_GLYPHS,
  BRUSH_GLYPHS,
  EyeGlyph,
  EyeOffGlyph,
  FRAME_GLYPHS,
  REDACT_MODE_GLYPHS,
  SHAPE_GLYPHS,
  STICKER_ART,
  STICKER_GLYPHS,
  TrashGlyph,
  type IconComponent,
  type StickerId,
} from '../ui/icons'
import { nextRovingIndex } from '../ui/rovingTabindex'
import {
  BLEND_LABELS,
  BLEND_MODE_TITLES,
  BRUSH_LABELS,
  FRAME_STYLE_LABELS,
  FRAME_STYLES,
  LAYER_KIND_LABELS,
  REDACT_MODE_LABELS,
  SHAPE_LABELS,
  SHAPES,
} from '../ui/displayLabels'
import {
  BRUSHES,
  LAYER_TRANSFORM_PARTS,
  REDACT_MODES,
  blendModes,
  createDrawLayer,
  createFrameLayer,
  createRedactLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  createWatermarkLayer,
} from '../../features/layers/factory'
import { ensureFont, FONTS, getFontFailure } from '../../features/layers/fonts'
import {
  STICKERS,
  STICKER_ACCEPT,
  STICKER_MAX_EDGE,
  StickerDecodeError,
  decodeStickerFile,
  uploadedStickerLayer,
} from '../../features/layers/stickers'
import { patchNormRect } from '../../features/layers/layerOps'
import type { CSSProperties } from 'react'
import type { DrawLayer, Layer, NormRect, ShapeLayer, WatermarkLayer } from '../../model/types'
import { assetStore } from '../../model/assetsSingleton'
import {
  addLayerToDoc,
  clearDrawStrokes,
  dropLayerOnRow,
  duplicateLayerToDoc,
  nudgeLayer,
  removeLayer,
  renameLayerInDoc,
  setLayerBlendInDoc,
  updateLayerPatch,
  bringLayerToFront,
  sendLayerToBack,
} from '../../store/actions'
import { liveAssetIds, useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import visuals from './layerVisuals.module.css'
import styles from './tools.module.css'

/**
 * The sticker upload control, as three inline styles rather than a class.
 *
 * `tools.module.css` and `layerVisuals.module.css` are not this file's to extend,
 * so the geometry is inline. `position: relative` on the label makes the input's
 * `inset: 0` resolve against it, which is what lets a transparent native input
 * cover a styled one — the input stays the accessible control, the label is what
 * is drawn.
 */
const UPLOAD_TRIGGER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  marginTop: 8,
  width: '100%',
  position: 'relative',
  cursor: 'pointer',
  textAlign: 'center',
}

/** Transparent, full-bleed, and still in the accessibility tree. */
const UPLOAD_INPUT: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
}

/** Sized in `calc()`, so it takes the icon multiplier like every other glyph. */
const UPLOAD_GLYPH: CSSProperties = {
  flex: 'none',
  width: 'calc(16px * var(--icon-scale))',
  height: 'calc(16px * var(--icon-scale))',
}

function useSelectedLayer(): Layer | undefined {
  const layerId = useUiStore((state) => state.selectedLayerId)
  return useDocStore((state) => state.present.layers.find((layer) => layer.id === layerId))
}

/**
 * The built-in sticker set, narrowed to a lookup.
 *
 * `StickerDef.id` and `StickerLayer.svg` are both `string` because an uploaded
 * sticker has no id in the built-in set and the layer still has to say so. The
 * two tables are `Record<StickerId, …>`, so the lookup is total for the eight
 * built-ins and `undefined` for an upload — which is the honest answer rather
 * than a missing case. `icons.test.tsx` asserts the two id sets are the same
 * eight, so the narrowing cannot rot.
 */
function builtInSticker(id: string): { label: string; glyph: IconComponent } | undefined {
  return id in STICKER_ART
    ? { label: STICKER_ART[id as StickerId].label, glyph: STICKER_GLYPHS[id as StickerId] }
    : undefined
}

type GlyphOption<T extends string> = {
  value: T
  label: string
  glyph: IconComponent
  /**
   * Hover text only, and never the accessible name: `title` is the last step of
   * the name algorithm, so beside real button text it is invisible to assistive
   * technology and to a `getByRole` locator. It exists so a chip may abbreviate
   * ("Soft" for `soft-light`) and still offer the full name.
   */
  title?: string
}

/**
 * A chip row that carries a drawing.
 *
 * `ChipRow` and `SegmentedControl` take a `label: string`, and the artwork the
 * icon agent built for these six unions — `FRAME_GLYPHS`, `BRUSH_GLYPHS`,
 * `SHAPE_GLYPHS`, `BLEND_GLYPHS`, `REDACT_MODE_GLYPHS`, `STICKER_GLYPHS` — had
 * nowhere to go as a result. This is the same widget with the same contract: a
 * `group` of `aria-pressed` toggle buttons, one tab stop for the row and arrow
 * keys inside it via the shared `nextRovingIndex`, which is what
 * `SegmentedControl` uses.
 *
 * The drawing sits *beside* the word and is `aria-hidden` by the icon factory
 * itself, so the accessible name is the label and only the label. That is the
 * whole contract: an earlier build of this panel replaced chip text with a glyph
 * and the names went with it.
 */
function GlyphRow<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string
  options: GlyphOption<T>[]
  value: T | null
  onChange: (value: T) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  // The row scrolls sideways with no scrollbar, so it needs the same
  // "there is more this way" fade `ChipRow` draws — a mask on the trailing edge,
  // applied only while there is genuinely something past it. The blend row is
  // nine chips and the panel is 360 px wide, so this is the normal case, not an
  // edge case.
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 2)
    measure()
    // A window listener rather than a `ResizeObserver`, for two reasons that
    // point the same way: the one thing the panel's width depends on is the
    // viewport, and jsdom — where these panels are unit-tested — has no
    // observer at all, so the fade would have thrown in every render.
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [options.length])
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const focusAt = (index: number) => {
    rowRef.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus()
  }
  return (
    <div
      ref={rowRef}
      className={visuals.glyphRow}
      role="group"
      aria-label={ariaLabel}
      data-more={overflowing ? 'true' : 'false'}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        const Glyph = option.glyph
        return (
          <button
            key={option.value}
            type="button"
            className={`${visuals.glyphChip}${selected ? ` ${visuals.glyphChipActive}` : ''}`}
            aria-pressed={selected}
            title={option.title}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const next = nextRovingIndex(event.key, selectedIndex, options.length)
              if (next === null) return
              event.preventDefault()
              onChange(options[next].value)
              focusAt(next)
            }}
          >
            <Glyph className={visuals.glyphChipArt} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The shared transform inspector. Controls are gated on
 * `LAYER_TRANSFORM_PARTS`, which mirrors what `drawLayers` actually honours, so
 * a slider can never exist for a transform the compositor discards.
 */
function TransformControls({ layer }: { layer: Layer }) {
  const parts = LAYER_TRANSFORM_PARTS[layer.kind]
  const { transform } = layer
  const set = (patch: Partial<Layer['transform']>) =>
    updateLayerPatch(layer.id, { transform: { ...transform, ...patch } })
  return (
    <>
      <p className={styles.sectionTitle}>Transform</p>
      {parts.position ? (
        // A watermark is the one kind whose `transform.x/y` is not a position.
        // `drawWatermarkLayer` treats it as a normalized *offset* from the
        // layer's anchor — the mark is drawn at `anchor + (x - 0.5)` — so the
        // same 0-100% position slider every other kind shares put a default
        // bottom-right mark at 20% of the way across a canvas it should have
        // been sitting in the corner of. Labelling it "X" was a second lie on
        // top: the number meant an offset and was printed as a place.
        layer.kind === 'watermark' ? (
          <>
            <Slider
              label="Offset X"
              value={Math.round((transform.x - 0.5) * 100)}
              min={-50}
              max={50}
              unit="%"
              onChange={(x) => set({ x: x / 100 + 0.5 })}
            />
            <Slider
              label="Offset Y"
              value={Math.round((transform.y - 0.5) * 100)}
              min={-50}
              max={50}
              unit="%"
              onChange={(y) => set({ y: y / 100 + 0.5 })}
            />
            <p className={styles.hint}>
              0% sits the mark on its anchor. These slide it from there, in canvas widths and
              heights.
            </p>
          </>
        ) : (
          <>
            <Slider
              label="X"
              value={Math.round(transform.x * 100)}
              min={-20}
              max={120}
              unit="%"
              onChange={(x) => set({ x: x / 100 })}
            />
            <Slider
              label="Y"
              value={Math.round(transform.y * 100)}
              min={-20}
              max={120}
              unit="%"
              onChange={(y) => set({ y: y / 100 })}
            />
          </>
        )
      ) : (
        <p className={styles.hint}>
          This layer is placed by its own size and position, not by the transform.
        </p>
      )}
      {parts.scale && (
        <Slider
          label="Scale"
          value={Math.round(transform.scale * 100)}
          min={5}
          max={400}
          unit="%"
          onChange={(scale) => set({ scale: scale / 100 })}
        />
      )}
      {parts.rotation && (
        <Slider
          label="Rotation"
          value={transform.rotation}
          min={-180}
          max={180}
          unit="°"
          onChange={(rotation) => set({ rotation })}
        />
      )}
      {parts.opacity && (
        <Slider
          label="Opacity"
          value={Math.round(transform.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(opacity) => set({ opacity: opacity / 100 })}
        />
      )}
      {parts.blend && (
        <GlyphRow
          ariaLabel="Blend mode"
          options={blendModes().map((mode) => ({
            value: mode,
            label: BLEND_LABELS[mode],
            title: BLEND_MODE_TITLES[mode],
            glyph: BLEND_GLYPHS[mode],
          }))}
          value={transform.blend}
          onChange={(blend) => setLayerBlendInDoc(layer.id, blend)}
        />
      )}
    </>
  )
}

function ShapeGeometryControls({ layer }: { layer: ShapeLayer }) {
  return (
    <>
      <p className={styles.sectionTitle}>Size</p>
      <Slider
        label="Width"
        value={Math.round(layer.width * 100)}
        min={2}
        max={100}
        unit="%"
        onChange={(width) => updateLayerPatch(layer.id, { width: width / 100 })}
      />
      <Slider
        label="Height"
        value={Math.round(layer.height * 100)}
        min={1}
        max={100}
        unit="%"
        onChange={(height) => updateLayerPatch(layer.id, { height: height / 100 })}
      />
      <ColorField
        label="Fill"
        value={layer.fill}
        onChange={(fill) => updateLayerPatch(layer.id, { fill })}
      />
      <ColorField
        label="Stroke"
        value={layer.stroke}
        onChange={(stroke) => updateLayerPatch(layer.id, { stroke })}
      />
    </>
  )
}

/**
 * The inspector for the kinds that had none at all (D6-F12). Sticker scale,
 * shape size and frame colour are the three things a user reaches for first,
 * and each of them writes a field the compositor reads.
 */
export function LayerInspector() {
  const layer = useSelectedLayer()
  if (!layer || (layer.kind !== 'sticker' && layer.kind !== 'shape')) return null
  return (
    <div>
      <p className={styles.sectionTitle}>{layer.kind === 'sticker' ? 'Sticker' : 'Shape'}</p>
      <TransformControls layer={layer} />
      {layer.kind === 'shape' && <ShapeGeometryControls layer={layer} />}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(layer.id)}>
          Delete layer
        </button>
      </div>
    </div>
  )
}

export function TextPanel() {
  const layer = useSelectedLayer()
  const layers = useDocStore((state) => state.present.layers)
  const source = useDocStore((state) => state.present.source)
  const textLayers = layers.filter((candidate) => candidate.kind === 'text')
  const watermarkLayers = layers.filter((candidate) => candidate.kind === 'watermark')
  const selectLayer = useUiStore((state) => state.selectLayer)

  const addText = (
    <button
      type="button"
      className={`${styles.textButton} ${styles.textButtonPrimary}`}
      onClick={() => selectLayer(addTextLayerAndReturn())}
    >
      Add text
    </button>
  )

  /**
   * The two ways into this panel, and the list of what already exists.
   *
   * It used to render only in the branch where *nothing* text-shaped was
   * selected, which made every other state a dead end. Add one text layer and
   * the panel became its inspector: no "Add text", no "Add watermark", and no
   * way back to the list except selecting a different layer in another tool and
   * coming back. The Layers panel has no add affordance either, so a document
   * could hold exactly one text layer and one watermark, forever, with nothing
   * anywhere telling the user that. The second caption is the same sentence for
   * the same reason — "every tool writes one" is only true of the first.
   */
  const adders = (
    <>
      {textLayers.length > 0 || watermarkLayers.length > 0 ? addText : null}
      <div className={styles.list}>
        {textLayers.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={styles.listItem}
            onClick={() => selectLayer(candidate.id)}
          >
            <span className={styles.grow}>{candidate.text}</span>
          </button>
        ))}
      </div>
      <p className={styles.sectionTitle}>Watermark</p>
      <button
        type="button"
        className={styles.textButton}
        onClick={() => selectLayer(addWatermarkAndReturn())}
      >
        Add watermark
      </button>
      <div className={styles.list}>
        {watermarkLayers.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={styles.listItem}
            onClick={() => selectLayer(candidate.id)}
          >
            <span className={styles.grow}>{candidate.text}</span>
          </button>
        ))}
      </div>
    </>
  )

  if (layer?.kind === 'watermark') {
    return (
      <div>
        <WatermarkInspector layer={layer} />
        {adders}
      </div>
    )
  }

  if (!layer || layer.kind !== 'text') {
    // The explanation is for the panel with nothing in it. Once a text layer or
    // a watermark exists the list below *is* the explanation, and a sentence
    // telling a returning user that they have no text layer would be a lie.
    const empty = textLayers.length === 0 && watermarkLayers.length === 0
    return (
      <div>
        {empty ? (
          <EmptyState
            title="No text layer yet"
            description="add one and it lands in the middle of the image, with its words ready to replace."
            action={addText}
          />
        ) : null}
        {adders}
      </div>
    )
  }

  const style = layer.style
  const setStyle = (patch: Partial<typeof style>) =>
    updateLayerPatch(layer.id, { style: { ...style, ...patch } })

  return (
    <div>
      <textarea
        className={styles.grow}
        style={{ width: '100%' }}
        value={layer.text}
        onChange={(event) => updateLayerPatch(layer.id, { text: event.target.value })}
        // Selecting on arrival at the field, not on arrival at the layer. A new
        // layer carries the words "Edit this text", and the caret used to land at
        // the end of them, so the first keystroke appended and the layer came out
        // as "Edit this textKODAK" — a word nobody asked for, welded to the front
        // of theirs. Selecting the field's contents means the first keystroke
        // *replaces* them instead.
        //
        // Both events, and the pointer one deferred by a turn, because they are not
        // the same moment and neither is enough alone. `focus` fires before the
        // pointer has placed the caret, so on WebKit it loses; and WebKit also
        // ignores a `select()` made inside the mouse dispatch itself, so an
        // `onClick` handler loses there too — measured, WebKit: the caret stayed
        // where the click put it and the layer came out as "Edit this textKODAK".
        // `setTimeout(…, 0)` is what gets past it, because by then the click has
        // finished. `onFocus` alone is still needed, because `click` never fires
        // for a field reached with the Tab key.
        //
        // Deliberately not `field.select()` from an effect on the layer id: in
        // Chromium `select()` also takes focus, and focus in a text field is where
        // the browser's own Cmd+Z lives. Auto-focusing the field is therefore how
        // you make the first undo after "Add text" do nothing at all — the
        // document loses a shortcut for a promise about a caret, and two journey
        // specs assert that undo removes the layer.
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => {
          const field = event.currentTarget
          window.setTimeout(() => field.select(), 0)
        }}
        aria-label="Text content"
      />
      <label className={styles.sectionTitle} htmlFor="text-layer-font">
        Font
      </label>
      <select
        id="text-layer-font"
        className={styles.grow}
        style={{ width: '100%' }}
        value={style.fontId}
        onChange={(event) => {
          setStyle({ fontId: event.target.value })
          void ensureFont(event.target.value)
        }}
      >
        {FONTS.map((font) => {
          // A face that failed to load still renders, in the system stack, and
          // the old list said nothing about it. `ensureFont` records the
          // failure, so the entry can admit it.
          const failure = getFontFailure(font.id)
          return (
            <option key={font.id} value={font.id}>
              {font.label}
              {failure ? ' (unavailable)' : ''}
            </option>
          )
        })}
      </select>
      <Slider
        label="Size"
        value={style.size}
        min={2}
        max={40}
        unit="%"
        onChange={(size) => setStyle({ size })}
      />
      {/* "Size 8%" next to "Scale 100%" is two size controls and neither number
          means anything on its own — 8 what? of what? `drawTextLayer` computes
          the type size as `(style.size / 100) × min(width, height)`, so the
          percentage is of the *shorter edge* of the photo, and the same 8% is
          102 px on this image and 240 px on a phone snap of the same framing.
          The hint answers it with the number the reader can act on and names the
          control it is not, so the two are not read as the same slider twice. */}
      {source ? (
        <p className={styles.hint}>
          {style.size}% of the shorter edge — about{' '}
          {Math.round((style.size / 100) * Math.min(source.width, source.height))} px of type on
          this {source.width} × {source.height} photo. Scale below resizes the whole layer.
        </p>
      ) : null}
      <ColorField label="Colour" value={style.color} onChange={(color) => setStyle({ color })} />
      <SegmentedControl
        ariaLabel="Alignment"
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
        ]}
        value={style.align}
        onChange={(align) => setStyle({ align })}
      />
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          aria-pressed={style.bold}
          onClick={() => setStyle({ bold: !style.bold })}
        >
          B
        </button>
        <button
          type="button"
          className={styles.textButton}
          aria-pressed={style.italic}
          onClick={() => setStyle({ italic: !style.italic })}
        >
          I
        </button>
        <button
          type="button"
          className={styles.textButton}
          aria-pressed={style.shadow}
          onClick={() => setStyle({ shadow: !style.shadow })}
        >
          Shadow
        </button>
      </div>
      <Slider
        label="Tracking"
        value={style.tracking}
        min={-20}
        max={60}
        onChange={(tracking) => setStyle({ tracking })}
      />
      <Slider
        label="Arc"
        value={style.arc}
        min={-100}
        max={100}
        unit="°"
        onChange={(arc) => setStyle({ arc })}
      />
      <Slider
        label="Stroke"
        value={style.strokeWidth}
        min={0}
        max={20}
        onChange={(strokeWidth) => setStyle({ strokeWidth })}
      />
      <TransformControls layer={layer} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(layer.id)}>
          Delete layer
        </button>
      </div>
      {/* Not a second inspector — the two ways to add another text layer or a
          watermark, which are otherwise only on screen when nothing text-shaped
          is selected. See `adders` above. */}
      {adders}
    </div>
  )
}

/** The nine resting places `drawWatermarkLayer` knows, in reading order. */
const WATERMARK_ANCHORS: { value: WatermarkLayer['anchor']; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-right', label: 'Top right' },
  { value: 'middle-left', label: 'Middle left' },
  { value: 'center', label: 'Centre' },
  { value: 'middle-right', label: 'Middle right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-right', label: 'Bottom right' },
]

/**
 * A watermark used to be creatable and then completely unreachable: the Text
 * panel branched on `layer.kind !== 'text'`, so selecting one fell through to
 * the "add a text layer" branch and offered nothing at all — no text, no font,
 * no colour, no anchor, no tiling, not even a delete. Everything the compositor
 * honours (move, scale, rotate, opacity, blend) was there in the model the
 * whole time; this is the control surface for it.
 */
function WatermarkInspector({ layer }: { layer: WatermarkLayer }) {
  const set = (patch: Partial<WatermarkLayer>) => updateLayerPatch(layer.id, patch)
  return (
    <div>
      <p className={styles.sectionTitle}>Watermark</p>
      <textarea
        className={styles.grow}
        style={{ width: '100%' }}
        value={layer.text}
        onChange={(event) => set({ text: event.target.value })}
        aria-label="Watermark text"
      />
      <label className={styles.sectionTitle} htmlFor="watermark-font">
        Font
      </label>
      <select
        id="watermark-font"
        className={styles.grow}
        style={{ width: '100%' }}
        value={layer.fontId}
        onChange={(event) => {
          set({ fontId: event.target.value })
          void ensureFont(event.target.value)
        }}
      >
        {FONTS.map((font) => {
          const failure = getFontFailure(font.id)
          return (
            <option key={font.id} value={font.id}>
              {font.label}
              {failure ? ' (unavailable)' : ''}
            </option>
          )
        })}
      </select>
      <ColorField label="Colour" value={layer.color} onChange={(color) => set({ color })} />
      <label className={styles.sectionTitle} htmlFor="watermark-anchor">
        Anchor
      </label>
      <select
        id="watermark-anchor"
        className={styles.grow}
        style={{ width: '100%' }}
        value={layer.anchor}
        onChange={(event) => set({ anchor: event.target.value as WatermarkLayer['anchor'] })}
      >
        {WATERMARK_ANCHORS.map((anchor) => (
          <option key={anchor.value} value={anchor.value}>
            {anchor.label}
          </option>
        ))}
      </select>
      <p className={styles.hint}>
        The anchor is where the mark rests. Transform then moves it from there.
      </p>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          aria-pressed={layer.tiled}
          onClick={() => set({ tiled: !layer.tiled })}
        >
          Tile across the image
        </button>
      </div>
      <TransformControls layer={layer} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(layer.id)}>
          Delete layer
        </button>
      </div>
    </div>
  )
}

function addTextLayerAndReturn(): string {
  const layer = createTextLayer('Edit this text')
  addLayerToDoc(layer)
  void ensureFont(layer.style.fontId)
  return layer.id
}

function addWatermarkAndReturn(): string {
  const layer = createWatermarkLayer()
  addLayerToDoc(layer)
  void ensureFont(layer.fontId)
  return layer.id
}

export function StickersPanel() {
  const selectLayer = useUiStore((state) => state.selectLayer)
  const [stickerError, setStickerError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const uploadSticker = async (file: File) => {
    setStickerError(null)
    setUploading(true)
    try {
      // The doc may only hold an asset id, so the decoded pixels go to the
      // Asset Vault and the layer carries the id — see the law in AGENTS.md.
      const bitmap = await decodeStickerFile(file, file.name)
      const assetId = assetStore.add(bitmap)
      const layer = uploadedStickerLayer(assetId, file.name)
      addLayerToDoc(layer)
      selectLayer(layer.id)
      assetStore.prune(liveAssetIds())
    } catch (error) {
      setStickerError(
        error instanceof StickerDecodeError
          ? error.message
          : `"${file.name}" could not be used as a sticker.`,
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      {/*
       * The two chip sets are groups, and the reason is a name collision the raw
       * enums were hiding: the built-in sticker `arrow` is labelled "Arrow" and
       * so is the shape. `exact: true` found exactly one "Arrow" when the chip
       * said `arrow`, and two now. Naming the groups fixes it for a screen
       * reader — which is the point, since the two headings above are visual
       * only — rather than distorting either set's vocabulary to keep a
       * Playwright locator unique.
       *
       * There is no heading above this row. `BottomSheet` has already written
       * `Stickers` at the top of the panel, and every other panel opens on a
       * *group* name — Shapes, Watermark, Transform, Frame style — rather than
       * on its own name a second time.
       */}
      <div className={styles.lookGrid} role="group" aria-label="Stickers">
        {STICKERS.map((sticker) => {
          // `STICKERS` carried `path` and `fill` for all eight and the panel
          // printed `{sticker.label}` instead, so the artwork sat in the
          // codebase unused. The glyph is the same path on the icon grid; the
          // word stays, so the tile is still named "Star".
          const Glyph = builtInSticker(sticker.id)?.glyph
          return (
            <button
              key={sticker.id}
              type="button"
              className={`${styles.lookItem} ${visuals.tile}`}
              onClick={() => {
                const layer = createStickerLayer(sticker.id)
                addLayerToDoc(layer)
                selectLayer(layer.id)
              }}
            >
              {Glyph && <Glyph className={visuals.tileArt} />}
              <span>{sticker.label}</span>
            </button>
          )
        })}
      </div>
      <label className={`${styles.textButton} ${styles.grow}`} style={UPLOAD_TRIGGER}>
        {/*
         * The native input, not a div with a click handler. It is the only element
         * that can open a file picker, it is what a keyboard user can Tab to and
         * press Enter on, and it is what carries the accessible name a `<label>`
         * gives it — so it stays in the tree at full size, laid over the styled
         * label, transparent rather than `display: none`. What it *paints* is the
         * browser's "Choose File / No file chosen", which is what used to sit on
         * this panel as a white box on a `#1c1c1e` ground. Its focus ring is drawn
         * around the whole label, because the input's own border box is the label.
         */}
        <input
          type="file"
          accept={STICKER_ACCEPT}
          style={UPLOAD_INPUT}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so picking the same file twice still fires a change.
            event.target.value = ''
            if (file) void uploadSticker(file)
          }}
        />
        <ArrowRightGlyph style={UPLOAD_GLYPH} />
        <span>{uploading ? 'Adding…' : `Upload a sticker (max ${STICKER_MAX_EDGE}px)`}</span>
      </label>
      {stickerError && (
        <p role="alert" className={styles.error}>
          {stickerError}
        </p>
      )}
      <p className={styles.sectionTitle}>Shapes</p>
      <div className={styles.buttonRow} role="group" aria-label="Shapes">
        {SHAPES.map((shape) => {
          const Glyph = SHAPE_GLYPHS[shape]
          return (
            <button
              key={shape}
              type="button"
              className={`${styles.textButton} ${visuals.chipWithArt}`}
              onClick={() => {
                const layer = createShapeLayer(shape)
                addLayerToDoc(layer)
                selectLayer(layer.id)
              }}
            >
              <Glyph className={visuals.chipArt} />
              <span>{SHAPE_LABELS[shape]}</span>
            </button>
          )
        })}
      </div>
      <LayerInspector />
    </div>
  )
}

export function RedactPanel() {
  const layer = useSelectedLayer()
  const layers = useDocStore((state) => state.present.layers)
  const redactLayers = layers.filter((candidate) => candidate.kind === 'redact')
  const selectLayer = useUiStore((state) => state.selectLayer)
  if (!layer || layer.kind !== 'redact') {
    return (
      <div>
        {redactLayers.length === 0 ? (
          <EmptyState
            title="No redaction yet"
            description="add one, then drag its region over whatever must not be readable. What is covered is removed from the exported file, not hidden behind an overlay."
            action={
              <button
                type="button"
                className={`${styles.textButton} ${styles.textButtonPrimary}`}
                onClick={() => {
                  const created = createRedactLayer()
                  addLayerToDoc(created)
                  selectLayer(created.id)
                }}
              >
                Add redaction
              </button>
            }
          />
        ) : (
          <button
            type="button"
            className={`${styles.textButton} ${styles.textButtonPrimary}`}
            onClick={() => {
              const created = createRedactLayer()
              addLayerToDoc(created)
              selectLayer(created.id)
            }}
          >
            Add redaction
          </button>
        )}
        <div className={styles.list}>
          {redactLayers.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={styles.listItem}
              onClick={() => selectLayer(candidate.id)}
            >
              <span className={styles.grow}>{candidate.name}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }
  // x and width are independent sliders, so every edit is clamped back onto
  // the canvas: a region pushed past the edge would redact nothing (D6-F06).
  const setRegion = (patch: Partial<NormRect>) =>
    updateLayerPatch(layer.id, { region: patchNormRect(layer.region, patch) })
  return (
    <div>
      <GlyphRow
        ariaLabel="Redaction mode"
        options={REDACT_MODES.map((mode) => ({
          value: mode,
          label: REDACT_MODE_LABELS[mode],
          glyph: REDACT_MODE_GLYPHS[mode],
        }))}
        value={layer.mode}
        onChange={(mode) => updateLayerPatch(layer.id, { mode })}
      />
      {(layer.mode === 'pixelate' || layer.mode === 'blur') && (
        <Slider
          label="Amount"
          value={layer.strength}
          min={1}
          max={100}
          onChange={(strength) => updateLayerPatch(layer.id, { strength })}
        />
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
      <Slider
        label="X"
        value={Math.round(layer.region.x * 100)}
        min={0}
        max={100}
        unit="%"
        onChange={(x) => setRegion({ x: x / 100 })}
      />
      <Slider
        label="Y"
        value={Math.round(layer.region.y * 100)}
        min={0}
        max={100}
        unit="%"
        onChange={(y) => setRegion({ y: y / 100 })}
      />
      <Slider
        label="Width"
        value={Math.round(layer.region.width * 100)}
        min={2}
        max={100}
        unit="%"
        onChange={(width) => setRegion({ width: width / 100 })}
      />
      <Slider
        label="Height"
        value={Math.round(layer.region.height * 100)}
        min={2}
        max={100}
        unit="%"
        onChange={(height) => setRegion({ height: height / 100 })}
      />
      <p className={styles.hint}>
        Redactions are baked into the exported pixels, so the original is not recoverable.
      </p>
      <TransformControls layer={layer} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(layer.id)}>
          Delete layer
        </button>
      </div>
    </div>
  )
}

export function FramePanel() {
  const layer = useSelectedLayer()
  const frame = layer && layer.kind === 'frame' ? layer : undefined
  const selectLayer = useUiStore((state) => state.selectLayer)
  return (
    <div>
      <p className={styles.sectionTitle}>Frame style</p>
      <GlyphRow
        ariaLabel="Frame styles"
        options={FRAME_STYLES.map((style) => ({
          value: style,
          label: FRAME_STYLE_LABELS[style],
          glyph: FRAME_GLYPHS[style],
        }))}
        value={frame?.style ?? null}
        onChange={(style) => {
          if (frame) updateLayerPatch(frame.id, { style })
          else {
            // Every other panel that *creates* a layer selects it, and the frame
            // was the one that did not. So tapping a style drew a frame on the
            // canvas and left the panel reading `frame === undefined`: no chip
            // pressed, no width or colour, and the sub-panel still saying there
            // is no frame — a sentence that was true when the panel opened and a
            // lie one tap later.
            const created = createFrameLayer(style)
            addLayerToDoc(created)
            selectLayer(created.id)
          }
        }}
      />
      {frame ? (
        <>
          <Slider
            label="Width"
            value={frame.width}
            min={1}
            max={25}
            unit="%"
            onChange={(width) => updateLayerPatch(frame.id, { width })}
          />
          <ColorField
            label="Colour"
            value={frame.color}
            onChange={(color) => updateLayerPatch(frame.id, { color })}
          />
          <label className={styles.toggle}>
            <span>Inside the canvas</span>
            <input
              type="checkbox"
              checked={frame.inside}
              onChange={(event) => updateLayerPatch(frame.id, { inside: event.target.checked })}
            />
          </label>
          <TransformControls layer={frame} />
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => removeLayer(frame.id)}
            >
              Remove frame
            </button>
          </div>
        </>
      ) : (
        // The picker above is a style chooser with nothing after it, so a user
        // could not tell whether tapping one would do anything. It says what
        // choosing a style does, and that the rest of the frame survives a
        // change of style.
        <EmptyState
          title="No frame yet"
          description="pick a style above and the frame is drawn around the edge of the picture. Change the style afterwards and the width, colour and placement are kept."
        />
      )}
    </div>
  )
}

export function DrawPanel() {
  const layer = useSelectedLayer()
  const drawLayer = layer && layer.kind === 'draw' ? layer : undefined
  const layers = useDocStore((state) => state.present.layers)
  const drawLayers = layers.filter((candidate): candidate is DrawLayer => candidate.kind === 'draw')
  const selectLayer = useUiStore((state) => state.selectLayer)
  const target = drawLayer ?? drawLayers[0]
  if (!target) {
    return (
      <div>
        {/* The third voice for the same empty state, and now the same one: a bare
            paragraph and a button with no heading, where Retouch and ToolSurface
            set a title and Text, Redact, Frame and Layers set a title in a
            different component. */}
        <EmptyState
          title="No drawing layer yet"
          description="create one, then sketch on the canvas."
          action={
            <button
              type="button"
              className={`${styles.textButton} ${styles.textButtonPrimary}`}
              onClick={() => {
                const created = createDrawLayer()
                addLayerToDoc(created)
                selectLayer(created.id)
              }}
            >
              New drawing layer
            </button>
          }
        />
      </div>
    )
  }
  return (
    <div>
      <GlyphRow
        ariaLabel="Brush"
        options={BRUSHES.map((brush) => ({
          value: brush,
          label: BRUSH_LABELS[brush],
          glyph: BRUSH_GLYPHS[brush],
        }))}
        value={target.brush}
        onChange={(brush) => updateLayerPatch(target.id, { brush })}
      />
      <ColorField
        label="Colour"
        value={target.color}
        onChange={(color) => updateLayerPatch(target.id, { color })}
      />
      <Slider
        label="Size"
        value={target.size}
        min={1}
        max={12}
        onChange={(size) => updateLayerPatch(target.id, { size })}
      />
      <TransformControls layer={target} />
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => clearDrawStrokes(target.id)}
        >
          Clear
        </button>
        <button type="button" className={styles.textButton} onClick={() => removeLayer(target.id)}>
          Delete layer
        </button>
      </div>
      <p className={styles.hint}>Draw directly on the canvas.</p>
    </div>
  )
}

/**
 * The two words a layer row is named by.
 *
 * `factory.ts` names a sticker after its id, a shape after its own kind, a frame
 * "Frame" whatever its style and a watermark "Watermark" whatever it says — so
 * the list read `sticker · star`, `shape · rect` and three identical
 * `frame · Frame` rows. That is the same raw identifier the chips were printing,
 * and a stack of rows that all say the same word is worse than no name at all.
 *
 * So: the kind is always spelled out, and a layer whose stored name is nothing
 * but its own id says instead what actually distinguishes it — the sticker's
 * name, the shape, the frame's style, the watermark's text. A name a person
 * typed is left exactly as typed, and a row whose detail turns out to be the
 * kind again collapses to one word rather than "Drawing · Drawing".
 */
function layerRowName(layer: Layer): string {
  const kind = LAYER_KIND_LABELS[layer.kind]
  const name = layerRowDetail(layer) ?? layer.name
  return name && name !== kind ? `${kind} · ${name}` : kind
}

function layerRowDetail(layer: Layer): string | null {
  if (layer.kind === 'sticker' && layer.name === layer.svg)
    return builtInSticker(layer.svg)?.label ?? null
  if (layer.kind === 'shape' && layer.name === layer.shape) return SHAPE_LABELS[layer.shape]
  if (layer.kind === 'frame' && layer.name === 'Frame') return FRAME_STYLE_LABELS[layer.style]
  if (layer.kind === 'watermark' && layer.name === 'Watermark') return layer.text || null
  return null
}

function LayerRow({
  layer,
  active,
  renaming,
  onRenameStart,
  onRenameCommit,
  onDropLayer,
  dragging,
  onDragStart,
}: {
  layer: Layer
  active: boolean
  renaming: boolean
  onRenameStart: () => void
  onRenameCommit: (name: string) => void
  onDropLayer: (targetId: string) => void
  dragging: boolean
  onDragStart: () => void
}) {
  const selectLayer = useUiStore((state) => state.selectLayer)
  const duplicateSelected = () => {
    const copyId = duplicateLayerToDoc(layer.id)
    if (copyId) selectLayer(copyId)
  }
  return (
    <div
      className={`${styles.listItem} ${visuals.listItem}${active ? ` ${styles.listItemActive}` : ''}`}
      draggable
      onDragStart={(event) => {
        // Some browsers refuse to start a drag with no payload attached.
        event.dataTransfer.setData('text/plain', layer.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDropLayer(layer.id)
      }}
    >
      <IconButton
        label={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={() => updateLayerPatch(layer.id, { visible: !layer.visible })}
      >
        {layer.visible ? <EyeGlyph /> : <EyeOffGlyph />}
      </IconButton>
      {renaming ? (
        <input
          className={styles.grow}
          autoFocus
          defaultValue={layer.name}
          aria-label="Layer name"
          onBlur={(event) => onRenameCommit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') onRenameCommit(layer.name)
          }}
        />
      ) : (
        <button
          type="button"
          className={visuals.rowName}
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={layerRowName(layer)}
          onClick={() => selectLayer(layer.id)}
          onDoubleClick={onRenameStart}
        >
          {layerRowName(layer)}
        </button>
      )}
      {active && (
        <>
          <IconButton label="Rename layer" onClick={onRenameStart}>
            ✎
          </IconButton>
          <IconButton label="Duplicate layer" onClick={duplicateSelected}>
            ⧉
          </IconButton>
          <IconButton label="Bring to front" onClick={() => bringLayerToFront(layer.id)}>
            ⤒
          </IconButton>
          <IconButton label="Send to back" onClick={() => sendLayerToBack(layer.id)}>
            ⤓
          </IconButton>
          {/* Delete moved in with the rest of the selected row's actions, and
              this is the arithmetic that put it there. `.listItem` is
              `flex-wrap: wrap` (it has to be: the selected row has eight
              children and would crush its name to a two-word column otherwise),
              and wrap breaks a line rather than shrinking an item — so every
              child must *fit*. The row is 327 px with 18 px of padding, and the
              tap targets are 44 px each, so eye + name + four controls needs
              200 px of chrome and leaves 109 px for the name. "Watermark · ©
              Your Company Name" is about 190 px. One control had to move, and
              this is the one that should: deleting is the only irreversible
              action in the row, and putting it behind a selection is the same
              decision "delete this layer, not that one" already implies.

              Reorder stays on every row — it is the reversible one, and moving a
              layer one step is the thing a stack of six wants at a glance. */}
          <IconButton label="Delete layer" onClick={() => removeLayer(layer.id)}>
            <TrashGlyph />
          </IconButton>
        </>
      )}
      <IconButton label="Move up" onClick={() => nudgeLayer(layer.id, 1)}>
        ▲
      </IconButton>
      <IconButton label="Move down" onClick={() => nudgeLayer(layer.id, -1)}>
        ▼
      </IconButton>
      {dragging && <span className={styles.hint}>drop to reorder</span>}
    </div>
  )
}

export function LayersPanel() {
  const layers = useDocStore((state) => state.present.layers)
  const selectedId = useUiStore((state) => state.selectedLayerId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  return (
    <div>
      {layers.length === 0 && (
        <EmptyState
          title="No layers yet"
          description="every tool writes one, so the first thing you add from Text, Draw, Stickers, Redact or Frame appears here. Select a row to edit it, or drag one onto another to reorder the stack."
        />
      )}
      <div className={styles.list}>
        {[...layers].reverse().map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            active={layer.id === selectedId}
            renaming={layer.id === renamingId}
            dragging={layer.id === draggingId}
            onDragStart={() => setDraggingId(layer.id)}
            onDropLayer={(targetId) => {
              if (draggingId) dropLayerOnRow(draggingId, targetId)
              setDraggingId(null)
            }}
            onRenameStart={() => setRenamingId(layer.id)}
            onRenameCommit={(name) => {
              renameLayerInDoc(layer.id, name)
              setRenamingId(null)
            }}
          />
        ))}
      </div>
    </div>
  )
}
