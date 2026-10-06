import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { viteHmrDiagnosticUrl } from './network-guard';

export const ORIGIN = 'http://127.0.0.1:4178';
// The legacy wildcard is deliberately deny-all: an older CDP implementation
// which ignores urlPatterns cannot silently remove external confinement.
export const OUTER_FENCE = {
  urlPatterns: [
    { urlPattern: `${ORIGIN}/*`, block: false },
    { urlPattern: 'ws://127.0.0.1:4178/*', block: false },
  ],
  urls: ['*'],
};
const observers = new WeakMap<Page, PairedObserver>();
const pending: PairedObserver[] = [];
const errorText = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
export function isLocalHttp(address: string): boolean {
  try { const u = new URL(address); return u.origin === ORIGIN && !u.username && !u.password; }
  catch { return false; }
}

export class PairedObserver {
  readonly evidence: any;
  private pages = new WeakMap<Page, Promise<void>>();
  private hmrReady: Promise<string | null>;
  private resolveHmr!: (url: string | null) => void;
  private responseWork: Promise<void>[] = [];
  constructor(private context: BrowserContext, arm: string, id: string) {
    this.evidence = { arm, id, diagnosticOnly: true, captures: [], requests: [], outerForbidden: [], errors: [],
      fence: OUTER_FENCE, preparedPages: 0, hmr: { observed: null, attempts: [], connectedMessages: 0, serverMessages: 0 } };
    this.hmrReady = new Promise(resolve => { this.resolveHmr = resolve; });
    context.on('close', () => this.resolveHmr(null));
    context.on('request', request => {
      const record = { event: 'request', url: request.url(), method: request.method(), type: request.resourceType(), hostMs: performance.now() };
      this.evidence.requests.push(record);
      if (!isLocalHttp(request.url())) this.evidence.outerForbidden.push(record);
    });
    context.on('requestfinished', request => this.evidence.requests.push({ event: 'finished', url: request.url(), hostMs: performance.now() }));
    context.on('requestfailed', request => this.evidence.requests.push({ event: 'failed', url: request.url(), failure: request.failure(), hostMs: performance.now() }));
    context.on('response', response => {
      if (response.url() !== `${ORIGIN}/@vite/client`) return;
      const work = (async () => {
        try {
          assert.equal(response.status(), 200);
          assert.equal(response.request().method(), 'GET');
          assert.equal(response.request().resourceType(), 'script');
          const hmr = viteHmrDiagnosticUrl(await response.text());
          this.evidence.hmr.observed = hmr;
          this.resolveHmr(hmr);
        } catch (error) { this.evidence.errors.push(errorText(error)); this.resolveHmr(null); }
      })();
      this.responseWork.push(work);
    });
    pending.push(this);
  }
  async preparePage(page: Page): Promise<void> {
    let prepared = this.pages.get(page);
    if (!prepared) {
      prepared = (async () => {
        const cdp = await this.context.newCDPSession(page);
        const requests = new Map<string, string>();
        cdp.on('Network.requestWillBeSent', event => {
          requests.set(event.requestId, event.request.url);
          if (!isLocalHttp(event.request.url)) this.evidence.outerForbidden.push({ event: 'cdp-request', url: event.request.url, timestamp: event.timestamp });
        });
        cdp.on('Network.loadingFailed', event => {
          this.evidence.requests.push({ event: 'cdp-failed', url: requests.get(event.requestId), blockedReason: event.blockedReason, errorText: event.errorText, timestamp: event.timestamp });
        });
        await cdp.send('Network.enable');
        await cdp.send('Network.setBlockedURLs', OUTER_FENCE);
        this.evidence.preparedPages++;
        observers.set(page, this);
      })();
      this.pages.set(page, prepared);
    }
    await prepared;
  }
  async installOuterHttpFence(): Promise<void> {
    // Register AFTER the arm's handler. Before its continue/fetch, prepare the
    // originating page, including additional pages when a frame is available.
    // Frame-less/worker requests fail closed rather than escaping a page fence.
    await this.context.route('**/*', async route => {
      try {
        await this.preparePage(route.request().frame().page());
        if (!isLocalHttp(route.request().url())) {
          this.evidence.outerForbidden.push({ event: 'outer-route', url: route.request().url() });
          await route.abort('blockedbyclient');
          return;
        }
        await route.fallback();
      } catch (error) {
        this.evidence.errors.push(errorText(error));
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
  }
  async installControlSockets(): Promise<void> {
    await this.context.routeWebSocket('**/*', async socket => {
      this.evidence.hmr.attempts.push(socket.url());
      // Wait for the already-observed Vite response's body. Never guess a token
      // or reject a legitimate socket merely because body delivery races Node.
      if (!/^ws:\/\/127\.0\.0\.1:4178\/\?token=[a-zA-Z0-9_-]+$/.test(socket.url())) {
        this.evidence.outerForbidden.push({ event: 'websocket', url: socket.url() });
        await socket.close({ code: 1008, reason: 'Non-loopback diagnostic socket' });
        return;
      }
      const observed = await this.hmrReady;
      if (!observed || socket.url() !== observed) {
        this.evidence.outerForbidden.push({ event: 'websocket', url: socket.url() });
        await socket.close({ code: 1008, reason: 'Unverified diagnostic socket' });
        return;
      }
      const server = socket.connectToServer();
      server.onMessage(message => {
        this.evidence.hmr.serverMessages++;
        try { if (JSON.parse(String(message)).type === 'connected') this.evidence.hmr.connectedMessages++; } catch {}
        socket.send(message);
      });
      // Leave browser-to-server and both close directions at their native
      // automatic forwarding behavior. Only the exact loopback HMR is live.
    });
  }
  async flush(): Promise<void> {
    await Promise.all(this.responseWork);
    const problems: string[] = [];
    if (this.evidence.errors.length) problems.push('Observer/setup errors');
    if (this.evidence.outerForbidden.length) problems.push('Forbidden communication attempted');
    if (!this.evidence.preparedPages) problems.push('No prepared page');
    if (!this.evidence.hmr.observed) problems.push('No verified served HMR token');
    if (this.evidence.arm === 'control' && this.evidence.hmr.connectedMessages < 1) problems.push('Live loopback HMR connection not proven');
    this.evidence.problems = problems;
    const directory = path.join(process.cwd(), 'docs/evidence/paired-observer');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${this.evidence.id}.json`), JSON.stringify(this.evidence, null, 2) + '\n');
    assert.deepEqual(problems, [], 'Paired diagnostic evidence is incomplete or unsafe');
  }
}

export async function observeCapture(page: Page, id: string, state: string, edge: 'before' | 'after') {
  const observer = observers.get(page);
  if (!observer) throw new Error('Capture page lacks its verified outer fence');
  const record: any = { id, state, edge, hostMs: performance.now() };
  try {
    record.browser = await page.evaluate(() => {
      const api = (window as any).__senryou;
      // diagnostics() is pure: no GL polling, clock advance, simulation step,
      // queue reset or battleHash computation. Product code is unchanged.
      return { nowMs: performance.now(), queue: api?.view?.diagnostics?.().queue ?? null };
    });
    assert.ok(Number.isFinite(record.browser.nowMs));
    const queue = record.browser.queue;
    assert.ok(queue && ['ready', 'pending', 'stalled', 'failed'].includes(queue.status));
    for (const key of ['pendingMs', 'submittedCount', 'completedCount', 'skippedCount']) assert.ok(Number.isFinite(queue[key]) && queue[key] >= 0);
    for (const key of ['lastCompletedPendingMs', 'completedFrameIntervalMs']) assert.ok(queue[key] === null || Number.isFinite(queue[key]));
  } catch (error) {
    record.error = errorText(error);
    observer.evidence.errors.push(record.error);
  }
  record.hostEndMs = performance.now();
  if (edge === 'after') {
    const before = [...observer.evidence.captures].reverse().find((item: any) => item.id === id && item.state === state && item.edge === 'before');
    record.screenshotElapsedMs = before ? record.hostMs - before.hostEndMs : null;
    if (!Number.isFinite(record.screenshotElapsedMs)) observer.evidence.errors.push('Missing paired capture start');
  }
  observer.evidence.captures.push(record);
}

export async function flushObservers() {
  const batch = pending.splice(0);
  const results = await Promise.allSettled(batch.map(observer => observer.flush()));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}
