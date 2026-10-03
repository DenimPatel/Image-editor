import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadCaps } from '../../gl/caps'
import { convertBytes } from '../../lib/format'
import { clearFlagState, describeDisabledFlag, useFlagOff, useFlagSource } from '../../lib/flags'
import { downloadBlob, extensionFor, isAbortError, mimeFor, raceAbort } from '../../lib/encode'
import { encodeDocument, type EncodedDocument } from '../../features/export/encodeDocument'
import {
  buildMultiSizeZip,
  DEFAULT_MULTI_SIZE_WIDTHS,
  normalizeWidths,
} from '../../features/export/multiSize'
import {
  buildArchiveName,
  buildExportName,
  describeTemplate,
  NAME_TOKENS,
  type NameContext,
} from '../../features/export/naming'
import { croppedSize, effectiveOutputSize } from '../../model/selectors'
import { isUpscale } from '../../lib/sizing'
import type { Doc, ExportFormat, ResizeSpec } from '../../model/types'
import { renderExportCanvas } from '../../render/exportCanvas'
import { createId } from '../../model/ids'
import { setOutput } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Slider } from '../controls/Slider'
import { Stepper } from '../controls/Stepper'
import controls from '../controls/controls.module.css'
import { ArchiveGlyph, CancelGlyph, CopyGlyph, DownloadGlyph, ShareGlyph } from '../ui/icons'
import styles from './tools.module.css'
import panel from './exportSheet.module.css'

/**
 * "Original" used to be the `none` mode, which is a lie the moment a crop
 * exists: `mode: 'none'` exports the *cropped* size, not the size the photo
 * arrived at. The other four entries are all operations, so this one now is too,
 * and "Original" is left to mean one thing in the product — the unedited photo
 * the compare badge holds.
 */
const RESIZE_MODES: { value: ResizeSpec['mode']; label: string }[] = [
  { value: 'none', label: 'No resize' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'longEdge', label: 'Long edge' },
  { value: 'percent', label: 'Percent' },
]

const WIDTH_CHOICES = [640, 720, 1080, 1440, 1920, 2560, 3840]

/** Same token as the error toast, without needing a class in a shared module. */
const ERROR_INK = 'var(--danger)'

/**
 * The policies the editor can actually honour on exported bytes. `all` is
 * deliberately absent: decoding bakes EXIF rotation into pixels and the canvas
 * encoder emits no metadata to keep, so "Keep all" could only ever promise
 * metadata the editor threw away at import.
 *
 * The second option names the tag rather than the effect, because "orientation"
 * already means portrait or landscape in the passport panel's "Print
 * orientation": one word, two senses, and the second one is the one this control
 * has. The rotation tag is the only thing written back, which is what the hint
 * below the control says.
 */
const METADATA_OPTIONS: { value: Doc['output']['metadata']; label: string }[] = [
  { value: 'strip', label: 'Strip' },
  { value: 'orientation', label: 'Keep the rotation tag' },
]

/**
 * How many ticked widths turn the zip from "a few files" into "a job". At five
 * the panel says so in words rather than leaving the user to discover it from a
 * frozen tab.
 */
const ZIP_HEAVY_COUNT = 5

/**
 * Which control is on screen holding the panel's buttons.
 *
 * The button row used to render *every* label as `Working…` whenever any one of
 * them was running, so a multi-size zip in progress showed "Download ·
 * Working…" — a label on the wrong button claiming the wrong work. One id, and
 * only that button says so.
 */
type ExportAction = 'download' | 'share' | 'copy' | 'zip' | 'plain'

/**
 * A failure the panel holds rather than toasts.
 *
 * A toast is gone in four seconds and the panel is still open; this is the one
 * message in this sheet that must outlast the user looking away, because it is
 * the message that says *their file was not written*. `toast` is the short label
 * the transient notification carries — the same four words it has always said —
 * and `message` is the sentence that says which failure this was.
 */
type PanelFailure = { message: string; hint: string; toast: string }

/** Ends the message for every share failure: nothing was shared, and Download is right there. */
const SHARE_FALLBACK_HINT =
  'Nothing was shared and no file was saved. Your edits are still here — Download writes the same picture to your device instead.'

/** The same closing offer for the clipboard, which fails for its own reasons. */
const COPY_FALLBACK_HINT =
  'Nothing was copied. Your edits are still here — Download writes the same picture to your device instead.'

const ZIP_FALLBACK_HINT =
  'No archive was written. Your edits are still here — narrow the widths, or use Download for a single file.'

const DOWNLOAD_FALLBACK_HINT =
  'No file was written. Your edits are still here — change a setting and press Download again.'

type Estimate = Pick<EncodedDocument, 'quality' | 'metTarget' | 'dpiWritten' | 'notes'> & {
  bytes: number
}

/**
 * One completed estimate pass: the key it was computed for, the number, and —
 * when there is no number — why.
 *
 * The key is what makes "still estimating" derivable rather than a second piece
 * of state to keep in step: the panel is estimating exactly when the last
 * finished pass is not for the settings now on screen. That also covers the
 * first 350 ms, which previously read as no size at all because `null` was
 * overloaded to mean both "not started" and "failed".
 */
type EstimateResult = { key: string; value: Estimate | null; error: string | null }

