import { useEffect } from 'react';
import { useUiStore } from '../../store/uiStore';
import styles from './controls.module.css';

export function ToastStack() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => dismiss(toast.id), 3200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, dismiss]);

  return (
    <div className={styles.toastStack} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast}${toast.tone === 'error' ? ` ${styles.toastError}` : ''}`}
          role="status"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
