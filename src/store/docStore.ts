import { create } from 'zustand';
import { createDoc } from '../model/defaults';
import { migrateDoc } from '../model/migrate';
import { activeAssetIds } from '../model/selectors';
import type { AssetId, Doc } from '../model/types';
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
} from './history';

export type DocRecipe = (doc: Doc) => Doc;

export type DocStore = History<Doc> & {
  interaction: InteractionState;
  revision: number;
  /**
   * Apply a recipe. `commit` (default) starts/merges an undo step; pass
   * `transient: true` inside an open interaction for live drags. Accepts a
   * recipe or a partial patch for convenience.
   */
  update: (recipe: DocRecipe | Partial<Doc>, options?: EditOptions) => void;
  beginInteraction: (key: string) => void;
  endInteraction: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  load: (doc: Doc) => void;
  loadUnknown: (input: unknown) => boolean;
};

const initialHistory = createHistory(createDoc());

export const useDocStore = create<DocStore>((set, get) => ({
  ...initialHistory,
  interaction: initialInteraction,
  revision: 0,

  update: (recipe, options = {}) => {
    const state = get();
    const next = typeof recipe === 'function' ? recipe(state.present) : { ...state.present, ...recipe };
    if (Object.is(next, state.present)) return;
    const result = applyEdit(
      { past: state.past, present: state.present, future: state.future },
      state.interaction,
      next,
      options,
    );
    set({
      past: result.history.past,
      present: result.history.present,
      future: result.history.future,
      interaction: result.interaction,
      revision: state.revision + 1,
    });
  },

  beginInteraction: (key) => {
    set((state) => ({ interaction: beginInteractionState(state.interaction, key) }));
  },

  endInteraction: () => {
    set((state) => ({ interaction: endInteractionState(state.interaction) }));
  },

  undo: () => {
    set((state) => {
      const result = undoHistory(
        { past: state.past, present: state.present, future: state.future },
        state.interaction,
      );
      return {
        past: result.history.past,
        present: result.history.present,
        future: result.history.future,
        interaction: result.interaction,
        revision: state.revision + 1,
      };
    });
  },

  redo: () => {
    set((state) => {
      const result = redoHistory(
        { past: state.past, present: state.present, future: state.future },
        state.interaction,
      );
      return {
        past: result.history.past,
        present: result.history.present,
        future: result.history.future,
        interaction: result.interaction,
        revision: state.revision + 1,
      };
    });
  },

  reset: () => {
    const state = get();
    const next = createDoc({ source: state.present.source, output: state.present.output });
    const result = applyEdit(
      { past: state.past, present: state.present, future: state.future },
      state.interaction,
      next,
      {},
    );
    set({
      past: result.history.past,
      present: result.history.present,
      future: result.history.future,
      interaction: result.interaction,
      revision: state.revision + 1,
    });
  },

  load: (doc) => {
    set({
      ...createHistory(doc),
      interaction: initialInteraction,
      revision: get().revision + 1,
    });
  },

  loadUnknown: (input) => {
    const doc = migrateDoc(input);
    if (!doc) return false;
    get().load(doc);
    return true;
  },
}));

/** Non-reactive read for the render loop. */
export function getDoc(): Doc {
  return useDocStore.getState().present;
}

export function getRevision(): number {
  return useDocStore.getState().revision;
}

/**
 * Asset ids reachable from the present doc *and* every undo/redo entry, so a
 * generation-based GC never closes a bitmap that undo could still need.
 */
export function liveAssetIds(): Set<AssetId> {
  const state = useDocStore.getState();
  const ids = new Set<AssetId>();
  for (const doc of [...state.past, state.present, ...state.future]) {
    for (const id of activeAssetIds(doc)) ids.add(id);
  }
  return ids;
}
