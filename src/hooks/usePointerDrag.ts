import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export type PointerDragHandlers = {
  onStart?: (event: PointerEvent) => void;
  onMove: (dx: number, dy: number, event: PointerEvent) => void;
  onEnd?: (event: PointerEvent) => void;
};

/**
 * Pointer-capture drag helper used by the dial controls. Capture keeps the
 * gesture alive when the pointer leaves the element or the window.
 */
export function usePointerDrag(handlers: PointerDragHandlers) {
  const state = useRef<{ id: number; x: number; y: number } | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    state.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    handlersRef.current.onStart?.(event.nativeEvent);

    const move = (native: PointerEvent) => {
      const current = state.current;
      if (!current || native.pointerId !== current.id) return;
      const dx = native.clientX - current.x;
      const dy = native.clientY - current.y;
      current.x = native.clientX;
      current.y = native.clientY;
      handlersRef.current.onMove(dx, dy, native);
    };

    const up = (native: PointerEvent) => {
      if (!state.current || native.pointerId !== state.current.id) return;
      state.current = null;
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      handlersRef.current.onEnd?.(native);
    };

    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  }, []);

  return { onPointerDown };
}
