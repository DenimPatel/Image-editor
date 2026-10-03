import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export type PointerDragHandlers = {
  onStart?: (event: PointerEvent) => void
  onMove: (dx: number, dy: number, event: PointerEvent) => void
  onEnd?: (event: PointerEvent | null) => void
}

/**
 * Pointer-capture drag helper used by the dial controls. Capture keeps the
 * gesture alive when the pointer leaves the element or the window.
 *
 * `onEnd` is delivered exactly once per gesture and *always* runs: pointerup,
 * pointercancel, lost capture, window blur, a hidden tab and unmount all end
 * the drag. That matters because a gesture that never ends leaves
 * `interaction.key` set in the history engine, and every edit made afterwards
 * is then swallowed into a single undo step.
 */
export function usePointerDrag(handlers: PointerDragHandlers) {
  const state = useRef<{ id: number; x: number; y: number } | null>(null)
  const handlersRef = useRef(handlers)
  const abortRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    handlersRef.current = handlers
  })

  // Unmounting mid-drag (a tool switch while the pointer is captured) is the
  // one path React cannot clean up from inside the event handler.
  useEffect(() => {
    return () => {
      abortRef.current?.()
    }
  }, [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const element = event.currentTarget
    const pointerId = event.pointerId
    let released = false
    const release = (native: PointerEvent | null) => {
      if (released) return
      released = true
      state.current = null
      abortRef.current = null
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('lostpointercapture', onLostCapture)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (typeof element.hasPointerCapture === 'function' && element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId)
      }
      handlersRef.current.onEnd?.(native)
    }

    const move = (native: PointerEvent) => {
      const current = state.current
      if (!current || native.pointerId !== current.id) return
      const dx = native.clientX - current.x
      const dy = native.clientY - current.y
      current.x = native.clientX
      current.y = native.clientY
      handlersRef.current.onMove(dx, dy, native)
    }

    const up = (native: PointerEvent) => {
      if (native.pointerId !== pointerId) return
      release(native)
    }

    const onLostCapture = () => release(null)
    const onWindowBlur = () => release(null)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') release(null)
    }

    try {
      element.setPointerCapture(pointerId)
    } catch {
      // No capture support: the window-level listeners below still end the drag.
    }
    state.current = { id: pointerId, x: event.clientX, y: event.clientY }
    abortRef.current = () => release(null)
    handlersRef.current.onStart?.(event.nativeEvent)

    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('lostpointercapture', onLostCapture)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return { onPointerDown }
}
