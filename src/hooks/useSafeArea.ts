import { useEffect, useState } from 'react';

export type SafeArea = { top: number; right: number; bottom: number; left: number };

/**
 * Reads `env(safe-area-inset-*)` via a hidden probe element so JS can offset
 * chrome by the same values CSS already uses.
 */
/* eslint-disable react-hooks/set-state-in-effect -- reads a DOM measurement
   once after mount; there is no render-time equivalent. */
export function useSafeArea(): SafeArea {
  const [insets, setInsets] = useState<SafeArea>({ top: 0, right: 0, bottom: 0, left: 0 });

  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe);
    setInsets({
      top: parseFloat(computed.paddingTop) || 0,
      right: parseFloat(computed.paddingRight) || 0,
      bottom: parseFloat(computed.paddingBottom) || 0,
      left: parseFloat(computed.paddingLeft) || 0,
    });
    probe.remove();
  }, []);

  return insets;
}
