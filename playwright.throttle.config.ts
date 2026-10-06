import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests', testMatch: /throttle-lever\.spec\.ts$/, timeout: 60000, expect: { timeout: 20000 }, workers: 1, retries: 0,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] } } },
    // WebKit runs real settings and production DOM input. WebGL/CDP-only cases are explicitly skipped, never counted as passes.
    { name: 'webkit-ui', use: { browserName: 'webkit' } },
    // Keep all three inherited Senryou smoke cases. Cross-repository comparison stays in the unchanged standard config.
    { name: 'chromium-smoke', testMatch: /smoke\.spec\.ts$/, use: { browserName: 'chromium', launchOptions: { args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] } } },
  ],
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 393, height: 852 }, hasTouch: true, deviceScaleFactor: 1, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    // Retain the DEV-only smoke oracle; HMR is intercepted as an inert mock.
    { command: 'node node_modules/vite/bin/vite.js --config vite.browser-tests.config.ts --host 127.0.0.1 --port 4179 --strictPort', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
    { command: 'npm run dev -- --port 4178 --strictPort', url: 'http://127.0.0.1:4178', reuseExistingServer: !process.env.CI },
    ...(process.env.THROTTLE_BASELINE_DIR ? [{ command: 'npm run dev -- --port 4177 --strictPort', cwd: process.env.THROTTLE_BASELINE_DIR, url: 'http://127.0.0.1:4177', reuseExistingServer: false }] : []),
  ],
});
