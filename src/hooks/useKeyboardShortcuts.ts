import { useEffect, useRef } from 'react'
import { rotateBy, toggleFlipH } from '../store/actions'
import { useDocStore } from '../store/docStore'
import { useUiStore, type ToolId } from '../store/uiStore'

export type ShortcutHandlers = {
  onExport?: () => void
  onCommit?: () => void
  onCancel?: () => void
}

const TOOL_KEYS: Record<string, ToolId> = {
  c: 'crop',
  a: 'adjust',
  t: 'text',
  b: 'draw',
  e: 'export',
}

/** Inputs that hold editable text, where the browser's own keys must win. */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
])

/**
 * Fields the browser owns outright. `⌘Z` in a text layer must stay the
 * textarea's native text undo and `⌘S` its native save — but a focused
 * `<input type="range">` has no text to undo, so the app keeps its shortcut.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true
  if (element.tagName !== 'INPUT') return false
  return TEXT_INPUT_TYPES.has((element as HTMLInputElement).type.toLowerCase())
}

/** Any focusable form control, including the range and checkbox inputs. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  )
}

/**
 * Elements the browser will activate with `Enter` on its own.
 *
 * `Enter` is bound globally to "close the open tool", and that binding runs
 * *before* the browser's default action for the key. So with a tool already
 * open, pressing `Enter` on a different tool tab did this: the global handler
 * closed the open sheet; the sheet's restore-focus effect moved focus back to
 * the tab that had opened it; and the browser then delivered the `Enter` click
 * to *that* tab instead of the one under the user's finger. Net result — press
 * `Enter` on "Adjust" while Crop is open, and you get Crop again. `Space` was
 * unaffected, which is what made it look like a browser quirk rather than the
 * two handlers fighting over one key.
 *
 * Only `Enter` is guarded. The other global bindings are keys no control
 * consumes on its own — `0`, `1`, `[`, `]`, `f`, `\` and the tool letters are
 * meant to work from anywhere, and the shortcut sheet says so.
 */
const SELF_ACTIVATING_TAGS = new Set(['BUTTON', 'A', 'SUMMARY'])
const SELF_ACTIVATING_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'switch',
  'tab',
  'treeitem',
])

function activatesItselfOnEnter(target: EventTarget | null): boolean {
  // `window` and `document` are valid `EventTarget`s and have none of these
  // properties, so the check is for a real element rather than a duck type.
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (SELF_ACTIVATING_TAGS.has(target.tagName)) return true
  const role = target.getAttribute('role')
  return role !== null && SELF_ACTIVATING_ROLES.has(role)
}

/**
 * Global editor shortcuts. The text-entry guard runs before the modifier
 * shortcuts; the listeners are registered once for the lifetime of the hook so
 * a re-render cannot detach and reattach them, and every held-key state is
 * released on blur or a hidden tab.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const releaseCompare = () => {
      useUiStore.getState().setCompareHeld(false)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') releaseCompare()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return
      const meta = event.metaKey || event.ctrlKey
      const ui = useUiStore.getState()
      const doc = useDocStore.getState()

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) doc.redo()
        else doc.undo()
        return
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handlersRef.current.onExport?.()
        return
      }
      if (event.key === 'Escape') {
        // Cancel: close the tool and drop any interaction a lost pointer
        // capture may have left open, which would otherwise freeze undo.
        releaseCompare()
        doc.endInteraction()
        handlersRef.current.onCancel?.()
        return
      }
      if (isTypingTarget(event.target)) return

      if (event.key === '\\') {
        ui.setCompareHeld(true)
        return
      }
      const tool = TOOL_KEYS[event.key.toLowerCase()]
      if (tool && !meta) {
        ui.setActiveTool(tool)
        return
      }
      switch (event.key) {
        case '[':
          rotateBy(-90)
          break
        case ']':
          rotateBy(90)
          break
        case 'f':
          toggleFlipH()
          break
        case '0':
          ui.resetViewport()
          break
        case '1':
          ui.setViewport({ scale: 1 })
          break
        case 'Enter':
          // Only when nothing on screen is waiting for the key. See
          // `activatesItselfOnEnter`.
          if (!activatesItselfOnEnter(event.target)) handlersRef.current.onCommit?.()
          break
        case '?':
          ui.setShowHelp(!ui.showHelp)
          break
        default:
          break
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === '\\') releaseCompare()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseCompare)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseCompare)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
