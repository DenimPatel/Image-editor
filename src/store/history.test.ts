import { describe, expect, it } from 'vitest'
import {
  applyEdit,
  beginInteraction,
  canRedo,
  canUndo,
  COALESCE_MS,
  createHistory,
  endInteraction,
  initialInteraction,
  MAX_HISTORY,
  redo,
  undo,
} from './history'

type State = { value: number }

describe('history engine', () => {
  it('applies an edit and tracks it as one undoable step', () => {
    const h0 = createHistory<State>({ value: 0 })
    const { history } = applyEdit(h0, initialInteraction, { value: 1 })
    expect(history.present).toEqual({ value: 1 })
    expect(history.past).toEqual([{ value: 0 }])
    expect(history.future).toEqual([])
  })

  it('undoes and redoes a step', () => {
    const h0 = createHistory<State>({ value: 0 })
    const step = applyEdit(h0, initialInteraction, { value: 1 }).history
    const undone = undo(step).history
    expect(undone.present).toEqual({ value: 0 })
    expect(undone.past).toEqual([])
    const redone = redo(undone).history
    expect(redone.present).toEqual({ value: 1 })
  })

  it('does nothing on undo with empty history', () => {
    const h0 = createHistory<State>({ value: 0 })
    const result = undo(h0)
    expect(result.history).toBe(h0)
  })

  it('caps past at MAX_HISTORY entries', () => {
    let history = createHistory<State>({ value: 0 })
    for (let i = 1; i <= MAX_HISTORY + 20; i += 1) {
      history = applyEdit(history, initialInteraction, { value: i }).history
    }
    expect(history.past).toHaveLength(MAX_HISTORY)
    // Newest 50 are retained.
    expect(history.past[0]).toEqual({ value: MAX_HISTORY + 20 - MAX_HISTORY })
    expect(history.past[MAX_HISTORY - 1]).toEqual({ value: MAX_HISTORY + 19 })
  })

  it('collapses 40 updates in one interaction to exactly one past entry', () => {
    const h0 = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'brightness')
    let history = h0
    for (let i = 1; i <= 40; i += 1) {
      const result = applyEdit(history, interaction, { value: i })
      history = result.history
      interaction = result.interaction
    }
    interaction = endInteraction(interaction)
    expect(interaction.key).toBeNull()
    expect(history.past).toHaveLength(1)
    expect(history.past[0]).toEqual({ value: 0 })
    expect(history.present).toEqual({ value: 40 })
  })

  it('starts a fresh undo step after an interaction ends', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'crop')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 1 }))
    interaction = endInteraction(interaction)
    ;({ history } = applyEdit(history, interaction, { value: 2 }))
    expect(history.past).toEqual([{ value: 0 }, { value: 1 }])
  })

  it('coalesces same-key commits within the window', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 1 },
      { key: 'x', now: 0 },
    ))
    ;({ history } = applyEdit(history, interaction, { value: 2 }, { key: 'x', now: 100 }))
    expect(history.past).toHaveLength(1)
    expect(history.present).toEqual({ value: 2 })
  })

  it('starts a new entry after the coalesce window', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 1 },
      { key: 'x', now: 0 },
    ))
    ;({ history } = applyEdit(
      history,
      interaction,
      { value: 2 },
      { key: 'x', now: COALESCE_MS + 1 },
    ))
    expect(history.past).toHaveLength(2)
  })

  it('does not merge different coalesce keys', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 1 },
      { key: 'x', now: 0 },
    ))
    ;({ history } = applyEdit(history, interaction, { value: 2 }, { key: 'y', now: 100 }))
    expect(history.past).toHaveLength(2)
  })

  it('ignores a no-op edit', () => {
    const h0 = createHistory<State>({ value: 0 })
    const result = applyEdit(h0, initialInteraction, h0.present)
    expect(result.history).toBe(h0)
  })
})

