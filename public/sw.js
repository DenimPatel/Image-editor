/* eslint-env serviceworker */
/**
 * Offline shell for the image editor.
 *
 * Scope of what this actually buys: after one visit, the app's own code, the 24
 * look strips and the 14 self-hosted fonts are all served from Cache Storage, so
 * a photo you already have open keeps working on a plane. It is a runtime cache,
 * not a precache, because the bundle filenames are content-hashed and unknown
 * until the build that produced them.
 *
 * What it deliberately does NOT do: cache the background-removal weights.
 * @imgly/background-removal streams tens of MB of ONNX and onnxruntime-web wasm
 * from staticimgly.com, and stashing that in Cache Storage would blow a phone's
 * quota. Only same-origin GETs are cached at all, so a cross-origin CDN miss
 * stays a visible, honest "you are offline" error rather than a silent stall.
 */
const VERSION = 'ie-shell-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('ie-shell-') && name !== VERSION)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/** Navigations: fresh when possible, the cached shell when not. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(VERSION)
      await cache.put('./index.html', response.clone())
    }
    return response
  } catch {
    const cached = await caches.match('./index.html')
    return (
      cached ??
      new Response('<h1>Offline</h1><p>This app has not been cached yet.</p>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      })
    )
  }
}

/** Everything else same-origin: serve what we have, refresh in the background. */
async function handleAsset(request) {
  const cached = await caches.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        void caches.open(VERSION).then((cache) => cache.put(request, response.clone()))
      }
      return response
    })
    .catch(() => undefined)
  return cached ?? (await network) ?? new Response('', { status: 504 })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }
  event.respondWith(handleAsset(request))
})
