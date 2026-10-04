import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EditorCanvas } from '../components/canvas/EditorCanvas'
import { EditorTopBar } from '../components/editor/EditorTopBar'
import { HelpOverlay } from '../components/editor/HelpOverlay'
import { ImportScreen, OfflineBanner } from '../components/editor/ImportScreen'
import { JobProgressBar } from '../components/editor/JobProgressBar'
import { PresetPopover } from '../components/editor/PresetPopover'
import { ResumeSessionCard } from '../components/editor/ResumeSessionCard'
import { countEdits } from '../components/editor/resumeSummary'
import { ToolSurface } from '../components/editor/ToolSurface'
import { ToolTabBar } from '../components/editor/ToolTabBar'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CloseGlyph } from '../components/ui/icons'
import { IconButton } from '../components/controls/IconButton'
import { ToastStack } from '../components/controls/Toast'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useAppearance } from '../hooks/useAppearance'
import { autoAdjust, autoChangedKeys, buildHistogram } from '../lib/auto'
import { describeUnsupported } from '../lib/accept'
import { confirmDestructive } from '../lib/confirm'
import { decodeImageBlob, decodeImageFile, decodeImageUrl, ImageTooLargeError } from '../lib/decode'
import { confirmThen, deletePresetRequest, discardSessionRequest } from '../lib/destructive'
import { editorEntryTool, newImageRequest, resolveEditorEntry } from '../lib/editorEntry'
import {
  attachUnloadFlush,
  createAutosave,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  type Autosave,
} from '../lib/persist/autosave'
import { forgetStoredDocument } from '../lib/persist/forget'
import {
  clearMirror,
  readMirror,
  resolveResumableSession,
  writeMirror,
} from '../lib/persist/mirror'
import {
  applyPreset,
  applyRecipe,
  deletePreset,
  hasClipboardRecipe,
  listPresets,
  readClipboardRecipe,
  savePreset,
  writeClipboardRecipe,
  type PresetResult,
  type RecipeWrite,
} from '../lib/persist/recipes'
import { bytesForSource } from '../lib/persist/sourceBytes'
import {
  createThumbnail,
  loadSession,
  saveSession,
  storageEstimate,
  type SaveResult,
  type SourceBytes,
} from '../lib/persist/session'
import { createDoc, ADJUST_SPEC_BY_KEY } from '../model/defaults'
import { assetStore } from '../model/assetsSingleton'
import { croppedSize } from '../model/selectors'
import { renderExportCanvas } from '../render/exportCanvas'
import { liveAssetIds, useDocStore } from '../store/docStore'
import { TOOL_IDS, useUiStore } from '../store/uiStore'
import styles from '../components/editor/editor.module.css'

type ResumeState = {
  /** Untrusted: an IndexedDB row can have been written by any older build. */
  doc: unknown
  updatedAt: number
  thumb: string | null
  source: Blob | null
}

/** The renderer needs real pixels, not just a closable resource. */
function isRenderableAsset(asset: unknown): asset is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && asset instanceof ImageBitmap
}

/** Whether the asset store can hand this id's pixels back as something drawable. */
function isRenderableSource(assetId: string): boolean {
  return isRenderableAsset(assetStore.get(assetId))
}

/**
 * The bitmap the document points at. Read straight from the asset store rather
 * than mirrored into state: a tool like background removal hands the document a
 * new `source.assetId`, and a copy in state is one render behind it.
 *
 * A document that names a source the store cannot hand back as pixels is
 * corrupt, and answering `null` for it used to render the import screen — which
 * reads as "no image loaded", quietly strands a document that still has every
 * edit in it, and leaves the user re-importing a file they never lost. The
 * render path therefore raises, and the route's error element says so in a place
 * the user can act on. It points at *Reload*, not at the route's "start over":
 * reloading re-reads the stored row and re-decodes it, which is the actual
 * recovery, while "start over" clears the session and throws the photo and the
 * edits away to do it.
 *
 * `required: false` is for the autosave, which must not be taken down by an
 * asset it can already describe from cached bytes.
 */