describe('redo invalidation', () => {
  it('empties future when a real edit lands on top of a redo stack', () => {
    let history = createHistory<State>({ value: 0 })
    history = applyEdit(history, initialInteraction, { value: 1 }).history
    history = applyEdit(history, initialInteraction, { value: 2 }).history
    history = undo(history).history
    expect(history.future).toEqual([{ value: 2 }])
    expect(canRedo(history)).toBe(true)

    const branched = applyEdit(history, initialInteraction, { value: 9 }, { now: 10_000 })
    expect(branched.history.future).toEqual([])
    expect(canRedo(branched.history)).toBe(false)
    expect(branched.history.present).toEqual({ value: 9 })
  })

  it('keeps future intact when a no-op edit lands on top of it', () => {
    let history = createHistory<State>({ value: 0 })
    history = applyEdit(history, initialInteraction, { value: 1 }).history
    const undone = undo(history).history
    const noop = applyEdit(undone, initialInteraction, undone.present, { now: 10_000 })
    expect(noop.history.future).toEqual([{ value: 1 }])
  })

  it('empties future for a transient edit too — the document moved on', () => {
    let history = createHistory<State>({ value: 0 })
    history = applyEdit(history, initialInteraction, { value: 1 }).history
    const undone = undo(history).history
    const transient = applyEdit(undone, initialInteraction, { value: 7 }, { transient: true })
    expect(transient.history.future).toEqual([])
  })

  it('reports canUndo/canRedo across a full round trip', () => {
    let history = createHistory<State>({ value: 0 })
    expect(canUndo(history)).toBe(false)
    history = applyEdit(history, initialInteraction, { value: 1 }).history
    expect(canUndo(history)).toBe(true)
    history = undo(history).history
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(true)
    expect(redo(history).history.present).toEqual({ value: 1 })
  })

  it('undoes every retained step to empty and redoes them all back', () => {
    let history = createHistory<State>({ value: 0 })
    for (let i = 1; i <= MAX_HISTORY; i += 1) {
      history = applyEdit(history, initialInteraction, { value: i }, { now: i * 10_000 }).history
    }
    for (let i = 0; i < MAX_HISTORY; i += 1) history = undo(history).history
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(MAX_HISTORY)
    for (let i = 0; i < MAX_HISTORY; i += 1) history = redo(history).history
    expect(history.future).toHaveLength(0)
    expect(history.present).toEqual({ value: MAX_HISTORY })
  })
})

describe('explicit interaction spans', () => {
  it('pushes one entry for 30 mutations and a second after the span closes', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'a')
    expect(interaction.key).toBe('a')
    for (let i = 1; i <= 30; i += 1) {
      const result = applyEdit(history, interaction, { value: i }, { now: i })
      history = result.history
      interaction = result.interaction
      expect(history.past).toHaveLength(1)
    }
    interaction = endInteraction(interaction)
    history = applyEdit(history, interaction, { value: 31 }, { now: 10_000 }).history
    expect(history.past).toEqual([{ value: 0 }, { value: 30 }])
  })

  it('does not count interaction time against the coalesce window', () => {
    // A three-second drag: the interaction span is what collapses it, and the
    // key is irrelevant while a span is open.
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'a')
    for (let i = 1; i <= 5; i += 1) {
      const result = applyEdit(history, interaction, { value: i }, { key: 'a', now: i * 1000 })
      history = result.history
      interaction = result.interaction
    }
    expect(history.past).toHaveLength(1)
  })

  it('ignores the implicit key entirely inside an open span', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'a')
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 1 },
      { key: 'x', now: 0 },
    ))
    expect(interaction.lastKey).toBeNull()
    history = applyEdit(history, interaction, { value: 2 }, { key: 'y', now: 10_000 }).history
    expect(history.past).toHaveLength(1)
  })

  it('restarts the step for a second span with the same key', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'crop')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { now: 0 }))
    interaction = endInteraction(interaction)
    interaction = beginInteraction(interaction, 'crop')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 2 }, { now: 0 }))
    expect(interaction.key).toBe('crop')
    expect(history.past).toEqual([{ value: 0 }, { value: 1 }])
  })

  it('does not unlock a second entry when one span is nested inside another', () => {
    // The print-size crop chip opens `print:size` and then an `applyAspect`
    // span of its own; together they are still one user gesture.
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'print:size')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { now: 0 }))
    interaction = beginInteraction(interaction, 'crop:preset')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 2 }, { now: 0 }))
    ;({ history } = applyEdit(history, interaction, { value: 3 }, { now: 0 }))
    expect(history.past).toEqual([{ value: 0 }])
    expect(history.present).toEqual({ value: 3 })
  })

  it('still restarts the entry when a span begins after another closed', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = beginInteraction(initialInteraction, 'outer')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 1 }, { now: 0 }))
    interaction = endInteraction(interaction)
    interaction = beginInteraction(interaction, 'outer')
    ;({ history, interaction } = applyEdit(history, interaction, { value: 2 }, { now: 0 }))
    expect(interaction.pastPushed).toBe(true)
    expect(history.past).toEqual([{ value: 0 }, { value: 1 }])
  })

  it('undo closes an open span so the next edit pushes its own entry', () => {
    let history = createHistory<State>({ value: 0 })
    const interaction = beginInteraction(initialInteraction, 'crop')
    history = applyEdit(history, interaction, { value: 1 }, { now: 0 }).history
    const undone = undo(history, interaction)
    expect(undone.interaction.key).toBeNull()
    const after = applyEdit(undone.history, undone.interaction, { value: 2 }, { now: 10_000 })
    expect(after.history.past).toEqual([{ value: 0 }])
  })

  it('a closed span reopens a fresh step after an undo', () => {
    let history = createHistory<State>({ value: 0 })
    history = applyEdit(history, initialInteraction, { value: 1 }, { now: 0 }).history
    const undone = undo(history)
    expect(undone.history.present).toEqual({ value: 0 })
    const branched = applyEdit(undone.history, undone.interaction, { value: 2 }, { now: 10_000 })
    expect(branched.history.future).toEqual([])
    expect(branched.history.past).toEqual([{ value: 0 }])
  })
})

