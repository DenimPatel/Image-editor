/**
 * Pure undo/redo engine with coalescing.
 *
 * Kept free of React and zustand so it can be exhaustively unit-tested, and
 * so the same logic backs `docStore`. The engine never mutates its inputs.
 */

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
};

export const MAX_HISTORY = 50;
export const COALESCE_MS = 600;

/**
 * Transient coalescing state. An "interaction" is an explicit begin/end span
 * (e.g. a dial drag): the first mutation pushes one past entry and every
 * later mutation in the span only replaces `present`, so 40 pointermove
 * events across one drag become a single undo step.
 */
export type InteractionState = {
  key: string | null;
  pastPushed: boolean;
  lastKey: string | null;
  lastAt: number;
};

export const initialInteraction: InteractionState = {
  key: null,
  pastPushed: false,
  lastKey: null,
  lastAt: 0,
};

export type EditOptions = {
  key?: string | null;
  transient?: boolean;
  now?: number;
};

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

function pushPast<T>(past: T[], present: T): T[] {
  return [...past, present].slice(-MAX_HISTORY);
}

export function beginInteraction(interaction: InteractionState, key: string): InteractionState {
  return { ...interaction, key, pastPushed: false };
}

export function endInteraction(interaction: InteractionState): InteractionState {
  return { ...interaction, key: null, pastPushed: false, lastKey: null };
}

/**
 * Apply a new present value, deciding whether it starts a new undo step.
 * Returns the next history + interaction state (both new objects).
 */
export function applyEdit<T>(
  history: History<T>,
  interaction: InteractionState,
  next: T,
  options: EditOptions = {},
): { history: History<T>; interaction: InteractionState } {
  if (Object.is(next, history.present)) {
    return { history, interaction };
  }

  const now = options.now ?? Date.now();
  const key = options.key ?? null;

  let shouldPush: boolean;
  if (interaction.key !== null) {
    // Inside an explicit interaction: push only the first mutation.
    shouldPush = !interaction.pastPushed;
  } else {
    const merging =
      key !== null && interaction.lastKey === key && now - interaction.lastAt < COALESCE_MS;
    shouldPush = !merging;
  }

  const historyNext: History<T> = {
    past: shouldPush ? pushPast(history.past, history.present) : history.past,
    present: next,
    future: [],
  };

  const interactionNext: InteractionState = {
    ...interaction,
    pastPushed: interaction.key !== null ? true : interaction.pastPushed,
    lastKey: interaction.key !== null ? null : key,
    lastAt: now,
  };

  return { history: historyNext, interaction: interactionNext };
}

export function undo<T>(
  history: History<T>,
  interaction: InteractionState = initialInteraction,
): { history: History<T>; interaction: InteractionState } {
  if (history.past.length === 0) {
    return { history, interaction: endInteraction(interaction) };
  }
  const previous = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    },
    interaction: endInteraction(interaction),
  };
}

export function redo<T>(
  history: History<T>,
  interaction: InteractionState = initialInteraction,
): { history: History<T>; interaction: InteractionState } {
  if (history.future.length === 0) {
    return { history, interaction: endInteraction(interaction) };
  }
  const [next, ...rest] = history.future;
  return {
    history: {
      past: pushPast(history.past, history.present),
      present: next,
      future: rest,
    },
    interaction: endInteraction(interaction),
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}