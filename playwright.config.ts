import { defineConfig } from '@playwright/test';

// End-to-end tests run against the production build (npm run build first),
// using the locally installed Google Chrome rather than a downloaded browser.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4174/',
    channel: 'chrome',
    serviceWorkers: 'block',
  },
  // Run once with animations and once with the 'reduce motion' setting.
  projects: [
    { name: 'animated' },
    { name: 'reduced-motion', use: { reducedMotion: 'reduce' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: true,
  },
});
