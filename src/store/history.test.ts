import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  beginInteraction,
  COALESCE_MS,
  createHistory,
  endInteraction,
  initialInteraction,
  MAX_HISTORY,
  redo,
  undo,
} from './history';

type State = { value: number };

describe('history engine', () => {
  it('applies an edit and tracks it as one undoable step', () => {
    const h0 = createHistory<State>({ value: 0 });
    const { history } = applyEdit(h0, initialInteraction, { value: 1 });
    expect(history.present).toEqual({ value: 1 });
    expect(history.past).toEqual([{ value: 0 }]);
    expect(history.future).toEqual([]);
  });

  it('undoes and redoes a step', () => {
    const h0 = createHistory<State>({ value: 0 });
    const step = applyEdit(h0, initialInteraction, { value: 1 }).history;
    const undone = undo(step).history;
    expect(undone.present).toEqual({ value: 0 });
    expect(undone.past).toEqual([]);
    const redone = redo(undone).history;
    expect(redone.present).toEqual({ value: 1 });
  });

  it('does nothing on undo with empty history', () => {
    const h0 = createHistory<State>({ value: 0 });
    const result = undo(h0);
    expect(result.history).toBe(h0);
  });

  it('caps past at MAX_HISTORY entries', () => {
    let history = createHistory<State>({ value: 0 });
    for (let i = 1; i <= MAX_HISTORY + 20; i += 1) {
      history = applyEdit(history, initialInteraction, { value: i }).history;
    }
    expect(history.past).toHaveLength(MAX_HISTORY);
    // Newest 50 are retained.
    expect(history.past[0]).toEqual({ value: MAX_HISTORY + 20 - MAX_HISTORY });
    expect(history.past[MAX_HISTORY - 1]).toEqual({ value: MAX_HISTORY + 19 });
  });

  it('collapses 40 transient updates in one interaction to exactly one past entry', () => {
    const h0 = createHistory<State>({ value: 0 });
    let interaction = beginInteraction(initialInteraction, 'brightness');
    let history = h0;
    for (let i = 1; i <= 40; i += 1) {
      const result = applyEdit(history, interaction, { value: i }, { transient: true });
      history = result.history;
      interaction = result.interaction;
    }
    interaction = endInteraction(interaction);
    expect(interaction.key).toBeNull();
    expect(history.past).toHaveLength(1);
    expect(history.past[0]).toEqual({ value: 0 });
    expect(history.present).toEqual({ value: 40 });
  });

  it('starts a fresh undo step after an interaction ends', () => {
    let history = createHistory<State>({ value: 0 });
    let interaction = beginInteraction(initialInteraction, 'crop');
    ({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { transient: true }));
    interaction = endInteraction(interaction);
    ({ history } = applyEdit(history, interaction, { value: 2 }));
    expect(history.past).toEqual([{ value: 0 }, { value: 1 }]);
  });

  it('coalesces same-key commits within the window', () => {
    let history = createHistory<State>({ value: 0 });
    let interaction = initialInteraction;
    ({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { key: 'x', now: 0 }));
    ({ history } = applyEdit(history, interaction, { value: 2 }, { key: 'x', now: 100 }));
    expect(history.past).toHaveLength(1);
    expect(history.present).toEqual({ value: 2 });
  });

  it('starts a new entry after the coalesce window', () => {
    let history = createHistory<State>({ value: 0 });
    let interaction = initialInteraction;
    ({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { key: 'x', now: 0 }));
    ({ history } = applyEdit(history, interaction, { value: 2 }, { key: 'x', now: COALESCE_MS + 1 }));
    expect(history.past).toHaveLength(2);
  });

  it('does not merge different coalesce keys', () => {
    let history = createHistory<State>({ value: 0 });
    let interaction = initialInteraction;
    ({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { key: 'x', now: 0 }));
    ({ history } = applyEdit(history, interaction, { value: 2 }, { key: 'y', now: 100 }));
    expect(history.past).toHaveLength(2);
  });

  it('ignores a no-op edit', () => {
    const h0 = createHistory<State>({ value: 0 });
    const result = applyEdit(h0, initialInteraction, h0.present);
    expect(result.history).toBe(h0);
  });
});
