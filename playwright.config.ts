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
  // The demo test runs once with the 'Animate' option ticked and once with it unticked.
  projects: [{ name: 'animated' }, { name: 'not-animated' }],
  webServer: {
    command: 'npm run preview -- --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: true,
  },
});
