import { defineConfig, mergeConfig } from 'vite';
import appConfig from './vite.config.ts';

// Test-only server: preserve import.meta.env.DEV and its existing __senryou oracle.
// Unoptimized imports give the network guard an exact physical-file manifest.
export default mergeConfig(appConfig, defineConfig({
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { ws: { host: '127.0.0.1', clientPort: 4179 } },
}));