function bitmapFor(
  assetId: string | null,
  options: { required?: boolean } = {},
): ImageBitmap | null {
  if (!assetId) return null
  const asset = assetStore.get(assetId)
  if (isRenderableAsset(asset)) return asset
  if (options.required === false) return null
  throw new Error(
    `The document names a source the editor no longer holds (${assetId}). ${
      asset === undefined
        ? 'The image is not in memory.'
        : 'The stored asset is not an ImageBitmap.'
    } Reload the page to recover it.`,
  )
}

const SAVE_MESSAGES: Record<Exclude<SaveResult, 'ok'>, string> = {
  mismatch: 'Could not save: the image and its edits no longer match',
  quota: 'Storage is full — this session was not saved',
  unavailable: 'This browser blocked session storage, so nothing was saved',
  error: 'Could not save this session',
}

export default function Editor() {
  const navigate = useNavigate()
  const location = useLocation()
  // The editor is a separate route from the Hub, and `Nav` is Hub-only, so
  // without this the editor depends entirely on the pre-paint script: a change
  // made in another tab, or by the appearance panel opening and closing, would
  // write `localStorage` correctly and then never re-read it. Mounting the hook
  // here for the whole route — rather than inside the panel, which only exists
  // while it is open — is what makes the editor a second, independent writer
  // of the same idempotent DOM attributes. It costs one `useEffect`.
  useAppearance()
  const [fileName, setFileName] = useState('image')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resume, setResume] = useState<ResumeState | null>(null)
  const [canPaste, setCanPaste] = useState(false)
  const [presetNames, setPresetNames] = useState<string[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetOpen, setPresetOpen] = useState(false)
  const thumbRef = useRef<string | null>(null)
  const bytesRef = useRef<SourceBytes | null>(null)
  const busyRef = useRef(false)
  const autosaveRef = useRef<Autosave | null>(null)
  const activeTool = useUiStore((state) => state.activeTool)
  const pushToast = useUiStore((state) => state.pushToast)
  const revision = useDocStore((state) => state.revision)
  const sourceAssetId = useDocStore((state) => state.present.source?.assetId) ?? null
  const source = bitmapFor(sourceAssetId)

  // Which tool this door named, and which document it is allowed to open. Both
  // answers come out of one call so the tool a deep link asked for cannot be
  // honoured on one screen and dropped on the other.
  //
  // `location.pathname` rather than the `:tool` param, because `/editor` and
  // `/editor/<tool>` are two routes and the param is absent on one of them — and
  // `useParams` answering "no tool" for `/editor` is indistinguishable from
  // answering it for `/editor/nonsense`. The pathname is the whole address either
  // way.
  const entry = resolveEditorEntry({
    tool: editorEntryTool(location.pathname, TOOL_IDS),
    held: { assetId: sourceAssetId },
    holds: isRenderableSource,
  })

  // `source-unavailable` is the third answer and it never reaches a branch below:
  // `bitmapFor` above has already raised for it, by design and with a message that
  // names the asset, because a document whose pixels are gone still holds every edit
  // in it and the honest response is to say so rather than to show a different
  // photograph. Naming the reason here keeps that rule in the same file as the
  // decision that produced it.
  //
  // The `!source` half of the condition below is not a second opinion on that
  // decision — it is how TypeScript is told what `entry.action === 'open'` already
  // implies, because the render needs the pixels and not the verdict. `resolve`
  // returned `open` only when `isRenderableSource` accepted the id, and
  // `isRenderableSource` and `bitmapFor` ask the asset store the same question.

  useEffect(() => {
    if (entry.tool) useUiStore.getState().setActiveTool(entry.tool)
  }, [entry.tool])

  const reportSave = useCallback(
    async (result: SaveResult) => {
      if (result === 'ok') return
      if (result === 'quota') {
        const estimate = await storageEstimate()
        const used = estimate
          ? ` (${Math.round((estimate.usage / 1024 / 1024) * 10) / 10} MB used)`
          : ''
        pushToast(`${SAVE_MESSAGES[result]}${used}`, 'error')
        return
      }
      pushToast(SAVE_MESSAGES[result], 'error')
    },
    [pushToast],
  )

  // Autosave: trailing debounce, never more than maxWait behind a continuous
  // drag, always flushed when the page is being torn down. The bytes persisted
  // are the ones that produced the document's current source asset, so a
  // background cut-out survives the reload.
  //
  // `mirror` is what closes the last hole in that: the IndexedDB write is a
  // transaction, and a hard reload inside the debounce window tears the page
  // down before it can commit. `localStorage.setItem` is synchronous and lands
  // regardless, so the same snapshot is written there first and read back on
  // the next load. It is a mirror and not a second store: it holds the document
  // only, and only the newest document wins.
  useEffect(() => {
    const autosave = createAutosave(
      {
        mirror: () => {
          const doc = useDocStore.getState().present
          // A document with no image is not resumable, so there is nothing
          // worth mirroring — and the import screen is what should come back.
          if (doc.source) writeMirror(doc)
        },
        save: async () => {
          const doc = useDocStore.getState().present
          const bytes = await bytesForSource({
            doc,
            // A save must survive a source the store can no longer produce: the
            // bytes it needs are already in `known`, and a throw here would
            // take down a save that had nothing wrong with it.
            bitmap: bitmapFor(doc.source?.assetId ?? null, { required: false }),
            known: bytesRef.current,
          })
          if (bytes) bytesRef.current = bytes
          return saveSession(doc, bytes, thumbRef.current)
        },
        onResult: (result) => void reportSave(result),
      },
      { debounceMs: AUTOSAVE_DEBOUNCE_MS, maxWaitMs: AUTOSAVE_MAX_WAIT_MS },
    )
    autosaveRef.current = autosave
    const detach = attachUnloadFlush(window, () => void autosave.flush())
    return () => {
      detach()
      autosave.dispose()
      autosaveRef.current = null
    }
  }, [reportSave])

  useEffect(() => {
    void loadSession().then((stored) => {
      // The mirror only wins when it is strictly newer *and* names the same
      // source asset the stored bytes belong to; `resolveResumableSession`
      // carries that rule, and IndexedDB stays the store of record.
      const session = resolveResumableSession(stored, readMirror())
      if (session) setResume(session)
    })
    void hasClipboardRecipe().then(setCanPaste)
  }, [])

  const loadBitmap = useCallback(
    (bitmap: ImageBitmap, name: string, mime: string, blob: Blob | null) => {
      const assetId = assetStore.add(bitmap)
      useDocStore.getState().load(
        createDoc({
          source: { assetId, width: bitmap.width, height: bitmap.height, name, mime },
        }),
      )
      assetStore.prune(liveAssetIds())
      thumbRef.current = createThumbnail(bitmap)
      setFileName(name)
      setError(null)
      bytesRef.current = blob ? { assetId, blob, mime } : null
      // A different image is a different document. Leaving the old mirror in
      // place would let a reload inside the next save's debounce offer the
      // image the user just replaced.
      clearMirror()
      setResume(null)
    },
    [],
  )

  const setBusy = useCallback((busy: boolean) => {
    busyRef.current = busy
    setPending(busy)
  }, [])

  const handleFile = useCallback(
    async (file: File) => {
      if (busyRef.current) return
      const unsupported = describeUnsupported(file)
      if (unsupported) {
        setError(unsupported)
        return
      }
      setBusy(true)
      setError(null)
      try {
        const bitmap = await decodeImageFile(file)
        loadBitmap(bitmap, file.name.replace(/\.[^/.]+$/, ''), file.type, file)
      } catch (cause) {
        setError(
          cause instanceof ImageTooLargeError
            ? cause.message
            : 'Could not read that file as an image.',
        )
      } finally {
        setBusy(false)
      }
    },
    [loadBitmap, setBusy],
  )

  const handleSample = useCallback(
    async (url: string, label: string) => {
      if (busyRef.current) return
      setBusy(true)
      setError(null)
      try {
        const { bitmap, blob, mime } = await decodeImageUrl(url)
        loadBitmap(bitmap, label, mime, blob)
      } catch (cause) {
        setError(
          cause instanceof ImageTooLargeError ? cause.message : 'Could not load that sample image.',
        )
      } finally {
        setBusy(false)
      }
    },
    [loadBitmap, setBusy],
  )

  const handleResume = useCallback(async () => {
    const session = resume
    if (!session || busyRef.current) return
    if (!session.source) {
      setResume(null)
      setError('That session’s image is no longer stored, so there is nothing to resume.')
      return
    }
    setBusy(true)
    try {
      const bitmap = await decodeImageBlob(session.source)
      // A stored row is untrusted input: it becomes a Doc again only through
      // the migration chain, which is what `loadUnknown` runs.
      if (!useDocStore.getState().loadUnknown(session.doc)) {
        setError('That session was saved by a version of the editor that cannot read it.')
        return
      }
      const doc = useDocStore.getState().present
      if (doc.source) {
        const assetId = assetStore.add(bitmap, doc.source.assetId)
        if (doc.source.width !== bitmap.width || doc.source.height !== bitmap.height) {
          useDocStore.getState().load({
            ...doc,
            source: { ...doc.source, assetId, width: bitmap.width, height: bitmap.height },
          })
        }
        bytesRef.current = { assetId, blob: session.source, mime: doc.source.mime }
      }
      thumbRef.current = session.thumb ?? createThumbnail(bitmap)
      setFileName(doc.source?.name ?? 'image')
      setResume(null)
    } catch (cause) {
      setError(
        cause instanceof ImageTooLargeError
          ? cause.message
          : 'Could not restore the previous session.',
      )
    } finally {
      setBusy(false)
    }
  }, [resume, setBusy])

  const handleDiscard = useCallback(async () => {
    // The card shows the photo and the edit count and offers exactly two buttons,
    // and pressing the wrong one throws away work the user cannot see. It is the
    // only control in the app that deletes a stored document, so it asks — there
    // is no undo stack behind this page to fall back on.
    const edits = countEdits(resume?.doc)
    await confirmThen(discardSessionRequest(edits), () => {
      void forgetStoredDocument().then(() => {
        setResume(null)
      })
    })
  }, [resume])

  /**
   * Where focus goes after a replacement, on both paths.
   *
   * `ConfirmDialog` returns focus to whatever opened it, but a replacement unmounts
   * the entire top bar — so the node the focus would return to is gone and the
   * browser falls back to `<body>`. A keyboard user who pressed Enter on a menu row
   * is then tabbing from the top of an empty document with no landmark announced
   * and no way to tell what changed. It is the same on the confirming path, because
   * the More menu goes with the photograph it was opening.
   *
   * `<main id="editor-main">` is the answer, and it is the same target the skip
   * link already points at. It is rendered by both branches of the page, so this
   * focuses the region that is on screen rather than reaching for an element that
   * only exists in one of them.
   *
   * `requestAnimationFrame` rather than a synchronous call, because `load()` has
   * only been *called* by the time this effect runs: the effect above it is keyed on
   * `entry.action`, so React has committed the branch swap, but the dialog's own
   * restore has not necessarily run yet and both would otherwise race for the same
   * focus. The frame defers past it.
   */
  const focusAfterReplace = useRef(false)

  useEffect(() => {
    if (!focusAfterReplace.current) return
    focusAfterReplace.current = false
    const frame = requestAnimationFrame(() => {
      document.getElementById('editor-main')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [entry.action])

  /**
   * Hand the document back to the import screen.
   *
   * This is the exit D-01 said did not exist, and the order of the four steps is
   * the whole of it:
   *
   * 1. **Stop the old document from being written, and wait for the write already
   *    in flight.** A debounce still armed for it would commit the row this gesture
   *    is about to delete, which is precisely how the replaced photo came back on
   *    the next reload. `cancel()` drops that armed work, and it cannot recall a
   *    write already dispatched — so `idle()` is awaited before the delete, because
   *    a delete issued in the same tick loses the race and the row lands afterwards.
   *    Nothing schedules a compensating write: the effect that schedules returns
   *    early with no source, and nothing else names the old document.
   * 2. **Delete both durable copies.** Not the mirror alone, and not the row alone.
   *    A mirror without its row is *inert* — `resolveResumableSession` returns null
   *    when the stored row is missing, because a mirror carries edits and no pixels
   *    and so cannot resume on its own. A **row without its mirror is the dangerous
   *    half**: it is returned as-is, so a reload after clearing only the mirror
   *    offers the photograph the user just replaced. Both go, because the pair is
   *    only ever read as a pair, and a half-cleared pair is a state neither writer
   *    has an answer for. `forgetStoredDocument` is the only place that pair is
   *    cleared.
   * 3. **Replace rather than merge.** `load()` — not `update()` — so there is no
   *    undo entry to press back through, the layers are a fresh document's and the
   *    old asset is unreferenced. This is why the confirmation above names a count
   *    it cannot then honour with Ctrl+Z.
   * 4. **Close the old pixels.** `prune` runs against the new document's live set,
   *    so the replaced photo's bitmap is released instead of pinned by a history
   *    that no longer mentions it.
   *
   * The route is not changed. The state after this is exactly the state a first
   * visit is in — no document, no stored row, no mirror — so a reload reaches the
   * same import screen, and a URL that said "fresh" would only add a Back button
   * that lands on the same empty editor.
   *
   * It is `async` because of step 1 and only step 1. Everything else is
   * synchronous on purpose: the store replacement and the UI reset below must land
   * in the same frame the user pressed the button, or the editor would still be
   * showing the old photograph while the delete ran.
   */
  const replaceDocument = useCallback(async () => {
    autosaveRef.current?.cancel()
    focusAfterReplace.current = true
    useDocStore.getState().load(createDoc())
    assetStore.prune(liveAssetIds())
    thumbRef.current = null
    bytesRef.current = null
    setFileName('image')
    setError(null)
    setResume(null)
    setPresetOpen(false)
    // A tool panel is a panel over a photograph. There is no photograph.
    useUiStore.getState().setActiveTool(null)
    // Last, and awaited. The write `cancel()` could not recall has to land before
    // the delete, not after it, or the replaced photograph's row is recreated by
    // the very gesture that replaced it. Nothing schedules a write for the empty
    // document that replaced it, so there is no second race to close.
    await autosaveRef.current?.idle()
    await forgetStoredDocument()
  }, [])

  /**
   * `New image`, with the question asked only when there is something to lose.
   *
   * `past.length` is read at press time rather than being tracked in state, so the
   * number in the dialog cannot be stale: the dialog's own copy of the count would
   * be a second truth about the document.
   */
  const handleNewImage = useCallback(async () => {
    const request = newImageRequest(useDocStore.getState().past.length)
    if (!request) {
      await replaceDocument()
      return
    }
    if (await confirmDestructive(request)) await replaceDocument()
  }, [replaceDocument])

  /**
   * "Reset all edits" — one press, no question.
   *
   * `reset()` is its own undo step (`docStore.reset` closes any open interaction
   * first), so `Ctrl+Z` brings the whole edit stack back *and* the stack that would
   * bring the rest back — it is the most recoverable control in the app. Undo is in
   * the top bar of the same frame as this row, so a dialog here is a second decision
   * about work the user can already get back, and it is asked on every press rather
   * than once. `destructive.ts` names the four controls that do ask, and this is not
   * one of them.
   */
  const handleReset = useCallback(() => {
    useDocStore.getState().reset()
  }, [])

  useEffect(() => {
    if (!source) return
    autosaveRef.current?.schedule()
  }, [source, revision])

  const handleAuto = useCallback(async () => {
    if (!source) return
    try {
      const doc = useDocStore.getState().present
      const base = croppedSize(doc)
      const width = 256
      const height = Math.max(1, Math.round((width * base.height) / base.width))
      const canvas = await renderExportCanvas(source, doc, { width, height })
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no context')
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      const partial = autoAdjust(buildHistogram(data))
      const before = useDocStore.getState().present.adjust
      useDocStore
        .getState()
        .update((current) => ({ ...current, adjust: { ...current.adjust, ...partial } }), {
          key: 'auto',
        })
      // What changed, not merely that something did. "Auto applied" is true of a
      // run that moved one slider and a run that moved six, and a user who
      // cannot see the panel behind a toast cannot undo the one they did not
      // want unless the toast named it. "Auto tone" repeats the button that was
      // pressed, so the toast and the control it came from agree; the labels
      // come from `ADJUST_SPEC_BY_KEY`, which is the same table the panel's dials
      // are labelled from, so the toast cannot call a slider something the panel
      // does not.
      const moved = autoChangedKeys(before, { ...before, ...partial })
      pushToast(
        moved.length === 0
          ? 'Auto found nothing to change'
          : `Auto tone set ${moved.map((key) => ADJUST_SPEC_BY_KEY[key].label).join(', ')}`,
        moved.length === 0 ? 'info' : 'success',
      )
    } catch {
      pushToast('Auto could not be applied', 'error')
    }
  }, [pushToast, source])

  const handleCopyEdits = useCallback(async () => {
    const result: RecipeWrite = await writeClipboardRecipe(useDocStore.getState().present)
    if (result === 'clipboard' || result === 'local') setCanPaste(true)
    if (result === 'too-large') pushToast('Too many edits to copy as text', 'error')
    else if (result === 'local')
      pushToast('Clipboard blocked — edits copied inside this app only', 'info')
    else if (result === 'unavailable') pushToast('Clipboard blocked — nothing was copied', 'error')
    else pushToast('Edits copied to the clipboard', 'success')
  }, [pushToast])

  const handlePasteEdits = useCallback(async () => {
    const raw = await readClipboardRecipe()
    const next = raw ? applyRecipe(useDocStore.getState().present, raw) : null
    if (!next) {
      pushToast('Nothing to paste', 'error')
      return
    }
    useDocStore.getState().update(() => next, { key: 'paste' })
    pushToast('Edits pasted', 'success')
  }, [pushToast])

  const handleOpenPresets = useCallback(() => {
    setPresetNames(listPresets())
    setPresetName('')
    setPresetOpen(true)
  }, [])

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim()
    const result: PresetResult = savePreset(name, useDocStore.getState().present)
    setPresetNames(listPresets())
    if (result === 'ok') {
      setPresetOpen(false)
      setPresetName('')
      pushToast(`Saved “${name}”`, 'success')
      return
    }
    pushToast(
      result === 'invalid-name'
        ? 'Give the preset a name of up to 40 characters'
        : result === 'too-large'
          ? 'That preset is too large to save'
          : 'This browser blocked preset storage',
      'error',
    )
  }, [presetName, pushToast])

  const handleApplyPreset = useCallback(
    (name: string) => {
      const next = applyPreset(name, useDocStore.getState().present)
      if (!next) {
        pushToast(`“${name}” could not be applied`, 'error')
        return
      }
      useDocStore.getState().update(() => next, { key: 'paste' })
      setPresetOpen(false)
      pushToast(`Applied “${name}”`, 'success')
    },
    [pushToast],
  )

  const handleDeletePreset = useCallback(
    async (name: string) => {
      // A preset is a recipe the user typed, it lives only in this browser's
      // `localStorage`, and applying it is an *edit* — so it is one undo step and
      // this delete is permanent with no history to reach for. It asks for that
      // reason, and unlike "Reset all edits" it also asks because there is no undo
      // answer at all.
      await confirmThen(deletePresetRequest(name), () => {
        deletePreset(name)
        setPresetNames(listPresets())
        pushToast(`Deleted “${name}”`, 'info')
      })
    },
    [pushToast],
  )

  useKeyboardShortcuts({
    onExport: () => useUiStore.getState().setActiveTool('export'),
    onCommit: () => useUiStore.getState().setActiveTool(null),
    onCancel: () => useUiStore.getState().setActiveTool(null),
  })

  const openExport = useCallback(() => {
    if (!useUiStore.getState().activeTool) useUiStore.getState().setActiveTool('export')
  }, [])

  return (
    <div className={styles.editor}>
      {/* The canvas and the import screen are the page's primary content, and
          without a `main` the header and the tool nav are the only landmarks a
          screen reader can jump between — the same gap the Hub got a skip link
          for in D8-F14. */}
      <a className={styles.skipLink} href="#editor-main">
        Skip to the canvas
      </a>
      <JobProgressBar />
      {entry.action !== 'open' || !source ? (
        <>
          <header className={styles.topBar}>
            <IconButton label="Back to home" onClick={() => navigate('/')}>
              <CloseGlyph />
            </IconButton>
            <span className={styles.topBarTitle}>New image</span>
            <span style={{ width: 'var(--ie-tap)' }} />
          </header>
          <main className={styles.editorMain} id="editor-main" tabIndex={-1}>
            <div aria-busy={pending}>
              <ImportScreen
                onFile={handleFile}
                onSample={handleSample}
                error={error}
                // The pending sentence is rendered by `ImportScreen`, next to the
                // drop zone the user pressed. It used to be a sibling of
                // `<main>` right here, which on a viewport-height import screen
                // put it below the fold with nothing to scroll to: a decode that
                // takes seconds on a phone photo, announced to nobody.
                pending={pending}
                resume={
                  resume ? (
                    <ResumeSessionCard
                      thumbnailUrl={resume.thumb}
                      updatedAt={resume.updatedAt}
                      doc={resume.doc}
                      onResume={() => void handleResume()}
                      onDiscard={() => void handleDiscard()}
                    />
                  ) : undefined
                }
              />
            </div>
          </main>
        </>
      ) : (
        <>
          <EditorTopBar
            title={fileName}
            onClose={() => navigate('/')}
            onDone={openExport}
            onReset={handleReset}
            onNewImage={() => void handleNewImage()}
            onCopyEdits={() => void handleCopyEdits()}
            onPasteEdits={() => void handlePasteEdits()}
            onSavePreset={handleOpenPresets}
            onInfo={() =>
              pushToast(
                `${source.width}×${source.height} source · ${useDocStore.getState().present.layers.length} layers`,
              )
            }
            onShowHelp={() => useUiStore.getState().setShowHelp(true)}
            canPaste={canPaste}
          />
          {presetOpen && (
            <PresetPopover
              name={presetName}
              onNameChange={setPresetName}
              names={presetNames}
              onSave={handleSavePreset}
              onApply={handleApplyPreset}
              onDelete={handleDeletePreset}
              onClose={() => setPresetOpen(false)}
            />
          )}
          <OfflineBanner />
          <main className={styles.editorMain} id="editor-main" tabIndex={-1}>
            {/* The panel is a child of the canvas region, not a later sibling of
                the main. Above the 900px breakpoint that region is a two-column
                grid and the panel fills the second track; below it the panel is
                still `position: fixed` and this changes nothing. It has to live
                here rather than after `<ToolTabBar>` because the desktop panel's
                containing block is this region — the box between the two bars —
                and a sibling of `<main>` has no such box to be positioned
                against. */}
            <div className={`${styles.canvasRegion}${activeTool ? ` ${styles.withSheet}` : ''}`}>
              <EditorCanvas source={source} />
              <ToolSurface source={source} fileName={fileName} onAuto={handleAuto} />
            </div>
          </main>
          <ToolTabBar />
        </>
      )}
      <ToastStack />
      <HelpOverlay />
      {/* Mounted for the whole route rather than where it is needed: the
          confirmation is raised from a `useCallback` in a menu row, which has no
          business owning a dialog. It renders nothing until something asks. */}
      <ConfirmDialog />
    </div>
  )
}
