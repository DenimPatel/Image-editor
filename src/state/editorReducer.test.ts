import { describe, expect, it } from 'vitest';
import { historyReducer, initialHistory, initialEditorState } from './editorReducer';

describe('historyReducer', () => {
  it('applies an action and tracks it as an undoable step', () => {
    const h1 = historyReducer(initialHistory, {
      type: 'APPLY',
      action: { type: 'TOGGLE_FLIP_H' },
    });
    expect(h1.present.flipH).toBe(true);
    expect(h1.past).toEqual([initialEditorState]);
    expect(h1.future).toEqual([]);
  });

  it('undoes and redoes a step', () => {
    const h1 = historyReducer(initialHistory, {
      type: 'APPLY',
      action: { type: 'TOGGLE_FLIP_H' },
    });
    const h2 = historyReducer(h1, { type: 'UNDO' });
    expect(h2.present.flipH).toBe(false);
    expect(h2.past).toEqual([]);

    const h3 = historyReducer(h2, { type: 'REDO' });
    expect(h3.present.flipH).toBe(true);
  });

  it('clears the crop when flip or rotation changes', () => {
    const withCrop = historyReducer(initialHistory, {
      type: 'APPLY',
      action: { type: 'SET_CROP', crop: { x: 0, y: 0, width: 100, height: 100 } },
    });
    expect(withCrop.present.crop).not.toBeNull();

    const afterRotate = historyReducer(withCrop, {
      type: 'APPLY',
      action: { type: 'ROTATE_BY', degrees: 90 },
    });
    expect(afterRotate.present.crop).toBeNull();
    expect(afterRotate.present.rotation).toBe(90);
  });

  it('normalizes rotation into [0, 360)', () => {
    const h1 = historyReducer(initialHistory, {
      type: 'APPLY',
      action: { type: 'ROTATE_BY', degrees: -90 },
    });
    expect(h1.present.rotation).toBe(270);
  });

  it('resets to the initial state as an undoable step', () => {
    const changed = historyReducer(initialHistory, {
      type: 'APPLY',
      action: { type: 'SET_BRIGHTNESS', value: 150 },
    });
    const reset = historyReducer(changed, { type: 'APPLY', action: { type: 'RESET' } });
    expect(reset.present).toEqual(initialEditorState);

    const undone = historyReducer(reset, { type: 'UNDO' });
    expect(undone.present.brightness).toBe(150);
  });

  it('does nothing on undo with empty history', () => {
    const h1 = historyReducer(initialHistory, { type: 'UNDO' });
    expect(h1).toBe(initialHistory);
  });
});