describe('implicit key coalescing', () => {
  it('merges 20 same-key edits 50 ms apart into one entry', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    for (let i = 1; i <= 20; i += 1) {
      const result = applyEdit(history, interaction, { value: i }, { key: 'adjust', now: i * 50 })
      history = result.history
      interaction = result.interaction
    }
    expect(history.past).toHaveLength(1)
    expect(history.present).toEqual({ value: 20 })
  })

  it('splits 20 same-key edits 700 ms apart', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    for (let i = 1; i <= 20; i += 1) {
      const result = applyEdit(history, interaction, { value: i }, { key: 'adjust', now: i * 700 })
      history = result.history
      interaction = result.interaction
    }
    expect(history.past).toHaveLength(20)
  })

  it('treats an absent key as no coalescing at all', () => {
    let history = createHistory<State>({ value: 0 })
    for (let i = 1; i <= 30; i += 1) {
      history = applyEdit(history, initialInteraction, { value: i }, { now: i }).history
    }
    expect(history.past).toHaveLength(30)
  })

  it('breaks the window on a different key and restarts it', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 1 },
      { key: 'a', now: 0 },
    ))
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 2 },
      { key: 'b', now: 10 },
    ))
    ;({ history } = applyEdit(history, interaction, { value: 3 }, { key: 'a', now: 20 }))
    expect(history.past).toHaveLength(3)
  })
})

describe('transient edits', () => {
  it('applies without pushing a past entry', () => {
    const h0 = createHistory<State>({ value: 0 })
    const result = applyEdit(h0, initialInteraction, { value: 5 }, { transient: true })
    expect(result.history.present).toEqual({ value: 5 })
    expect(result.history.past).toEqual([])
    expect(result.history.future).toEqual([])
  })

  it('leaves coalescing state untouched so later real edits still merge', () => {
    let history = createHistory<State>({ value: 0 })
    let interaction = initialInteraction
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 1 },
      { key: 'a', now: 0 },
    ))
    ;({ history, interaction } = applyEdit(
      history,
      interaction,
      { value: 2 },
      { transient: true, now: 10 },
    ))
    history = applyEdit(history, interaction, { value: 3 }, { key: 'a', now: 20 }).history
    expect(history.past).toEqual([{ value: 0 }])
    expect(history.present).toEqual({ value: 3 })
  })

  it('does not mark the enclosing interaction as pushed', () => {
    let history = createHistory<State>({ value: 0 })
    const interaction = beginInteraction(initialInteraction, 'export')
    const result = applyEdit(history, interaction, { value: 1 }, { transient: true })
    expect(result.interaction.pastPushed).toBe(false)
    history = applyEdit(result.history, result.interaction, { value: 2 }, { now: 10_000 }).history
    // The span's single undo entry is taken at the first non-transient change,
    // so undoing it returns to the transient value, not to the span's start.
    expect(history.past).toEqual([{ value: 1 }])
  })

  it('ignores a no-op transient edit', () => {
    const h0 = createHistory<State>({ value: 0 })
    const result = applyEdit(h0, initialInteraction, h0.present, { transient: true })
    expect(result.history).toBe(h0)
  })
})
