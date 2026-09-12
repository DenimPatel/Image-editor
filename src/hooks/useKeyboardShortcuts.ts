import { useEffect } from 'react';
import { rotateBy, toggleFlipH } from '../store/actions';
import { useDocStore } from '../store/docStore';
import { useUiStore, type ToolId } from '../store/uiStore';

export type ShortcutHandlers = {
  onExport?: () => void;
  onCommit?: () => void;
  onCancel?: () => void;
};

const TOOL_KEYS: Record<string, ToolId> = {
  c: 'crop',
  a: 'adjust',
  t: 'text',
  b: 'draw',
  e: 'export',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  );
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}): void {
  const { onExport, onCommit, onCancel } = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const ui = useUiStore.getState();
      const doc = useDocStore.getState();

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) doc.redo();
        else doc.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onExport?.();
        return;
      }
      if (isTypingTarget(event.target)) return;

      if (event.key === '\\') {
        ui.setCompareHeld(true);
        return;
      }
      const tool = TOOL_KEYS[event.key.toLowerCase()];
      if (tool && !meta) {
        ui.setActiveTool(tool);
        return;
      }
      switch (event.key) {
        case '[':
          rotateBy(-90);
          break;
        case ']':
          rotateBy(90);
          break;
        case 'f':
          toggleFlipH();
          break;
        case '0':
          ui.resetViewport();
          break;
        case '1':
          ui.setViewport({ scale: 1 });
          break;
        case 'Escape':
          ui.setActiveTool(null);
          onCancel?.();
          break;
        case 'Enter':
          onCommit?.();
          break;
        case '?':
          ui.setShowHelp(!ui.showHelp);
          break;
        default:
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === '\\') useUiStore.getState().setCompareHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onExport, onCommit, onCancel]);
}