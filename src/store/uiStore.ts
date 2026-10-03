import { create } from 'zustand'

/**
 * Non-undoable UI state, deliberately separate from the document so undo
 * never moves the viewport or changes the active tool, and persistence only
 * ever serializes `doc`.
 */

export type ToolId =
  | 'crop'
  | 'adjust'
  | 'filters'
  | 'retouch'
  | 'background'
  | 'text'
  | 'draw'
  | 'stickers'
  | 'redact'
  | 'frame'
  | 'layers'
  | 'passport'
  | 'export'

export const TOOL_IDS: ToolId[] = [
  'crop',
  'adjust',
  'filters',
  'retouch',
  'background',
  'text',
  'draw',
  'stickers',
  'redact',
  'frame',
  'layers',
  'passport',
  'export',
]

export type SheetDetent = 'peek' | 'medium' | 'large'

export type SafeAreaPreset = 'none' | 'story' | 'reel' | 'youtube'

export type Job = {
  id: string
  label: string
  progress: number
  status: 'running' | 'done' | 'error' | 'cancelled'
}

export type Toast = {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
}

/**
 * An error-severity toast, kept past the toast.
 *
 * `ToastStack` dismisses every toast after 3.2 s, which is right for "Exported"
 * and wrong for "Storage is full — this session was not saved": that sentence
 * is the only evidence the user will ever have of losing a session, and it used
 * to disappear before they could read it, let alone write it down. These are
 * the error toasts alone — nothing here persists a success or a hint — written
 * to `localStorage` so they survive a reload, which is the moment somebody
 * actually notices they have lost work.
 *
 * The bounds are the point. It lives in the user's own storage, so it is
 * capped in count, capped in age, versioned so a future shape change is
 * discardable rather than a crash, and clearable by the reader with one
 * button. A record a user cannot delete is a record the product should not
 * keep.
 */
export const ERROR_LOG_KEY = 'image-editor-error-log'
export const ERROR_LOG_VERSION = 1
export const ERROR_LOG_MAX_ENTRIES = 20
/** A week. Long enough to be found, short enough not to be an archive. */
export const ERROR_LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type LoggedError = {
  /** The toast's own id, so a saved record can be matched to what was seen. */
  id: string
  message: string
  at: number
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Safari private mode throws a SecurityError on any storage access.
    return null
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    // A refused or full store is a legitimate state, not an error to raise:
    // the toast still happened, and the report is still reachable.
    return false
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do: the reader's storage is already refusing us.
  }
}

function isLoggedError(value: unknown): value is LoggedError {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { id?: unknown; message?: unknown; at?: unknown }
  return (
    typeof record.id === 'string' &&
    typeof record.message === 'string' &&
    typeof record.at === 'number' &&
    Number.isFinite(record.at)
  )
}

/**
 * Read the saved errors, discarding anything malformed, expired or written by
 * another version.
 *
 * Every failure mode collapses to `[]` rather than propagating: this runs while
 * the store is being created, and a store that cannot be created because a
 * stored string is odd is a white screen at boot.
 */
export function readErrorLog(): LoggedError[] {
  const raw = safeGet(ERROR_LOG_KEY)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const record = parsed as { v?: unknown; entries?: unknown }
  if (record.v !== ERROR_LOG_VERSION || !Array.isArray(record.entries)) return []
  const now = Date.now()
  return record.entries
    .filter(isLoggedError)
    .filter((entry) => entry.at <= now && now - entry.at < ERROR_LOG_TTL_MS)
    .slice(-ERROR_LOG_MAX_ENTRIES)
}

function appendLoggedError(log: LoggedError[], toast: Toast): LoggedError[] {
  return [...log, { id: toast.id, message: toast.message, at: Date.now() }].slice(
    -ERROR_LOG_MAX_ENTRIES,
  )
}

function persistErrorLog(log: LoggedError[]): void {
  safeSet(ERROR_LOG_KEY, JSON.stringify({ v: ERROR_LOG_VERSION, entries: log }))
}

export type Viewport = {
  scale: number
  x: number
  y: number
}

