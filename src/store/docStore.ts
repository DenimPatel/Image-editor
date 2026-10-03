import { create } from 'zustand'
import { createDoc } from '../model/defaults'
import { migrateDoc } from '../model/migrate'
import { activeAssetIds } from '../model/selectors'
import type { AssetId, Doc } from '../model/types'
import {
  applyEdit,
  beginInteraction as beginInteractionState,
  createHistory,
  endInteraction as endInteractionState,
  initialInteraction,
  redo as redoHistory,
  undo as undoHistory,
  type EditOptions,
  type History,
  type InteractionState,
} from './history'

export type DocRecipe = (doc: Doc) => Doc

export type DocStore = History<Doc> & {
  interaction: InteractionState
  revision: number
  /**
   * Apply a recipe. An edit with no options starts a new undo step; a `key`
   * merges same-key edits inside `COALESCE_MS`, and `transient: true` applies
   * without becoming an undo step at all. A recipe that returns a structurally
   * identical document is ignored entirely — no history entry, no `revision`
   * bump, no autosave, no re-render.
   */
  update: (recipe: DocRecipe, options?: EditOptions) => void
  beginInteraction: (key: string) => void
  endInteraction: () => void
  undo: () => void
  redo: () => void
  reset: () => void
  load: (doc: Doc) => void
  loadUnknown: (input: unknown) => boolean
}

const initialHistory = createHistory(createDoc())

/**
 * Structural equality for the JSON-serializable `Doc`. Every action rebuilds
 * the object graph, so `Object.is` on the root never sees a no-op — tapping the
 * active aspect chip, resetting a neutral slider or `rotateBy(0)` all produce a
 * fresh-but-identical document. Walks the tree and bails on the first
 * difference, so a real change costs one comparison and an identical document
 * costs O(size) of primitive compares.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!structurallyEqual(a[index], b[index])) return false
    }
    return true
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!structurallyEqual(left[key], right[key])) return false
  }
  return true
}

function cloneSource(doc: Doc): Doc['source'] {
  return doc.source ? { ...doc.source } : null
}

function cloneOutput(doc: Doc): Doc['output'] {
  return { ...doc.output, resize: { ...doc.output.resize } }
}

export const useDocStore = create<DocStore>((set, get) => ({
  ...initialHistory,
  interaction: initialInteraction,
  revision: 0,

  update: (recipe, options = {}) => {
    const state = get()
    const next = recipe(state.present)
    if (structurallyEqual(next, state.present)) return
    const result = applyEdit(
      { past: state.past, present: state.present, future: state.future },
      state.interaction,
      next,
      options,
    )
    set({
      past: result.history.past,
      present: result.history.present,
      future: result.history.future,
      interaction: result.interaction,
      revision: state.revision + 1,
    })
  },

  beginInteraction: (key) => {
    set((state) => ({ interaction: beginInteractionState(state.interaction, key) }))
  },

  endInteraction: () => {
    set((state) => ({ interaction: endInteractionState(state.interaction) }))
  },

  undo: () => {
    set((state) => {
      const result = undoHistory(
        { past: state.past, present: state.present, future: state.future },
        state.interaction,
      )
      return {
        past: result.history.past,
        present: result.history.present,
        future: result.history.future,
        interaction: result.interaction,
        revision: state.revision + 1,
      }
    })
  },

  redo: () => {
    set((state) => {
      const result = redoHistory(
        { past: state.past, present: state.present, future: state.future },
        state.interaction,
      )
      return {
        past: result.history.past,
        present: result.history.present,
        future: result.history.future,
        interaction: result.interaction,
        revision: state.revision + 1,
      }
    })
  },

  reset: () => {
    const state = get()
    const next = createDoc({
      source: cloneSource(state.present),
      output: cloneOutput(state.present),
    })
    // Reset is its own undo step: close any open span first, and never alias
    // the incoming `source`/`output` into the entry pushed onto `past`.
    const closed = endInteractionState(state.interaction)
    const result = applyEdit(
      { past: state.past, present: state.present, future: state.future },
      closed,
      next,
      {},
    )
    set({
      past: result.history.past,
      present: result.history.present,
      future: result.history.future,
      interaction: result.interaction,
      revision: state.revision + 1,
    })
  },

  load: (doc) => {
    set({
      ...createHistory(doc),
      interaction: initialInteraction,
      revision: get().revision + 1,
    })
  },

  loadUnknown: (input) => {
    const doc = migrateDoc(input)
    if (!doc) return false
    get().load(doc)
    return true
  },
}))

/** Non-reactive read for the render loop. */
export function getDoc(): Doc {
  return useDocStore.getState().present
}

export function getRevision(): number {
  return useDocStore.getState().revision
}

/**
 * Asset ids reachable from the present doc *and* every undo/redo entry, so a
 * generation-based GC never closes a bitmap that undo could still need.
 */
export function liveAssetIds(): Set<AssetId> {
  const state = useDocStore.getState()
  const ids = new Set<AssetId>()
  for (const doc of [...state.past, state.present, ...state.future]) {
    for (const id of activeAssetIds(doc)) ids.add(id)
  }
  return ids
}
