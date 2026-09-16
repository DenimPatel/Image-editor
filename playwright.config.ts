import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level proof that each tool actually mutates pixels, on top of the
 * Vitest suite which only covers pure logic. Runs against the Vite preview
 * server (a production-like build) so WebGL2 behaves the same as the
 * deployed GitHub Pages build.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/Image-editor/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173/Image-editor/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