export type UiStore = {
  activeTool: ToolId | null
  sheetDetent: SheetDetent
  viewport: Viewport
  compareHeld: boolean
  selectedLayerId: string | null
  selectedAdjustKey: string | null
  safeArea: SafeAreaPreset
  jobs: Job[]
  toasts: Toast[]
  /** Error toasts that outlived the 3.2 s dismissal. See `ERROR_LOG_KEY`. */
  errorLog: LoggedError[]
  showHelp: boolean

  setActiveTool: (tool: ToolId | null) => void
  setSheetDetent: (detent: SheetDetent) => void
  setViewport: (viewport: Partial<Viewport>) => void
  resetViewport: () => void
  setCompareHeld: (held: boolean) => void
  selectLayer: (id: string | null) => void
  selectAdjustKey: (key: string | null) => void
  setSafeArea: (preset: SafeAreaPreset) => void
  startJob: (job: Job) => void
  updateJob: (id: string, patch: Partial<Job>) => void
  finishJob: (id: string, status: Job['status']) => void
  pushToast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  clearErrorLog: () => void
  setShowHelp: (show: boolean) => void
}

const DEFAULT_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 }

/**
 * A reported progress into `0..1`.
 *
 * `NaN` and an infinite value are 0 rather than themselves: a progress bar
 * whose width is `NaN%` is an unrenderable bar, and a producer that computed one
 * has already said something wrong. Clamping here means the bar is always
 * drawable without the component having to know that was possible.
 */
function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

let toastCounter = 0

export const useUiStore = create<UiStore>((set) => ({
  activeTool: null,
  sheetDetent: 'medium',
  viewport: DEFAULT_VIEWPORT,
  compareHeld: false,
  selectedLayerId: null,
  selectedAdjustKey: 'exposure',
  safeArea: 'none',
  jobs: [],
  toasts: [],
  errorLog: readErrorLog(),
  showHelp: false,

  setActiveTool: (activeTool) => set({ activeTool }),
  setSheetDetent: (sheetDetent) => set({ sheetDetent }),
  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  resetViewport: () => set({ viewport: DEFAULT_VIEWPORT }),
  setCompareHeld: (compareHeld) => set({ compareHeld }),
  selectLayer: (selectedLayerId) => set({ selectedLayerId }),
  selectAdjustKey: (selectedAdjustKey) => set({ selectedAdjustKey }),
  setSafeArea: (safeArea) => set({ safeArea }),

  startJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  // Progress is monotonic and in range, enforced here rather than at the call
  // sites. `matting.ts` reports `total > 0 ? current / total : 0`, so the
  // second event to arrive before a total is known reports `0` after an earlier
  // event reported `0.5` — and a bar that jumps backwards is a progress bar
  // that has stopped meaning anything.
  //
  // The clamp lives in the data layer rather than in `JobProgressBar` for the
  // same reason: a `setState` in an effect to paper over a rewind would be a
  // second source of truth for the same number, and the next consumer of
  // `jobs` would read the unwound one. Every producer gets the rule for free and
  // none can forget it.
  updateJob: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) => {
        if (job.id !== id) return job
        const next = { ...job, ...patch }
        return patch.progress === undefined
          ? next
          : { ...next, progress: Math.max(job.progress, clampProgress(patch.progress)) }
      }),
    })),
  finishJob: (id, status) =>
    set((state) => ({ jobs: state.jobs.map((job) => (job.id === id ? { ...job, status } : job)) })),

  pushToast: (message, tone = 'info') => {
    toastCounter += 1
    const toast: Toast = { id: `toast_${toastCounter}`, message, tone }
    // Only error severity is kept, and it is kept *before* the store is told,
    // so a save that fails and then throws still leaves the sentence behind.
    const logged =
      tone === 'error' ? appendLoggedError(useUiStore.getState().errorLog, toast) : null
    if (logged) persistErrorLog(logged)
    set((state) => ({ toasts: [...state.toasts, toast], errorLog: logged ?? state.errorLog }))
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  // The reader's storage, so the reader deletes it. No confirmation and no
  // grace period: a "are you sure" on the only control that removes data the
  // app kept about them is the wrong kind of caution.
  clearErrorLog: () => {
    safeRemove(ERROR_LOG_KEY)
    set({ errorLog: [] })
  },
  setShowHelp: (showHelp) => set({ showHelp }),
}))
