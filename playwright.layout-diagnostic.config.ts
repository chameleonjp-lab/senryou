import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./browser-tests',testMatch:/layout-reservation\.case\.ts$/,workers:1,retries:0,timeout:600_000,
 outputDir:'test-results/layout-diagnostic',reporter:[['list'],['json',{outputFile:'test-results/layout-diagnostic-results.json'}]],
 use:{browserName:'chromium',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']},trace:'off',screenshot:'off'},
 webServer:{command:'npm run dev -- --port 4178 --strictPort',url:'http://127.0.0.1:4178',reuseExistingServer:false},});
