/** Test-owned rAF/performance clock. Native timers and WebGL APIs are untouched. */
export function installControlledFrameClock(host: any = window) {
  let now = 1000, nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  Object.defineProperty(host.performance, 'now', { configurable: true, value: () => now });
  host.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = ++nextId; pending.set(id, callback); return id;
  };
  host.cancelAnimationFrame = (id: number) => { pending.delete(id); };
  host.__acceptanceClock = {
    now: () => now,
    pending: () => pending.size,
    advance: (milliseconds: number) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Invalid frame interval');
      now += milliseconds;
      // A callback scheduled inside a callback belongs to the next frame.
      for (const [id, callback] of [...pending]) {
        if (!pending.delete(id)) continue;
        callback(now);
      }
      return now;
    },
  };
}
