import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests', testMatch: /driver-proof\.case\.ts$/, workers: 1, retries: 0, timeout: 180_000,
  outputDir: 'test-results/driver-proof',
  reporter: [['list'], ['json', { outputFile: 'test-results/driver-proof-results.json' }]],
  use: { browserName: 'chromium', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 4178 --strictPort', url: 'http://127.0.0.1:4178', reuseExistingServer: false },
});
