import assert from 'node:assert/strict';
import type { BrowserContext } from '@playwright/test';

export const SMOKE_ORIGIN = 'http://127.0.0.1:4179';

export type AssetManifest = ReadonlyMap<string, { physicalFile: string | null; resourceTypes: readonly string[] }>;

export function isStaticAssetRequest(rawUrl: string, method: string, resourceType: string, manifest: AssetManifest): boolean {
  try {
    const url = new URL(rawUrl);
    return method === 'GET' && rawUrl === `${SMOKE_ORIGIN}${url.pathname}` && url.origin === SMOKE_ORIGIN
      && !url.username && !url.password && !url.search && !url.hash
      && manifest.get(url.pathname)?.resourceTypes.includes(resourceType) === true;
  } catch {
    return false;
  }
}

export function viteHmrDiagnosticUrl(clientSource: string): string {
  const token = clientSource.match(/^const wsToken = "([a-zA-Z0-9_-]+)";$/m)?.[1];
  if (!token) throw new Error('The served Vite client has no recognized HMR token');
  return `ws://127.0.0.1:4179/?token=${token}`;
}

/** Install before creating pages; service workers must also be blocked by the context. */
export async function installNetworkGuard(context: BrowserContext, manifest: AssetManifest): Promise<string[]> {
  const blockedExternal: string[] = [];
  let hmrDiagnostic: string | undefined;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (isStaticAssetRequest(request.url(), request.method(), request.resourceType(), manifest)) {
      if (url.pathname === '/favicon.ico') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      // route.continue() can follow redirects without re-entering this guard.
      const response = await route.fetch({ maxRedirects: 0 });
      try {
        if (response.status() >= 300 && response.status() < 400) {
          blockedExternal.push(`${request.method()} ${request.url()} -> HTTP ${response.status()} redirect`);
          await route.abort('blockedbyclient');
        } else {
          if (url.pathname === '/@vite/client') hmrDiagnostic = viteHmrDiagnosticUrl(await response.text());
          await route.fulfill({ response });
        }
      } finally {
        await response.dispose();
      }
    } else {
      blockedExternal.push(`${request.method()} ${request.url()}`);
      await route.abort('blockedbyclient');
    }
  });
  await context.routeWebSocket('**/*', async socket => {
    if (hmrDiagnostic !== undefined && socket.url() === hmrDiagnostic) {
      // Exact observed Vite diagnostics stay inert and open. Closing here makes
      // Vite reconnect and can raise an unrelated pageerror. Never connect/send.
      socket.onMessage(() => {});
      return;
    }
    blockedExternal.push(`WEBSOCKET ${socket.url()}`);
    // A routed socket never connects upstream unless connectToServer() is called.
    await socket.close({ code: 1008, reason: 'Smoke forbids application communication' });
  });
  return blockedExternal;
}

export function assertNoForbiddenTraffic(blockedExternal: readonly string[]): void {
  assert.deepEqual(blockedExternal, [], 'Smoke attempted forbidden communication');
}
