/**
 * What "offline" actually costs this app, stated precisely.
 *
 * The claim on the import screen is "Everything runs in your browser — nothing
 * is uploaded", which is true about *privacy* and was quietly false about
 * *connectivity*: before there was a service worker the app needed the network
 * to boot at all, and background removal needs it permanently. The distinction
 * matters, because the useful message is not "you are offline, nothing works" —
 * it is "your edits keep working; the sample photos and the background-removal
 * model do not". That is what this module encodes.
 */

export type NetworkState = 'online' | 'offline'

export type FeatureImpact = 'works' | 'works-if-cached' | 'needs-network'

export type OfflineImpact = {
  /** Opening a photo you already have and editing it. */
  editing: FeatureImpact
  /** The bundled sample photos, which are fetched by URL. */
  samples: FeatureImpact
  /** Background removal, which streams ONNX weights from the imgly CDN. */
  backgroundRemoval: FeatureImpact
  /** A look strip or a self-hosted font not yet in Cache Storage. */
  assets: FeatureImpact
}

/** What is true once the service worker has cached the shell. */
export const CACHED_SHELL_IMPACT: OfflineImpact = {
  editing: 'works',
  samples: 'needs-network',
  backgroundRemoval: 'needs-network',
  assets: 'works-if-cached',
}

/** Subject-invariant phrases, so one template reads correctly for all of them. */
const PREDICATE: Record<FeatureImpact, string> = {
  works: 'work offline',
  'works-if-cached': 'work if you have opened them before',
  'needs-network': 'need a connection',
}

const SUBJECT: Record<keyof OfflineImpact, string> = {
  editing: 'Your photo and every edit',
  samples: 'The bundled sample photos',
  backgroundRemoval: 'Background removal',
  assets: 'Looks and fonts',
}

/**
 * One sentence, no exclamation marks, no "are you sure". The banner is
 * informational: nothing it says should make the editor feel broken. Every
 * clause is generated from the impact map, so a feature cannot be added to the
 * map and forgotten in the copy.
 */
export function describeOffline(impact: OfflineImpact = CACHED_SHELL_IMPACT): string {
  return [
    "You're offline. Here's what still works:",
    ...(['editing', 'samples', 'backgroundRemoval', 'assets'] as const).map(
      (feature) => `${SUBJECT[feature]} will ${PREDICATE[impact[feature]]}.`,
    ),
  ].join(' ')
}

export function networkState(online: boolean): NetworkState {
  return online ? 'online' : 'offline'
}

/** `false` when there is no `navigator` to ask, which is never "online". */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? false : navigator.onLine !== false
}

/**
 * Subscribe to connectivity changes. Returns the unsubscribe function, and
 * fires immediately with the current state so a caller never has to seed it.
 */
export function observeNetwork(listener: (online: boolean) => void): () => void {
  const emit = () => listener(isOnline())
  emit()
  if (typeof window === 'undefined') return () => undefined
  const online = () => listener(true)
  const offline = () => listener(false)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
  }
}
