import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useHaptics } from '../../hooks/useHaptics';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import type { SheetDetent } from '../../store/uiStore';
import styles from './controls.module.css';

const DETENTS: SheetDetent[] = ['peek', 'medium', 'large'];
const HEIGHTS: Record<SheetDetent, string> = {
  peek: '34vh',
  medium: '58vh',
  large: '90vh',
};

export type BottomSheetProps = {
  open: boolean;
  detent: SheetDetent;
  onDetent: (detent: SheetDetent) => void;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

/**
 * Peek/medium/large bottom sheet with a draggable grabber and Escape to
 * close. On desktop it becomes a right-hand inspector via CSS, so the same
 * markup serves both form factors.
 */
export function BottomSheet({ open, detent, onDetent, onClose, title, children }: BottomSheetProps) {
  const haptics = useHaptics();
  const dragDy = useRef(0);
  const sheetRef = useRef<HTMLElement>(null);
  const currentDetent = useRef(detent);
  useEffect(() => {
    currentDetent.current = detent;
  }, [detent]);

  const { onPointerDown } = usePointerDrag({
    onStart: () => {
      dragDy.current = 0;
    },
    onMove: (_dx, dy) => {
      dragDy.current += dy;
    },
    onEnd: () => {
      const threshold = 56;
      const index = DETENTS.indexOf(currentDetent.current);
      if (dragDy.current > threshold && index > 0) {
        onDetent(DETENTS[index - 1]);
        haptics(8);
      } else if (dragDy.current < -threshold && index < DETENTS.length - 1) {
        onDetent(DETENTS[index + 1]);
        haptics(8);
      }
      dragDy.current = 0;
    },
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const element = sheetRef.current;
    if (!element) return;
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => !node.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={styles.sheet}
        style={{ height: HEIGHTS[detent] }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.sheetGrabber} onPointerDown={onPointerDown} />
        <div className={styles.sheetBody}>
          {title && <h2 className={styles.sheetTitle}>{title}</h2>}
          {children}
        </div>
      </section>
    </>
  );
}
