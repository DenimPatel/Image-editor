import { useState } from 'react'
import { IconButton } from '../controls/IconButton'
import { AppearancePanel } from '../ui/AppearanceMenu'
import {
  CloseGlyph,
  CopyGlyph,
  InfoGlyph,
  KeyboardGlyph,
  MoreGlyph,
  NewImageGlyph,
  PasteGlyph,
  RedoGlyph,
  SaveGlyph,
  SparkleGlyph,
  UndoGlyph,
} from '../ui/icons'
import { useMenuPopover } from '../ui/useMenuPopover'
import { newImageBlockedReason } from '../../lib/editorEntry'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import styles from './editor.module.css'

export type EditorTopBarProps = {
  title: string
  onClose: () => void
  onDone: () => void
  onReset: () => void
  onCopyEdits: () => void
  onPasteEdits: () => void
  onSavePreset: () => void
  onInfo: () => void
  onShowHelp: () => void
  canPaste: boolean
  /** Hand the document back to the import screen. Confirmed by the caller. */
  onNewImage: () => void
}

export function EditorTopBar({
  title,
  onClose,
  onDone,
  onReset,
  onCopyEdits,
  onPasteEdits,
  onSavePreset,
  onInfo,
  onShowHelp,
  canPaste,
  onNewImage,
}: EditorTopBarProps) {
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const canUndo = useDocStore((state) => state.past.length > 0)
  const canRedo = useDocStore((state) => state.future.length > 0)
  const undo = useDocStore((state) => state.undo)
  const redo = useDocStore((state) => state.redo)
  const exportBusy = useUiStore((state) => state.exportBusy)
  // Stays in the menu when it cannot be pressed, with the reason attached. A row
  // that vanishes while an export runs teaches the user that the menu is unreliable
  // and teaches them nothing about what they are waiting for.
  const newImageBlocked = newImageBlockedReason(exportBusy)
  // The popover is rendered as a sibling of the <header>, not inside it: the
  // header is a stacking context and the desktop inspector is above it.
  //
  // Marks on every row and groups between them, which is what the audit asked for
  // and the reason is the same in both cases: undifferentiated words in one column
  // make a reader read the whole column to find one row. The order is the menu's
  // own contents speaking — the editor's settings, then the one row that replaces
  // the document, then this document's edits — and the marks are the difference
  // between a menu you scan and a menu you read. `group` and `icon` are both
  // optional in `MenuItem`, and every row here has a true mark rather than a
  // borrowed one; a row with nothing that names it keeps nothing, because a wrong
  // glyph is a claim about what the row does.
  const { triggerRef, triggerProps, popover } = useMenuPopover({
    label: 'More options',
    items: [
      {
        id: 'help',
        label: 'Keyboard shortcuts',
        onSelect: onShowHelp,
        icon: KeyboardGlyph,
        group: 'editor',
      },
      {
        id: 'appearance',
        label: 'Appearance…',
        // Selecting an item closes the menu and hands focus back to its trigger,
        // and the panel captures whatever holds focus at the moment it opens. So
        // the trigger is the thing focus comes back to when the panel closes.
        onSelect: () => setAppearanceOpen(true),
        icon: SparkleGlyph,
        group: 'editor',
      },
      {
        // Its own group, between the editor's settings and this document's edits,
        // because it is the only row that is about neither: it does not change the
        // photo and it is not an edit to it, it *replaces* the document. Filed with
        // the edits it would have read as another thing you can do to this picture;
        // filed with the settings it would have read as a preference. The separator
        // above and below it is the menu saying so.
        id: 'new-image',
        label: 'New image',
        onSelect: onNewImage,
        icon: NewImageGlyph,
        group: 'photo',
        disabled: newImageBlocked !== null,
        description: newImageBlocked ?? undefined,
      },
      {
        id: 'reset',
        label: 'Reset all edits',
        onSelect: onReset,
        // Undo, not Trash: "Reset all edits" throws away the undo history rather than
        // deleting a layer, and `TrashGlyph` is the layer row's mark in the Layers
        // panel. Reusing it would have the two disagreeing about the same word.
        icon: UndoGlyph,
        group: 'edits',
      },
      { id: 'copy', label: 'Copy edits', onSelect: onCopyEdits, icon: CopyGlyph, group: 'edits' },
      {
        id: 'paste',
        label: 'Paste edits',
        onSelect: onPasteEdits,
        disabled: !canPaste,
        icon: PasteGlyph,
        group: 'edits',
      },
      {
        id: 'preset',
        label: 'Save preset…',
        onSelect: onSavePreset,
        icon: SaveGlyph,
        group: 'edits',
      },
      // "Info" was the whole label, and it named no *what*. The action answers
      // "how big is this and how much is on top of it", which is a property of
      // the photo, so the label says which one. It sits with the editor's own rows
      // rather than with the edits because it reads the document rather than
      // changing it.
      { id: 'info', label: 'Photo details', onSelect: onInfo, icon: InfoGlyph, group: 'editor' },
    ],
  })

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
        <span
          className={styles.topBarTitle}
          /* The bar is 360px and five `--ie-tap` controls plus a word of "Done" are
           276 of the 344px inside it, so at Roomy density with Extra-large text
           the name has 52px of the 75px it needs and `text-overflow` cuts it from
           the right: "Sample 1" read as "Sa…", four characters of a name that is
           not four characters long. The fix has to be in the markup rather than
           the sheet, because the alternative is to make the whole name fit — and
           it does not: measured, showing all 75px pushes the right-hand group to
           x=375 in a 360px viewport, so the primary action leaves the screen.
           Truncating from the *start* keeps the characters that identify a file,
           which live in its tail — "IMG_4821.HEIC" shares its head with every
           other "IMG_" and differs at the end, and so does "Screenshot 2026-10-02
           at 14.33.05.png". So the ellipsis goes on the left, the same text is
           still the element's whole accessible name, and `title` carries it to a
           pointer as well. `<bdi>` is load-bearing rather than decorative: it
           isolates the name from the box's own direction, so a name written
           right-to-left is laid out in its own direction inside an RTL line box
           rather than reversed. `textAlign` is pinned in the stylesheet because the
           rule centres, and a centred line in an RTL box is clipped at *both* ends
           — which is the one outcome with no characters in it at all.

           `direction` moved out of this inline style and into `.topBarTitle` for
           the reason in that rule: an inline style cannot be undone by a media
           query, and the audit found the front ellipsis landing beside the overflow
           button's own three dots on a narrow phone at Extra-large text, so
           "…le 2" read as part of the menu. Under 420px the stylesheet flips the
           box to LTR and the ellipsis falls at the end, clear of the dots, while
           the long-filename behaviour above is untouched above that width.
           `e2e/journey.panel-seams.spec.ts` asserts the computed direction at both
           ends of the range, because jsdom has no idea what `direction: rtl` does. */
          title={title}
        >
          <bdi>{title}</bdi>
        </span>
        <div className={styles.topBarGroup}>
          <span ref={triggerRef}>
            <IconButton label="More options" {...triggerProps}>
              <MoreGlyph />
            </IconButton>
          </span>
          <button type="button" className={styles.doneButton} onClick={onDone}>
            Done
          </button>
        </div>
      </header>
      {popover}
      <AppearancePanel
        open={appearanceOpen}
        surface="editor"
        onClose={() => setAppearanceOpen(false)}
      />
    </>
  )
}
