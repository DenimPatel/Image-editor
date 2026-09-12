import { useState } from 'react';
import { IconButton } from '../controls/IconButton';
import { CloseGlyph, MoreGlyph, RedoGlyph, UndoGlyph } from '../ui/editorIcons';
import { useDocStore } from '../../store/docStore';
import styles from './editor.module.css';

export type EditorTopBarProps = {
  title: string;
  onClose: () => void;
  onDone: () => void;
  onReset: () => void;
  onCopyEdits: () => void;
  onPasteEdits: () => void;
  onSavePreset: () => void;
  onInfo: () => void;
  canPaste: boolean;
};

export function EditorTopBar({
  title,
  onClose,
  onDone,
  onReset,
  onCopyEdits,
  onPasteEdits,
  onSavePreset,
  onInfo,
  canPaste,
}: EditorTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canUndo = useDocStore((state) => state.past.length > 0);
  const canRedo = useDocStore((state) => state.future.length > 0);
  const undo = useDocStore((state) => state.undo);
  const redo = useDocStore((state) => state.redo);

  return (
    <>
      <header className={styles.topBar}>
        <div className={styles.topBarGroup}>
          <IconButton label="Close editor" onClick={onClose}>
            <CloseGlyph />
          </IconButton>
          <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
            <UndoGlyph />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
            <RedoGlyph />
          </IconButton>
        </div>
        <span className={styles.topBarTitle}>{title}</span>
        <div className={styles.topBarGroup}>
          <IconButton label="More options" active={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <MoreGlyph />
          </IconButton>
          <button type="button" className={styles.doneButton} onClick={onDone}>
            Done
          </button>
        </div>
      </header>
      {menuOpen && (
        <div className={styles.moreMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onReset();
              setMenuOpen(false);
            }}
          >
            Reset all edits
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopyEdits();
              setMenuOpen(false);
            }}
          >
            Copy edits
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canPaste}
            onClick={() => {
              onPasteEdits();
              setMenuOpen(false);
            }}
          >
            Paste edits
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSavePreset();
              setMenuOpen(false);
            }}
          >
            Save preset
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onInfo();
              setMenuOpen(false);
            }}
          >
            Info
          </button>
        </div>
      )}
    </>
  );
}