export function ExportSheet({
  source,
  fileName,
}: {
  source: ImageBitmap | null
  fileName: string
}) {
  const doc = useDocStore((state) => state.present)
  const output = doc.output
  const caps = useMemo(() => loadCaps(), [])
  const pushToast = useUiStore((state) => state.pushToast)
  const exportOff = useFlagOff('export')
  const exportSource = useFlagSource('export')
  const [estimate, setEstimate] = useState<EstimateResult | null>(null)
  const [running, setRunning] = useState<ExportAction | null>(null)
  const [failure, setFailure] = useState<PanelFailure | null>(null)
  const [widths, setWidths] = useState<number[]>(DEFAULT_MULTI_SIZE_WIDTHS)
  // The name template is panel state, not document state. It is a label for a
  // file, not an edit to the picture: it never reaches the undo stack, never
  // autosaves, and never rides along when the edits are copied as a recipe.
  // `setOutput` would be the wrong home twice over — it is `transient`, so the
  // value would still be persisted into every saved document while claiming to
  // be nothing, and `output` is the part of the doc a recipe replays.
  const [template, setTemplate] = useState('')

  const busy = running !== null
  const inFlight = useRef<AbortController | null>(null)
  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  }, [doc])
  const size = effectiveOutputSize(doc)
  const base = croppedSize(doc)
  // The output size is part of the key, not just the output *settings*. Crop and
  // undo can both change the pixel count while this panel is open, and a key
  // that tracked only the settings left the readout pairing a fresh
  // "4000 × 3000 px" with a `~` figure measured at some other size — two halves
  // of one line describing two different documents.
  const estimateKey = `${output.format}|${output.quality}|${output.targetBytes}|${output.dpi}|${output.metadata}|${output.matte}|${size.width}x${size.height}|${JSON.stringify(output.resize)}`
  // Derived, not stored: there is no window in which this is false while an
  // estimate for the current settings is missing.
  const isEstimating = estimate === null || estimate.key !== estimateKey
  const lastEstimate = isEstimating ? null : estimate.value
  const estimateError = isEstimating ? null : estimate.error

  useEffect(() => {
    // Nothing is being estimated while the sheet is off: the estimate runs the
    // very render and encode this panel is declared suspect of, so paying for
    // it would defeat the flag.
    if (!source || exportOff) return
    // Abort the previous full-resolution render instead of letting overlapping
    // estimates stack up: a 350 ms debounce is shorter than a 48 MP render.
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const canvas = await renderExportCanvas(source, docRef.current, undefined, {
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          const encoded = await encodeDocument(canvas, docRef.current, {
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          setEstimate({
            key: estimateKey,
            value: {
              bytes: encoded.blob.size,
              quality: encoded.quality,
              metTarget: encoded.metTarget,
              dpiWritten: encoded.dpiWritten,
              notes: encoded.notes,
            },
            error: null,
          })
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return
          // The estimate used to become `null` here and the readout rendered the
          // empty string, so moving the Quality slider made the size simply
          // vanish with nothing to say why. The dimensions and the DPI in the
          // same line are still known, so they stay; the size is now named as
          // unknown, and the reason is given underneath.
          setEstimate({ key: estimateKey, value: null, error: describeEstimateFailure(error) })
        }
      })()
    }, 350)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // Keyed on the output fields that change the encoded size; `doc` itself
    // changes identity on every keystroke, which re-ran the whole render.
  }, [source, estimateKey, exportOff])

  const runJob = useCallback(
    async <T,>(
      action: ExportAction,
      label: string,
      run: (signal: AbortSignal, onProgress: (progress: number) => void) => Promise<T>,
      onDone: (value: T) => void,
      onError: (error: unknown) => void,
      onCancel: () => void,
    ) => {
      const ui = useUiStore.getState()
      const jobId = createId('job')
      const controller = new AbortController()
      inFlight.current = controller
      setRunning(action)
      // The message about the last failure is about the last attempt. Retrying
      // clears it, so a user who fixes a permission and presses Copy again is
      // not still reading "the browser refused" while it works.
      setFailure(null)
      ui.startJob({ id: jobId, label, progress: 0, status: 'running' })
      try {
        const value = await raceAbort(
          run(controller.signal, (progress) => {
            useUiStore.getState().updateJob(jobId, {
              progress: Math.min(1, Math.max(0, progress)),
            })
          }),
          controller.signal,
        )
        if (controller.signal.aborted) {
          useUiStore.getState().finishJob(jobId, 'cancelled')
          onCancel()
          return
        }
        useUiStore.getState().finishJob(jobId, 'done')
        onDone(value)
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          useUiStore.getState().finishJob(jobId, 'cancelled')
          onCancel()
          return
        }
        useUiStore.getState().finishJob(jobId, 'error')
        onError(error)
      } finally {
        if (inFlight.current === controller) inFlight.current = null
        setRunning(null)
      }
    },
    [],
  )

  /** Post a failure to both places a user will look: the sheet, and the toast. */
  const reportFailure = useCallback(
    (failure: PanelFailure) => {
      setFailure(failure)
      pushToast(failure.toast, 'error')
    },
    [pushToast],
  )

  const buildBlob = useCallback(
    (signal: AbortSignal, onProgress: (progress: number) => void) => {
      if (!source) return Promise.reject(new Error('No image loaded'))
      // Download, Share and Copy all render through here, so this is the one
      // place the Cancel button has to reach: without the signal the abort
      // only landed between stages, after every GPU pass had already run.
      return renderExportCanvas(source, doc, undefined, { signal }).then((canvas) =>
        encodeDocument(canvas, doc, { signal, onProgress }),
      )
    },
    [source, doc],
  )

  /**
   * The one thing that still happens when the sheet is off.
   *
   * Deliberately the shortest path to a file that the browser itself provides:
   * render the document, hand the canvas to `toBlob` as PNG, download it. That
   * skips `encodeDocument` entirely — no format or quality choice, no Exif/DPI
   * writer, no target-size search, no `jspdf`, no `fflate` — which is exactly
   * the surface the flag is a complaint about, and leaves the pixel pipeline,
   * which is shared with the preview and guarded in its own right.
   *
   * It is a real fallback and not a dead end: the file it produces is the crop
   * and every edit, at the output size, which is the thing the user was trying
   * to get off the device.
   */
  const buildPlainPng = useCallback(
    (signal: AbortSignal) => {
      if (!source) return Promise.reject(new Error('No image loaded'))
      return renderExportCanvas(source, doc, undefined, { signal }).then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob)
              else reject(new Error('The browser could not encode this image'))
            }, 'image/png')
          }),
      )
    },
    [source, doc],
  )

  const nameContext = useMemo<NameContext>(
    () => ({
      fileName,
      width: size.width,
      height: size.height,
      format: output.format,
      dpi: output.dpi,
    }),
    [fileName, size.height, size.width, output.dpi, output.format],
  )
  const formatOptions: { value: ExportFormat; label: string }[] = [
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
    ...(caps.formats.webp ? [{ value: 'webp' as const, label: 'WebP' }] : []),
    ...(caps.formats.avif ? [{ value: 'avif' as const, label: 'AVIF' }] : []),
    { value: 'pdf', label: 'PDF' },
  ]
  const formatLabel =
    formatOptions.find((option) => option.value === output.format)?.label ??
    extensionFor(output.format).toUpperCase()

  /**
   * The archive is named for the widths the zip will actually hold, which is
   * the normalised set rather than whatever the checkboxes happen to spell —
   * and the *same* normalised set, not a second copy of the rule. The count in
   * the button's job label, the count in the archive name, the count in the
   * summary below and the number of entries `buildMultiSizeZip` writes are now
   * one number read once.
   */
  const zipWidths = useMemo(() => normalizeWidths(widths), [widths])
  const sizeCount = zipWidths.length
  const exportName = buildExportName(template, nameContext)
  const archiveName = buildArchiveName(template, nameContext, sizeCount)

  const handleDownload = useCallback(async () => {
    if (!source) return
    await runJob(
      'download',
      'Exporting',
      async (signal, onProgress) => {
        const encoded = await buildBlob(signal, onProgress)
        downloadBlob(encoded.blob, exportName)
        return encoded
      },
      (encoded) => {
        // A file that missed the cap it was asked for is not a plain success,
        // and it used to be announced as one: a green "Exported" followed by a
        // red line about the size, which reads as two unrelated events.
        if (!encoded.metTarget && output.targetBytes !== null) {
          pushToast(`Exported over the ${convertBytes(output.targetBytes)} limit`, 'error')
          return
        }
        pushToast('Exported', 'success')
      },
      (error) => {
        const reason = errorMessage(error).trim()
        reportFailure({
          message: reason ? `Export failed: ${reason}` : 'Export failed.',
          hint: DOWNLOAD_FALLBACK_HINT,
          toast: 'Export failed',
        })
      },
      () => pushToast('Export cancelled', 'info'),
    )
  }, [buildBlob, exportName, output.targetBytes, pushToast, reportFailure, runJob, source])

  const handlePlainSave = useCallback(async () => {
    if (!source) return
    await runJob(
      'plain',
      'Saving',
      async (signal) => {
        const blob = await buildPlainPng(signal)
        downloadBlob(blob, buildExportName('', { ...nameContext, format: 'png' }))
        return blob
      },
      () => pushToast('Saved', 'success'),
      (error) => {
        const reason = errorMessage(error).trim()
        reportFailure({
          message: reason ? `Save failed: ${reason}` : 'Save failed.',
          hint: 'No file was written. Your edits are still here — press Save as PNG again.',
          toast: 'Save failed',
        })
      },
      () => pushToast('Save cancelled', 'info'),
    )
  }, [buildPlainPng, nameContext, pushToast, reportFailure, runJob, source])

  const handleMultiSize = useCallback(async () => {
    if (!source) return
    await runJob(
      'zip',
      'Multi-size zip',
      async (signal, onProgress) => {
        const result = await buildMultiSizeZip(source, useDocStore.getState().present, zipWidths, {
          signal,
          onProgress,
        })
        downloadBlob(result.blob, archiveName)
        return result
      },
      (result) => pushToast(`Multi-size zip exported (${result.entries.length} sizes)`, 'success'),
      (error) => {
        const reason = errorMessage(error).trim()
        reportFailure({
          message: reason ? `Multi-size export failed: ${reason}` : 'Multi-size export failed.',
          hint: ZIP_FALLBACK_HINT,
          toast: 'Multi-size export failed',
        })
      },
      () => pushToast('Multi-size export cancelled', 'info'),
    )
  }, [archiveName, pushToast, reportFailure, runJob, source, zipWidths])

  const handleShare = useCallback(async () => {
    if (!source) return
    if (!canShareFiles()) {
      // Unreachable from the button, which is hidden when this is false. It
      // survives because the gate and the browser can disagree between the
      // render that showed the button and the click on it.
      reportFailure({
        message: 'This browser cannot share image files.',
        hint: SHARE_FALLBACK_HINT,
        toast: 'Share failed',
      })
      return
    }
    await runJob(
      'share',
      'Preparing share',
      async (signal, onProgress) => {
        const encoded = await buildBlob(signal, onProgress)
        // The same bytes Download would write, under the same name — a share
        // that arrives as `holiday.png` when the download was
        // `holiday-4000x3000.jpg` was the file being renamed behind the user's
        // back on the way to someone else's phone.
        const file = new File([encoded.blob], exportName, { type: encoded.blob.type })
        // The gate already asked `canShare` this question; asking again is the
        // only honest check, because this one is about *these* bytes and *this*
        // name, and it costs nothing next to the render that just happened.
        if (!navigator.canShare?.({ files: [file] })) {
          throw new DOMException('This browser will not share this file', 'NotSupportedError')
        }
        await navigator.share({ files: [file], title: fileName })
        return encoded
      },
      (encoded) => {
        if (!encoded.metTarget && output.targetBytes !== null) {
          pushToast(`Shared over the ${convertBytes(output.targetBytes)} limit`, 'error')
          return
        }
        pushToast('Shared', 'success')
      },
      (error) => {
        // The panel's Cancel button and the user dismissing the system share
        // sheet are the same event as far as the user is concerned and are not
        // the same event to the browser: the first aborts our own signal, the
        // second rejects `share()` with an `AbortError` of its own. Both say
        // "cancelled"; neither is a failure and neither gets the failure copy.
        if (isDismissal(error)) {
          pushToast('Share cancelled', 'info')
          return
        }
        reportFailure(describeShareFailure(error))
      },
      () => pushToast('Share cancelled', 'info'),
    )
  }, [
    buildBlob,
    exportName,
    fileName,
    output.targetBytes,
    pushToast,
    reportFailure,
    runJob,
    source,
  ])

  const handleCopy = useCallback(async () => {
    if (!source) return
    if (!canWriteClipboard()) {
      reportFailure({
        message: 'Copying images is not supported in this browser.',
        hint: COPY_FALLBACK_HINT,
        toast: 'Copy failed',
      })
      return
    }
    await runJob(
      'copy',
      'Copying',
      async (signal, onProgress) => {
        // The clipboard receives exactly what Download would produce: same
        // format, quality, DPI and target. PNG-only meant the copied bytes
        // silently ignored every export setting on the panel.
        const encoded = await buildBlob(signal, onProgress)
        const type = encoded.blob.type || mimeFor(output.format)
        if (!ClipboardItem.supports(type)) {
          throw new DOMException(type, 'NotSupportedError')
        }
        await navigator.clipboard.write([new ClipboardItem({ [type]: encoded.blob })])
        return encoded
      },
      (encoded) => {
        if (!encoded.metTarget && output.targetBytes !== null) {
          pushToast(`Copied over the ${convertBytes(output.targetBytes)} limit`, 'error')
          return
        }
        pushToast('Copied to clipboard', 'success')
      },
      (error) => reportFailure(describeClipboardFailure(error, mimeFor(output.format))),
      () => pushToast('Copy cancelled', 'info'),
    )
  }, [buildBlob, output.format, output.targetBytes, pushToast, reportFailure, runJob, source])

  const needsQuality = output.format !== 'png'
  const targetSupported =
    output.format === 'jpeg' || output.format === 'webp' || output.format === 'avif'
  const resize = output.resize
  const resizeValue =
    resize.mode === 'width'
      ? resize.width
      : resize.mode === 'height'
        ? resize.height
        : resize.mode === 'longEdge'
          ? resize.longEdge
          : resize.mode === 'percent'
            ? resize.percent
            : 0

  const setResizeMode = (mode: ResizeSpec['mode']) => {
    if (mode === 'none') setOutput({ resize: { mode: 'none' } })
    else if (mode === 'width') setOutput({ resize: { mode: 'width', width: size.width } })
    else if (mode === 'height') setOutput({ resize: { mode: 'height', height: size.height } })
    else if (mode === 'longEdge')
      setOutput({ resize: { mode: 'longEdge', longEdge: Math.max(size.width, size.height) } })
    else setOutput({ resize: { mode: 'percent', percent: 100 } })
  }

  const cancel = () => {
    inFlight.current?.abort()
  }

  const targetOverrun =
    lastEstimate !== null &&
    output.targetBytes !== null &&
    targetSupported &&
    !lastEstimate.metTarget

  /**
   * The `export` flag.
   *
   * The whole sheet goes, and it goes *loudly*: a flag that only hid a control
   * would leave the user with no way to save their picture and no way to find
   * out why. So the panel says what is off, says how to get it back, and keeps
   * one button that reaches a file — a plain PNG of the current crop with every
   * edit in it, produced by the browser's own `toBlob` rather than by
   * `encodeDocument`.
   *
   * The button to restore the sheet appears only for a *saved* override. A
   * `?off=export` in the address bar cannot be undone from here, so the copy
   * names the address bar instead of shipping a control that would appear to do
   * something and do nothing.
   *
   * Past every hook on purpose: an early return above one would break the rules
   * of hooks, which is the sort of thing that works until the next panel state
   * is added.
   */
  if (exportOff) {
    return (
      <div className={panel.panel}>
        <p className={styles.sectionTitle}>Export</p>
        <p className={styles.hint} role="status">
          {describeDisabledFlag('export')}
        </p>
        <p className={styles.hint}>
          You can still save the picture. This writes the current crop and every edit at{' '}
          {size.width} × {size.height} px as a plain PNG. There is no format choice, quality slider,
          metadata, DPI, target size, multi-size zip or PDF on this path.
        </p>
        {failure && <FailureNotice failure={failure} />}
        <div className={panel.actions}>
          <button
            type="button"
            className={`${styles.textButton} ${styles.textButtonPrimary}`}
            onClick={handlePlainSave}
            disabled={busy || !source}
          >
            <DownloadGlyph />
            {running === 'plain' ? 'Working…' : 'Save as PNG'}
          </button>
          {running && (
            <button
              type="button"
              className={`${styles.textButton} ${panel.cancelButton}`}
              onClick={cancel}
            >
              <CancelGlyph />
              Cancel
            </button>
          )}
          {exportSource === 'saved' && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => clearFlagState('export')}
            >
              Turn the full export sheet back on
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={panel.panel}>
      <p className={styles.sectionTitle}>Format</p>
      <div className={panel.segments}>
        <SegmentedControl
          ariaLabel="Export format"
          options={formatOptions}
          value={output.format}
          onChange={(format) => {
            // A size cap the new format cannot enforce must not survive the
            // switch: `setOutput` merges partials, so the doc would keep a
            // limit that nothing ever applies.
            const enforcesTarget = format === 'jpeg' || format === 'webp' || format === 'avif'
            setOutput({
              format,
              ...(enforcesTarget || output.targetBytes === null ? {} : { targetBytes: null }),
            })
          }}
        />
      </div>
      {/* The Hub promises "plus AVIF where your browser can encode it", and a
          format the browser cannot encode is dropped from `formatOptions` — so
          where that condition is false the picker was quietly one button short
          with nothing on screen to account for it. Absence is only silent to
          someone who already knows why; this is the one line that makes the
          picker and the promise agree, and it names the cause rather than
          gesturing at it: the encode goes through this browser's own canvas
          encoder, and if that returns PNG for `image/avif` there is no AVIF. */}
      {!caps.formats.avif && (
        <p className={styles.hint}>AVIF is missing because this browser cannot encode it.</p>
      )}

      {needsQuality && (
        <div style={{ marginTop: 12 }}>
          <Slider
            label="Quality"
            value={Math.round(output.quality * 100)}
            min={10}
            max={100}
            unit="%"
            onChange={(value) => setOutput({ quality: value / 100 })}
          />
        </div>
      )}

      <p className={styles.sectionTitle}>Size</p>
      <div className={panel.segments}>
        <SegmentedControl
          ariaLabel="Resize mode"
          options={RESIZE_MODES}
          value={resize.mode}
          onChange={setResizeMode}
        />
      </div>
      {resize.mode !== 'none' && (
        <div className={panel.numberRow}>
          <input
            className={panel.numberInput}
            type="number"
            min={1}
            aria-label={resizeFieldLabel(resize.mode)}
            value={resizeValue}
            onChange={(event) => {
              const value = Math.max(1, Number(event.target.value) || 1)
              const mode = resize.mode
              if (mode === 'width') setOutput({ resize: { mode: 'width', width: value } })
              else if (mode === 'height') setOutput({ resize: { mode: 'height', height: value } })
              else if (mode === 'longEdge')
                setOutput({ resize: { mode: 'longEdge', longEdge: value } })
              else if (mode === 'percent')
                setOutput({ resize: { mode: 'percent', percent: value } })
            }}
          />
          <span className={styles.hint}>{resize.mode === 'percent' ? '%' : 'px'}</span>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Stepper
          label="DPI"
          value={output.dpi}
          min={36}
          max={2400}
          step={1}
          onChange={(dpi) => setOutput({ dpi })}
        />
      </div>

      <p className={styles.sectionTitle}>Behind transparent areas</p>
      {/* "matte" is a VFX word: a first-time user reading "Background behind
          transparency" next to a tab called Background has no way to know this
          is about the *export's* transparent pixels, so the heading now says
          where the colour goes. The `Doc` field is still `output.matte` — that
          is an internal name, not something anyone reads. */}
      <label className={styles.toggle}>
        <span>
          <input
            type="radio"
            name="export-matte"
            value="transparent"
            checked={output.matte === 'transparent'}
            onChange={() => setOutput({ matte: 'transparent' })}
          />
          Leave transparent
        </span>
      </label>
      <div className={panel.numberRow}>
        <label className={styles.toggle}>
          <span>
            <input
              type="radio"
              name="export-matte"
              value="colour"
              checked={output.matte !== 'transparent'}
              onChange={() =>
                setOutput({ matte: output.matte === 'transparent' ? '#ffffff' : output.matte })
              }
            />
            Fill with a colour
          </span>
        </label>{' '}
        <input
          /* An `aria-label` is not a class. This control carried the name and
             nothing else, so it never picked up `controls.module.css`'s
             `.colorInput` and stayed at the UA's 50 × 27 — a bare target next to
             44px controls, on the one row of the sheet whose two halves have to
             be aimed at the same decision. The style is not declared here: this
             file's `styles` is `tools.module.css`, which has no such class, so
             an inline reference to it would have rendered `class="undefined"`.
             `PresetPopover` already reaches across for the same module. */
          className={controls.colorInput}
          type="color"
          aria-label="Colour behind transparent areas"
          disabled={output.matte === 'transparent'}
          value={output.matte === 'transparent' ? '#ffffff' : output.matte}
          onChange={(event) => setOutput({ matte: event.target.value })}
        />
      </div>

      <p className={styles.sectionTitle}>Metadata</p>
      <div className={panel.segments}>
        <SegmentedControl
          ariaLabel="Metadata policy"
          options={METADATA_OPTIONS}
          value={output.metadata === 'all' ? 'strip' : output.metadata}
          onChange={(metadata) => setOutput({ metadata })}
        />
      </div>
      <p className={styles.hint}>
        Strip removes EXIF, the colour profile, IPTC, XMP and comments. Exports never carry the
        source&apos;s metadata: the editor bakes rotation into the pixels at import. Keep the
        rotation tag writes back the EXIF rotation flag and nothing else — every other container is
        still removed.
      </p>

      <p className={styles.sectionTitle}>Target size</p>
      {targetSupported ? (
        <>
          <label className={styles.toggle}>
            <span>Fit under a maximum size</span>
            <input
              type="checkbox"
              checked={output.targetBytes !== null}
              onChange={(event) =>
                setOutput({ targetBytes: event.target.checked ? 500 * 1024 : null })
              }
            />
          </label>
          {output.targetBytes !== null && (
            <div className={panel.numberRow}>
              <input
                className={panel.numberInput}
                type="number"
                min={5}
                aria-label="Maximum size in kilobytes"
                value={Math.round(output.targetBytes / 1024)}
                onChange={(event) =>
                  setOutput({ targetBytes: Math.max(5, Number(event.target.value) || 5) * 1024 })
                }
              />
              <span className={styles.hint}>KB</span>
            </div>
          )}
        </>
      ) : (
        <p className={styles.hint}>
          {extensionFor(output.format).toUpperCase()} is lossless, so it cannot be re-encoded to hit
          a byte target.
        </p>
      )}

      <p className={styles.sectionTitle}>Multi-size zip</p>
      <p className={styles.hint}>
        One file per ticked width, each rendered from the full crop. The Size, DPI, quality, target
        and metadata settings above are the archive&apos;s settings too — everything except the
        resize, which the widths replace.
      </p>
      <div className={panel.widths} role="group" aria-label="Multi-size zip widths">
        {WIDTH_CHOICES.map((width) => (
          <label className={styles.toggle} key={width}>
            <span>{width}px</span>
            <input
              type="checkbox"
              checked={widths.includes(width)}
              onChange={(event) =>
                setWidths((current) => {
                  const next = event.target.checked
                    ? [...current, width]
                    : current.filter((entry) => entry !== width)
                  // Never leave the zip with nothing to render.
                  return next.length > 0 ? next : current
                })
              }
            />
          </label>
        ))}
      </div>
      <ZipSummary
        widths={zipWidths}
        formatLabel={formatLabel}
        cropWidth={base.width}
        resizeMode={resize.mode}
      />

      <p className={styles.sectionTitle}>File name</p>
      <div className={panel.nameRow}>
        <input
          type="text"
          className={panel.nameInput}
          aria-label="File name template"
          placeholder="{name}-{width}x{height}"
          maxLength={120}
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
        />
      </div>
      <p className={styles.hint}>
        Tokens: {NAME_TOKENS.join(' ')}. {describeTemplate(template)} A token the file cannot fill —{' '}
        {'{dpi}'} in a PDF, {'{index}'} in a single export — is dropped, and an empty template uses
        the name below.
      </p>
      <p className={styles.hint}>
        Download as <strong>{exportName}</strong> · multi-size zip as <strong>{archiveName}</strong>
      </p>

      <p className={styles.readout}>
        Output: {size.width} × {size.height} px · {output.dpi} DPI
        {isEstimating
          ? ' · estimating…'
          : lastEstimate !== null
            ? ` · ~${convertBytes(lastEstimate.bytes)}`
            : ' · size unknown'}
        {targetOverrun ? ' · over target' : ''}
      </p>
      {estimateError && (
        // `role="status"`, matching `FiltersPanel`: a condition the panel may sit
        // in, not an emergency. And it does *not* promise the download is fine —
        // it runs the very same render and encode, so if this failed, that will
        // too, and saying otherwise here would only move the surprise.
        <p role="status" className={styles.error}>
          {estimateError} Downloading runs the same encode, so it would fail the same way.
        </p>
      )}
      {targetOverrun && lastEstimate && (
        <p role="alert" style={{ color: ERROR_INK, fontSize: '0.8125rem' }}>
          Over target: even the lowest quality this export can reach is{' '}
          {convertBytes(lastEstimate.bytes)}, above the {convertBytes(output.targetBytes ?? 0)}{' '}
          limit.
        </p>
      )}
      {lastEstimate !== null &&
        lastEstimate.notes.map((note) => (
          <p className={styles.hint} key={note}>
            {note}
          </p>
        ))}
      {isUpscale(base, size) && (
        <p className={styles.hint}>
          Upscaling beyond the crop resolution — quality may soften (capped at 4×).
        </p>
      )}

      {failure && <FailureNotice failure={failure} />}

      <div className={panel.actions}>
        <button
          type="button"
          className={styles.textButton}
          onClick={handleDownload}
          disabled={busy || !source}
        >
          <DownloadGlyph />
          {running === 'download' ? 'Working…' : 'Download'}
        </button>
        {canShareFiles() && (
          <button
            type="button"
            className={styles.textButton}
            onClick={handleShare}
            disabled={busy || !source}
          >
            <ShareGlyph />
            {running === 'share' ? 'Working…' : 'Share'}
          </button>
        )}
        {canWriteClipboard() && (
          <button
            type="button"
            className={styles.textButton}
            onClick={handleCopy}
            disabled={busy || !source}
          >
            <CopyGlyph />
            {running === 'copy' ? 'Working…' : 'Copy'}
          </button>
        )}
        <button
          type="button"
          className={styles.textButton}
          onClick={handleMultiSize}
          disabled={busy || !source}
        >
          <ArchiveGlyph />
          {running === 'zip' ? 'Working…' : 'Multi-size zip'}
        </button>
        {running && (
          <button
            type="button"
            className={`${styles.textButton} ${panel.cancelButton}`}
            onClick={cancel}
          >
            <CancelGlyph />
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The panel's held failure.
 *
 * `role="alert"` on a box rather than a `role="status"` paragraph, because this
 * is the only message here that arrives after the user's work has already been
 * attempted, and it must be announced immediately rather than politely. It is
 * also the reason the estimate's own status line is not reused: the estimate
 * says "this figure is unavailable", this one says "your file was not written",
 * and collapsing them would lose the difference.
 */
function FailureNotice({ failure }: { failure: PanelFailure }) {
  return (
    <div className={panel.failure} role="alert">
      <p className={panel.failureMessage}>{failure.message}</p>
      <p className={panel.failureHint}>{failure.hint}</p>
    </div>
  )
}

/**
 * What the zip is about to cost, said before it costs it.
 *
 * `widths` is `normalizeWidths(widths)` — the same list `buildMultiSizeZip`
 * iterates — so the count, the widths and the archive name cannot disagree with
 * what the button does. Nothing here is re-derived from the tick boxes: a chip
 * set is a *proposal* and this is the deal being described.
 *
 * Three claims, in the order they matter: how many files, what they are, and
 * what the long ones cost.
 */
function ZipSummary({
  widths,
  formatLabel,
  cropWidth,
  resizeMode,
}: {
  widths: number[]
  formatLabel: string
  cropWidth: number
  resizeMode: ResizeSpec['mode']
}) {
  const count = widths.length
  const wide = widths.filter((width) => width > cropWidth)
  return (
    <div className={panel.zipSummary}>
      <p className={panel.zipSummaryEmphasis}>
        {count} file{count === 1 ? '' : 's'}: {formatWidths(widths)} wide, saved as {formatLabel}.
      </p>
      <p className={panel.zipSummaryCaution}>
        {count >= ZIP_HEAVY_COUNT
          ? `That is ${count} full-resolution renders of your current crop and edits, one after another, and this button will be busy for a while. Cancel stops it part-way and writes nothing.`
          : 'Each file is a full-resolution render of your current crop and edits, not a copy of the last one.'}
      </p>
      {resizeMode !== 'none' && (
        <p>The resize above does not apply here — every width is rendered from the full crop.</p>
      )}
      {wide.length > 0 && (
        <p>
          {wide.length === 1
            ? `${wide[0]} px is wider than your ${cropWidth} px crop, so it is scaled up: `
            : `${formatWidths(wide)} are wider than your ${cropWidth} px crop, so they are scaled up: `}
          more time and a bigger file, no extra detail.
        </p>
      )}
    </div>
  )
}

/** `720 px, 1080 px and 1920 px` — and for one entry, just the entry. */
function formatWidths(widths: number[]): string {
  const labelled = widths.map((width) => `${width} px`)
  if (labelled.length <= 1) return labelled.join('')
  if (labelled.length === 2) return `${labelled[0]} and ${labelled[1]}`
  return `${labelled.slice(0, -1).join(', ')} and ${labelled[labelled.length - 1]}`
}

/** The unit the number beside it is already showing, so the label does not lie. */
function resizeFieldLabel(mode: ResizeSpec['mode']): string {
  if (mode === 'width') return 'Width in pixels'
  if (mode === 'height') return 'Height in pixels'
  if (mode === 'longEdge') return 'Long edge in pixels'
  return 'Resize percentage'
}

/**
 * The engine's own words, kept to one clause.
 *
 * Nothing is inferred from the error beyond which stage it came from: when the
 * only thing known is the exception, the exception is the reason, and guessing a
 * friendlier cause would be a second claim to get wrong. The stage is tracked by
 * the caller, so a failure to *read* the canvas and a failure to *produce* it
 * read differently even when the engine's message is the same.
 */
function describeEstimateFailure(error: unknown): string {
  const message = errorMessage(error).trim()
  if (!message) return 'The size estimate failed and the render reported no reason.'
  const first = message.split('\n')[0]
  const reason = first.length > 140 ? `${first.slice(0, 137)}…` : first
  return `The size estimate failed: ${reason}.`
}

/**
 * A user who closed the system share sheet. Not a failure, and not our cancel either.
 *
 * Read by name rather than with `instanceof Error`, because `DOMException` is
 * not an `Error` in every environment this app runs in — jsdom's is a separate
 * class — and the one exception this has to recognise is a `DOMException` above
 * all. An `instanceof` check that is false in the test environment tests nothing
 * there and is a latent lie everywhere else.
 */
function isDismissal(error: unknown): boolean {
  return errorName(error) === 'AbortError'
}

/** The `name` of a thrown value, whether it is an `Error`, a `DOMException` or neither. */
function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

/** The `message` of a thrown value, or `''` when it carries none. */
function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

/**
 * A refused share, told apart from a failed one.
 *
 * `AbortError` is the user closing the sheet and is handled before this is
 * reached. What is left is either the browser declining to carry the file at
 * all (`NotSupportedError`, `TypeError`) or declining to run the share where it
 * was started (`NotAllowedError`, `DataError`) — and those are different
 * problems with different fixes, so they are named differently. Anything else
 * reports the engine's own words, because inventing a friendlier cause for an
 * exception nobody has read yet is a second claim to get wrong.
 */
function describeShareFailure(error: unknown): PanelFailure {
  const name = errorName(error)
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return {
      message: 'This browser will not share this file.',
      hint: SHARE_FALLBACK_HINT,
      toast: 'Share failed',
    }
  }
  if (name === 'NotAllowedError') {
    return {
      message: 'The browser blocked the share.',
      hint: `Sharing has to start from a tap on a top-level page, not a frame or an embed. ${SHARE_FALLBACK_HINT}`,
      toast: 'Share failed',
    }
  }
  if (name === 'DataError') {
    return {
      message: 'The browser could not take a file this size.',
      hint: `Export at a smaller size and share again. ${SHARE_FALLBACK_HINT}`,
      toast: 'Share failed',
    }
  }
  const reason = errorMessage(error).trim()
  return {
    message: reason ? `Share failed: ${reason}` : 'The share did not finish.',
    hint: SHARE_FALLBACK_HINT,
    toast: 'Share failed',
  }
}

/**
 * "Unsupported" and "refused" are different problems and were the same message.
 *
 * A refusal is a permission the user can grant and a type this browser cannot
 * carry is one they cannot, so the copy says which one it is: `NotAllowedError`
 * and `SecurityError` are refusals with something to do, `NotSupportedError` and
 * `TypeError` (Safari's "Type image/avif not supported on write") are limits,
 * and only the first pair is worth asking the user to change.
 */
function describeClipboardFailure(error: unknown, mime: string): PanelFailure {
  const name = errorName(error)
  const type = mime
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      message: 'The browser refused clipboard access.',
      hint: 'Nothing was copied. Allow the clipboard for this page, then press Copy again — or Download writes the same picture to your device instead.',
      toast: 'Copy failed',
    }
  }
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return {
      message: `Copy is not supported here for ${type}.`,
      hint: COPY_FALLBACK_HINT,
      toast: 'Copy failed',
    }
  }
  const reason = errorMessage(error).trim()
  return {
    message: reason ? `Copy failed: ${reason}` : 'Copy failed.',
    hint: COPY_FALLBACK_HINT,
    toast: 'Copy failed',
  }
}

/**
 * Whether this browser can actually hand a *file* to the system share sheet.
 *
 * The gate used to be `'share' in navigator`, which is true on desktop Chrome
 * and Firefox — and on those `navigator.canShare({ files })` is `false`, so the
 * panel offered a Share button that could only fail, after a full-resolution
 * render, in front of a user who was told it was going to work. The only honest
 * question is the one the spec provides, asked about a file, so that is what is
 * asked.
 *
 * The probe is a zero-byte file with no type: `canShare` looks at the payload's
 * shape, and a throwaway object keeps the check free of the encode the user may
 * never need.
 */
function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.share !== 'function') return false
  if (typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([], 'probe', { type: '' })] }) === true
  } catch {
    // Some engines throw rather than answer false on a payload they dislike.
    return false
  }
}

/**
 * Whether the clipboard can be written at all: the constructor, its type probe,
 * and — the one that was missing as a *reported* failure — the write call
 * itself. A browser with a clipboard object but no `write` is not a browser that
 * can copy, and offering the button anyway produced a refusal reported as
 * "not supported".
 */
function canWriteClipboard(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof ClipboardItem.supports === 'function' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  )
}
