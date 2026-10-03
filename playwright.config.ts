import { defineConfig, devices } from '@playwright/test'

/**
 * D9-F01 — end-to-end configuration.
 *
 * The dev server here is deliberately NOT the one a developer already has open
 * on 5173: `webServer` wants a port it can own, kill and report on, and two Vite
 * servers on one project share a `node_modules/.vite` cache directory. 5317 is
 * unused by the local workflow, so a run never fights a live dev server.
 *
 * `npm run dev` rather than `npm run preview` on purpose: `prebuild` downloads
 * the matting weights, and the e2e suite must not depend on a 42 MB fetch (see
 * `e2e/journey.background.spec.ts`).
 */
const PORT = Number(process.env.E2E_PORT ?? 5317)
const BASE_URL = `http://127.0.0.1:${PORT}/Image-editor/`

/**
 * WebKit is a second project rather than a matrix leg so a PR run can opt out
 * with `--project=chromium`. It is the project that catches the Safari-only
 * `ImageBitmap` / `OffscreenCanvas` / clipboard behaviour, so it stays in the
 * default set; only its wall-clock cost is a matrix concern.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // The phone spec only makes sense with a touch stack; see the `mobile`
      // project. Running it here would assert the camera button is absent and
      // then fail, because there `hasTouch` is on.
      testIgnore: /journey\.mobile/,
      use: {
        ...devices['Desktop Chrome'],
        // Playwright's bundled Chromium defaults to ANGLE-over-SwiftShader, i.e.
        // a *software* rasteriser. The shader-parity test refuses to trust that
        // (there is no driver to test), so ask for the real one. On a runner
        // with no GPU these flags are ignored, SwiftShader comes back, and the
        // test skips with the renderer string in the report — which is the
        // honest outcome, not a silent pass.
        launchOptions: {
          args: [
            '--use-angle=metal',
            '--enable-gpu',
            '--ignore-gpu-blocklist',
            '--enable-gpu-rasterization',
          ],
        },
      },
    },
    {
      name: 'webkit',
      testIgnore: /journey\.mobile/,
      // WebKit has no launch flags worth setting: on macOS it already uses the
      // system GPU, and on Linux CI it falls back to software, which the
      // shader test reports rather than hides.
      use: { ...devices['Desktop Safari'] },
    },
    {
      // A phone-shaped project, scoped to the one spec that needs a real touch
      // stack. `(pointer: coarse)` — which the camera-capture button keys off —
      // only resolves under `hasTouch`, and a one-finger drag needs CDP, which
      // is Chromium-only. Scoped rather than general so the other journeys keep
      // their desktop timings and their WebKit leg.
      name: 'mobile',
      testMatch: /journey\.mobile/,
      use: { ...devices['Pixel 7'], hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
