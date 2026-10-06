import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';

export const SMOKE_ORIGIN = 'http://127.0.0.1:4179';

/** Only files in the built artifact can be fetched from the controlled preview. */
export async function staticAssetPaths(directory: string): Promise<Set<string>> {
  const paths = new Set<string>(['/']);
  async function visit(relative: string) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) paths.add('/' + name);
    }
  }
  await visit('');
  assert(paths.has('/index.html'), 'Build the candidate before running smoke');
  return paths;
}

export function isStaticAssetRequest(rawUrl: string, method: string, assetPaths: ReadonlySet<string>): boolean {
  try {
    const url = new URL(rawUrl);
    return method === 'GET' && url.origin === SMOKE_ORIGIN
      && !url.username && !url.password && !url.search && assetPaths.has(url.pathname);
  } catch {
    return false;
  }
}

/** Install before creating pages; service workers must also be blocked by the context. */
export async function installNetworkGuard(context: BrowserContext, assetPaths: ReadonlySet<string>): Promise<string[]> {
  const blockedExternal: string[] = [];
  await context.route('**/*', async route => {
    const request = route.request();
    if (isStaticAssetRequest(request.url(), request.method(), assetPaths)) {
      // route.continue() can follow redirects without re-entering this guard.
      const response = await route.fetch({ maxRedirects: 0 });
      try {
        if (response.status() >= 300 && response.status() < 400) {
          blockedExternal.push(`${request.method()} ${request.url()} -> HTTP ${response.status()} redirect`);
          await route.abort('blockedbyclient');
        } else {
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
    blockedExternal.push(`WEBSOCKET ${socket.url()}`);
    // A routed socket never connects upstream unless connectToServer() is called.
    await socket.close({ code: 1008, reason: 'Smoke forbids application communication' });
  });
  return blockedExternal;
}

export function assertNoForbiddenTraffic(blockedExternal: readonly string[]): void {
  assert.deepEqual(blockedExternal, [], 'Smoke attempted forbidden communication');
}
