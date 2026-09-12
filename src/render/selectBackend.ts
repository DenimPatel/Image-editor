import type { Caps } from '../gl/caps';
import { GlRenderer } from '../gl/renderer';
import type { RenderBackend } from './backend';
import { Canvas2dRenderer } from './fallback2d';

export type EnginePreference = 'auto' | 'gl' | 'canvas2d';

/**
 * Pick a backend. `auto` prefers WebGL2 when the probe says it is usable and
 * silently falls back to Canvas2D otherwise (or if context creation throws).
 */
export function createBackend(preference: EnginePreference, caps: Caps): RenderBackend {
  if (preference !== 'canvas2d' && caps.webgl2) {
    try {
      return new GlRenderer();
    } catch {
      // Fall through to Canvas2D.
    }
  }
  return new Canvas2dRenderer();
}

export function readEnginePreference(search: string): EnginePreference {
  const value = new URLSearchParams(search).get('engine');
  if (value === 'gl' || value === 'canvas2d') return value;
  return 'auto';
}
