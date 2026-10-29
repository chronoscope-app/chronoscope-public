/** Cesium's request-render mode still runs update passes at display cadence.
 * Reduce those passes only after a quiet second; drawing remains on demand.
 * Input/data changes wake immediately, and animation/loading keeps full cadence.
 */
export function idleSceneUpdates(
  setRate: (rate: number | undefined) => void,
  busy: () => boolean,
  clock = {
    now: () => performance.now(),
    schedule: (run: () => void, ms: number) => setTimeout(run, ms),
    cancel: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
) {
  let lastActivity = clock.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle = false;
  let disposed = false;
  const check = () => {
    timer = undefined;
    if (disposed) return;
    const remaining = 1000 - (clock.now() - lastActivity);
    if (remaining > 0 || busy()) {
      timer = clock.schedule(check, remaining > 0 ? remaining : 1000);
      return;
    }
    idle = true;
    setRate(10);
  };
  const wake = () => {
    if (disposed) return;
    lastActivity = clock.now();
    if (idle) {
      idle = false;
      setRate(undefined);
    }
    if (timer === undefined) timer = clock.schedule(check, 1000);
  };
  wake();
  return {
    wake,
    dispose() {
      disposed = true;
      if (timer !== undefined) clock.cancel(timer);
      timer = undefined;
    },
  };
}
