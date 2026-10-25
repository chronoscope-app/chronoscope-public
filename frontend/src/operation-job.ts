import { call, CommandError } from "./bridge";
import type { EngineContracts } from "./contracts";

type JobCommand = EngineContracts["job_start"]["args"]["command"];
type Progress = EngineContracts["job_status"]["result"];

/** Poll the shared engine job lifecycle; cancellation waits for its actual outcome. */
export async function runJob<K extends JobCommand>(
  command: K,
  args: EngineContracts[K]["args"],
  options: { signal?: AbortSignal; progress?: (state: Progress) => void } = {},
): Promise<EngineContracts[K]["result"]> {
  if (options.signal?.aborted)
    throw new DOMException("Cancelled", "AbortError");
  const started = await call("job_start", {
    command,
    arguments: args,
  } as EngineContracts["job_start"]["args"]);
  const id = started.job_id;
  let terminal = false;
  let cancelSent = false;
  try {
    for (;;) {
      if (options.signal?.aborted && !cancelSent) {
        cancelSent = true;
        await call("job_cancel", { job_id: id });
      }
      const state = await call("job_status", { job_id: id });
      options.progress?.(state);
      terminal = !["queued", "running"].includes(state.status);
      if (terminal) {
        if (state.status !== "completed")
          throw new CommandError(
            state.error || {
              code:
                state.status === "cancelled" ? "CANCELLED" : "OPERATION_FAILED",
              message:
                state.status === "cancelled"
                  ? "Operation cancelled"
                  : "Operation failed",
            },
          );
        const result = await call("job_result", { job_id: id });
        return result.result as EngineContracts[K]["result"];
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } finally {
    if (terminal) await call("job_release", { job_id: id }).catch(() => {});
    else await call("job_cancel", { job_id: id }).catch(() => {});
  }
}
