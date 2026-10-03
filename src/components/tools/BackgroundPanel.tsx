import { useRef, useState } from 'react'
import { isMattingReady, removeBackground, type MattingQuality } from '../../features/ml/matting'
import { MODELS, ModelUnavailableError } from '../../features/ml/ModelLoader'
import { assetStore } from '../../model/assetsSingleton'
import { convertBytes } from '../../lib/format'
import { decodeImageBlob, ImageTooLargeError } from '../../lib/decode'
import { clearFlagState, describeDisabledFlag, useFlagOff, useFlagSource } from '../../lib/flags'
import type { Background, Doc } from '../../model/types'
import { BACKGROUND_FITS, backgroundBlockedReason } from '../../render/background'
import { runAsyncEdit } from '../../store/asyncOps'
import { setBackground, setOutput } from '../../store/actions'
import { liveAssetIds, useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { ColorField } from '../controls/ColorField'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Slider } from '../controls/Slider'
import styles from './tools.module.css'

const BACKGROUND_MODES = [
  { value: 'none', label: 'Transparent' },
  { value: 'color', label: 'Colour' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
]

export function BackgroundPanel({ source }: { source: ImageBitmap | null }) {
  const background = useDocStore((state) => state.present.background)
  const output = useDocStore((state) => state.present.output)
  const pushToast = useUiStore((state) => state.pushToast)
  const mattingOff = useFlagOff('matting')
  const mattingSource = useFlagSource('matting')
  const [quality, setQuality] = useState<MattingQuality>('fast')
  const [running, setRunning] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const model = MODELS[quality === 'best' ? 'matting-fp16' : 'matting-quint8']

  /**
   * A replacement image is pixels, so it lives in the Asset Vault and the doc
   * keeps only its id — same law as every other bitmap in the app (AGENTS.md).
   */
  const pickImage = async (file: File) => {
    setImageError(null)
    try {
      const bitmap = await decodeImageBlob(file)
      const assetId = assetStore.add(bitmap)
      setBackground({ imageAssetId: assetId, mode: 'image' })
      assetStore.prune(liveAssetIds())
    } catch (cause) {
      setImageError(
        cause instanceof ImageTooLargeError
          ? cause.message
          : 'That file could not be read as an image.',
      )
    }
  }

  const handleRemove = async () => {
    if (!source) return
    controllerRef.current = new AbortController()
    setRunning(true)
    const result = await runAsyncEdit<ImageBitmap>({
      label: 'Removing background',
      externalSignal: controllerRef.current.signal,
      run: (signal, onProgress) => removeBackground(source, { quality, signal, onProgress }),
      apply: (doc: Doc, bitmap) => {
        const assetId = assetStore.add(bitmap)
        const sourceRef = doc.source
        return {
          ...doc,
          source: sourceRef
            ? { ...sourceRef, assetId, width: bitmap.width, height: bitmap.height }
            : sourceRef,
          background: { ...doc.background, removed: true },
        }
      },
    })
    setRunning(false)
    if (result.status === 'done') {
      assetStore.prune(liveAssetIds())
      pushToast('Background removed', 'success')
    } else if (result.status === 'error') {
      const message =
        result.error instanceof ModelUnavailableError
          ? "Couldn't download the background model — check your connection and try again, or set a background manually."
          : 'Background removal failed.'
      pushToast(message, 'error')
    }
  }

  const cancel = () => controllerRef.current?.abort()

  // Without a matte every replacement is a provable no-op — the source is opaque
  // everywhere, so the composite returns it unchanged — and the panel has to say
  // so rather than ship a control that appears to do nothing (D3-F12).
  const blocked = backgroundBlockedReason(background)

  return (
    <div>
      <p className={styles.sectionTitle}>Replace background</p>
      <SegmentedControl
        ariaLabel="Background mode"
        options={BACKGROUND_MODES}
        value={background.mode}
        onChange={(mode) => setBackground({ mode: mode as Background['mode'] })}
      />
      {blocked && (
        <p className={styles.hint} role="status">
          {blocked}
        </p>
      )}
      {background.mode === 'color' && (
        <ColorField
          label="Colour"
          value={background.color}
          onChange={(color) => setBackground({ color })}
        />
      )}
      {background.mode === 'gradient' && (
        <>
          <ColorField
            label="From"
            value={background.gradient.from}
            onChange={(from) => setBackground({ gradient: { ...background.gradient, from } })}
          />
          <ColorField
            label="To"
            value={background.gradient.to}
            onChange={(to) => setBackground({ gradient: { ...background.gradient, to } })}
          />
          <Slider
            label="Angle"
            value={background.gradient.angle}
            min={0}
            max={360}
            unit="°"
            interactionKey="background:angle"
            onChange={(angle) => setBackground({ gradient: { ...background.gradient, angle } })}
          />
        </>
      )}
      {background.mode === 'image' && (
        <>
          <label className={styles.textButton} style={{ display: 'block', marginTop: 8 }}>
            <span>{background.imageAssetId ? 'Choose a different image' : 'Choose an image'}</span>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'block', marginTop: 6, maxWidth: '100%' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared so picking the same file twice still fires a change.
                event.target.value = ''
                if (file) void pickImage(file)
              }}
            />
          </label>
          {imageError && (
            <p className={styles.error} role="alert">
              {imageError}
            </p>
          )}
          <SegmentedControl
            ariaLabel="Image fit"
            options={BACKGROUND_FITS.map((fit) => ({
              value: fit,
              label: fit === 'cover' ? 'Fill frame' : 'Fit inside',
            }))}
            value={background.fit}
            onChange={(fit) => setBackground({ fit: fit as Background['fit'] })}
          />
          <Slider
            label="Blur"
            value={Math.round(background.blur * 100)}
            min={0}
            max={100}
            unit="%"
            interactionKey="background:blur"
            onChange={(value) => setBackground({ blur: value / 100 })}
          />
        </>
      )}

      {/*
        The `matting` flag, and the shape of the answer when it is off.

        The failure this exists for is the CDN: ~42 MB of ONNX weights fetched at
        runtime, which can 404, arrive corrupt, or change shape, and the user's
        only recourse was "don't click the button". Hiding the button would
        answer that with silence — the panel would look like a version of the app
        that never had the feature, and the user would have no way to tell that
        from a bug.

        So the panel states the condition and gives the way back. Which way back
        depends on the tier the flag came from, and that difference is the whole
        reason `flagSource` exists: a `?off=matting` in the address bar cannot be
        cleared from here — the user has to edit the URL — so offering a button
        that appeared to do it would be a control that silently does nothing. A
        saved override can be cleared, so it gets a button, and it is the same
        button the Help overlay's clear action uses.

        What is gated is exactly what needs the model: the quality picker, the
        download hint, and "Remove background". "Keep transparency (PNG)" sits
        below, ungated, because a photo that already has an alpha channel does
        not need one cut for it — taking that away with the model would remove
        the only route to a transparent background for a user who never needed a
        matte in the first place. It chooses the format and leaves the alpha
        alone; it does not claim a matte, because it has not cut one.
      */}
      <p className={styles.sectionTitle}>Subject removal</p>
      {mattingOff ? (
        <>
          <p className={styles.hint} role="status">
            {describeDisabledFlag('matting')}
          </p>
          {mattingSource === 'saved' && (
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.textButton} ${styles.textButtonPrimary}`}
                onClick={() => clearFlagState('matting')}
              >
                Turn background removal back on
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <SegmentedControl
            ariaLabel="Model quality"
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'best', label: 'Best quality' },
            ]}
            value={quality}
            onChange={(next) => setQuality(next)}
          />
          <p className={styles.hint}>
            {model.label} — about {convertBytes(model.bytes)}{' '}
            {model.host === 'cdn'
              ? 'downloaded from the imgly CDN on first use'
              : 'downloaded on first use'}
            {isMattingReady(quality) ? ' (cached)' : ''}
          </p>
          <p className={styles.hint}>
            No model is right every time. If the cut is ragged, pick a replacement that hides the
            edge or keep the transparency — there is no repair brush for tidying the cut-out edge
            yet.
          </p>
        </>
      )}
      <div className={styles.buttonRow}>
        {!mattingOff &&
          (running ? (
            <button type="button" className={styles.textButton} onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.textButton} ${styles.textButtonPrimary}`}
              onClick={() => void handleRemove()}
              disabled={!source}
            >
              Remove background
            </button>
          ))}
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            // Format, matte and background mode land as one undo step, and the
            // format change is a real edit here so it opts out of `setOutput`'s
            // transient default.
            //
            // `removed: true` used to be written here, and it was a claim the
            // pixels could not support. `backgroundHasMatte` means "a subject
            // matte exists" — only `Remove background` above ever produces one,
            // because the matte is destructive and lives in `doc.source`. A
            // button that set it invented a matte for a photo that had none, and
            // the visible cost was that the panel's own warning went quiet: with
            // `Colour` chosen and the flag set, "Nothing has been removed from
            // the background yet" disappeared while the canvas did not change by
            // one pixel. It also promised transparency it never delivered — on a
            // JPEG the exported PNG came back byte-for-byte identical to not
            // pressing the button, alpha 255 at every pixel.
            //
            // So the button now says what it actually does: choose PNG, and ask
            // for transparency to be left alone rather than filled. A photo that
            // already has an alpha channel keeps it; a photo that has none is
            // told the truth by the warning above, which is the only thing that
            // can honestly say it.
            useDocStore.getState().beginInteraction('background:png')
            setOutput({ format: 'png', matte: 'transparent' }, { transient: false })
            setBackground({ mode: 'none' })
            useDocStore.getState().endInteraction()
          }}
        >
          Keep transparency (PNG)
        </button>
      </div>
      <p className={styles.hint}>Current output: {output.format.toUpperCase()}</p>
      <p className={styles.hint}>
        PNG keeps any transparency the photo already has. Nothing is cut out here — for that, use
        Remove background.
      </p>
    </div>
  )
}
