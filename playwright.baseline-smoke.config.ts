import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const baseline = process.env.THROTTLE_BASELINE_DIR;
if (!baseline) throw new Error('THROTTLE_BASELINE_DIR must name the pinned checkout');
export default defineConfig({
  outputDir: resolve(baseline, 'test-results/baseline-smoke'),
  testDir: resolve(baseline, 'browser-tests'), testMatch: /smoke\.spec\.ts$/, timeout: 60000,
  expect: { timeout: 20000 }, workers: 1, retries: 0,
  projects: [{ name: 'chromium-smoke', use: { browserName: 'chromium', launchOptions: {
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  } } }],
  reporter: [['list'], ['json', { outputFile: resolve(baseline, 'test-results/baseline-smoke-results.json') }]],
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 393, height: 852 }, hasTouch: true,
    deviceScaleFactor: 1, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 4178 --strictPort', cwd: baseline,
    url: 'http://127.0.0.1:4178', reuseExistingServer: false },
});
