import type { Caps } from '../gl/caps'
import { GlRenderer } from '../gl/renderer'
import {
  flagOff,
  resolveFlagState,
  snapshotFor,
  storedFlagsRaw,
  type FlagState,
} from '../lib/flags'
import type { RenderBackend } from './backend'
import { Canvas2dRenderer } from './fallback2d'

export type EnginePreference = 'auto' | 'gl' | 'canvas2d'

/**
 * Which backend this combination *asks for*, before anything is constructed.
 *
 * Split out from `createBackend` because the decision and the construction fail
 * for different reasons: the decision is pure and checkable anywhere, while
 * constructing a `Canvas2dRenderer` needs a real 2D context and constructing a
 * `GlRenderer` needs a real WebGL2 one — so a test that only wants to know
 * whether the veto was honoured should not need a browser to ask.
 */
export function backendKind(preference: EnginePreference, caps: Caps): 'gl' | 'canvas2d' {
  if (flagOff('webgl')) return 'canvas2d'
  if (preference === 'canvas2d') return 'canvas2d'
  return caps.webgl2 ? 'gl' : 'canvas2d'
}

/**
 * Pick a backend. `auto` prefers WebGL2 when the probe says it is usable and
 * silently falls back to Canvas2D otherwise (or if context creation throws).
 *
 * The `webgl` flag is a veto and is applied in `backendKind` rather than at the
 * call sites because that is the one decision every interactive path goes
 * through — including the context-loss retry and the render-error fallback,
 * either of which would otherwise be free to reintroduce a context the user
 * banned.
 *
 * It is a veto and not a preference: `engine` off steers *this* loop to
 * Canvas2D, while `webgl` off means no WebGL2 context is created wherever the
 * backend is chosen. That is the difference between "render the preview
 * differently" and "this browser's driver is the problem". A veto has to beat a
 * pin, so it is checked first and `engine: on` cannot overrule it.
 */
export function createBackend(preference: EnginePreference, caps: Caps): RenderBackend {
  if (backendKind(preference, caps) === 'gl') {
    try {
      return new GlRenderer()
    } catch {
      // Fall through to Canvas2D.
    }
  }
  return new Canvas2dRenderer()
}

/**
 * The `engine` flag, projected onto the three values the backend understands.
 *
 * `on` means "WebGL or nothing", `off` means "Canvas2D or nothing", and
 * `default` means "ask the device" — which is what a build with no flag, no URL
 * and no saved override has always done, so `default` is exactly today's
 * behaviour rather than a third rendering mode.
 */
export function enginePreferenceFromState(state: FlagState): EnginePreference {
  if (state === 'on') return 'gl'
  if (state === 'off') return 'canvas2d'
  return 'auto'
}

/**
 * The engine pin, resolved the same way every other flag is: URL over storage.
 *
 * Takes the search string rather than reading `window.location` itself so it
 * stays a pure function of its inputs, which is what lets precedence be checked
 * without a browser. Storage is consulted too, so a saved override survives a
 * navigation that happens to carry no `?engine=`.
 *
 * The URL is read through `parseFlagQuery`, which is where `?engine=gl` and
 * `?engine=canvas2d` live now: the legacy parameter is a spelling of
 * `?features=engine` / `?off=engine`, not a second mechanism beside it.
 */
export function readEnginePreference(search: string): EnginePreference {
  return enginePreferenceFromState(
    resolveFlagState(snapshotFor(search, storedFlagsRaw()), 'engine'),
  )
}
