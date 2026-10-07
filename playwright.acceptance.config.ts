import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./browser-tests/acceptance',testMatch:/\.case\.ts$/,workers:1,retries:0,timeout:180_000,
  outputDir:'test-results/acceptance',reporter:[['list'],['json',{outputFile:'test-results/acceptance-results.json'}]],
  use:{browserName:'chromium',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']},trace:'off',screenshot:'off'},
  webServer:{command:'npm run dev -- --port 4178 --strictPort',url:'http://127.0.0.1:4178',reuseExistingServer:false},
});
