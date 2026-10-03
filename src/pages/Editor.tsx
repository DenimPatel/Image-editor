import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EditorCanvas } from '../components/canvas/EditorCanvas'
import { EditorTopBar } from '../components/editor/EditorTopBar'
import { HelpOverlay } from '../components/editor/HelpOverlay'
import { ImportScreen, OfflineBanner } from '../components/editor/ImportScreen'
import { JobProgressBar } from '../components/editor/JobProgressBar'
import { PresetPopover } from '../components/editor/PresetPopover'
import { ResumeSessionCard } from '../components/editor/ResumeSessionCard'
import { ToolSurface } from '../components/editor/ToolSurface'
import { ToolTabBar } from '../components/editor/ToolTabBar'
import { CloseGlyph } from '../components/ui/icons'
import { IconButton } from '../components/controls/IconButton'
import { ToastStack } from '../components/controls/Toast'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useAppearance } from '../hooks/useAppearance'
import { autoAdjust, autoChangedKeys, buildHistogram } from '../lib/auto'
import { describeUnsupported } from '../lib/accept'
import { decodeImageBlob, decodeImageFile, decodeImageUrl, ImageTooLargeError } from '../lib/decode'
import {
  attachUnloadFlush,
  createAutosave,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  type Autosave,
} from '../lib/persist/autosave'
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
  clearSession,
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
import { TOOL_IDS, useUiStore, type ToolId } from '../store/uiStore'
import styles from '../components/editor/editor.module.css'

const VALID_TOOLS = new Set<string>(TOOL_IDS)

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
  // The editor is a separate route from the Hub, and `Nav` is Hub-only, so
  // without this the editor depends entirely on the pre-paint script: a change
  // made in another tab, or by the appearance panel opening and closing, would
  // write `localStorage` correctly and then never re-read it. Mounting the hook
  // here for the whole route — rather than inside the panel, which only exists
  // while it is open — is what makes the editor a second, independent writer
  // of the same idempotent DOM attributes. It costs one `useEffect`.
  useAppearance()
  const { tool } = useParams<{ tool?: string }>()
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

  useEffect(() => {
    if (tool && VALID_TOOLS.has(tool)) useUiStore.getState().setActiveTool(tool as ToolId)
  }, [tool])

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

  const handleDiscard = useCallback(() => {
    void clearSession()
    // Discarding has to take the mirror with it: it is the only other copy of
    // the document, and leaving it behind would re-offer what was just thrown
    // away.
    clearMirror()
    setResume(null)
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
    (name: string) => {
      deletePreset(name)
      setPresetNames(listPresets())
      pushToast(`Deleted “${name}”`, 'info')
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
      {!source ? (
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
                      onDiscard={handleDiscard}
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
            onReset={() => useDocStore.getState().reset()}
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
    </div>
  )
}
