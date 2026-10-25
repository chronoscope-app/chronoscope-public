import type { SpaceTimeView } from "./view";
import type { Snapshot } from "./types";
import { ViewProfiles } from "./view-profile";
type Args = Record<string, any>;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
interface Host {
  view: SpaceTimeView;
  snapshot: () => Snapshot;
  live: (command: string, args?: Args) => Promise<any>;
  setView: (args: Args) => Promise<void>;
  playback: (args: Args) => Promise<any>;
  record: (args: Args) => Promise<any>;
}
export function createAgentLab(host: Host) {
  const profiles = new ViewProfiles(
    (listener) => {
      host.view.controls.addEventListener("frame", listener);
      return () => host.view.controls.removeEventListener("frame", listener);
    },
    () => host.view.frameTelemetry(),
  );
  const runs = new Map<string, any>();
  const videos = new Map<string, string>();
  const profile = (args: Args) => profiles.request(args);
  const wait = async (args: Args, check = () => {}) => {
    const start = performance.now(),
      deadline = start + (args.timeout_ms ?? 10000);
    let settled: number | undefined;
    while (true) {
      check();
      const status = await host.live("view_status");
      check();
      // Status retrieval itself is asynchronous and counts toward the deadline.
      if (performance.now() >= deadline)
        throw Error(
          "UNAVAILABLE: view did not settle before the readiness deadline",
        );
      const d = status.diagnostics;
      const ready =
        !d.recovering &&
        !d.effectError &&
        !status.gis_layers.some(
          (l: any) => args.gis !== false && l.enabled && l.error,
        ) &&
        (args.imagery === false || !status.loading.imagery) &&
        (args.terrain === false || !d.terrain.terrainPendingTiles) &&
        (args.effects === false || !status.loading.effects) &&
        (args.gis === false || !status.loading.gis);
      if (ready) settled ??= performance.now();
      else settled = undefined;
      if (
        settled !== undefined &&
        performance.now() - settled >= (args.stable_ms ?? 200)
      )
        return { ready: true, elapsed_ms: performance.now() - start, status };
      if (performance.now() >= deadline)
        throw Error(
          "UNAVAILABLE: view did not settle before the readiness deadline",
        );
      await sleep(50);
    }
  };
  const recording = async (args: Args) => {
    let id = videos.get(args.path);
    if (args.action === "start")
      id = profile({
        action: "start",
        max_seconds: Math.min(120, (args.max_seconds ?? 30) + 2),
      }).id;
    try {
      const result = await host.record(args);
      if (id) {
        videos.set(result.path, id);
        videos.set(args.path, id);
        result.profile_id = id;
        try {
          if (["complete", "failed"].includes(result.state))
            profile({ action: "stop", id });
          result.profile_started_unix_ms = profile({
            action: "status",
            id,
          }).started_unix_ms;
          result.profile_available = true;
        } catch (error) {
          // Video files/native metadata outlive the independent trace history.
          if (!String(error).includes("NOT_FOUND:")) throw error;
          result.profile_available = false;
        }
      }
      // Bound aliases retained for recorder history (native history is eight).
      while (videos.size > 16) videos.delete(videos.keys().next().value!);
      return result;
    } catch (error) {
      if (id && args.action === "start") profile({ action: "stop", id });
      throw error;
    }
  };
  const scenario = async (args: Args) => {
    if (args.action !== "run") {
      const run = runs.get(args.id);
      if (!run)
        throw Error("NOT_FOUND: scenario run not found in this app session");
      if (args.action === "cancel" && run.state === "running")
        run.cancelled = true;
      return publicRun(run);
    }
    if ([...runs.values()].some((r) => r.state === "running"))
      throw Error("RESOURCE_LIMIT: a navigation scenario is already running");
    while (runs.size >= 8) runs.delete(runs.keys().next().value!);
    const workspace = host.snapshot().workspace_id;
    const run: any = {
      id: crypto.randomUUID(),
      name: args.name,
      state: "running",
      completed_steps: 0,
      steps: args.steps,
      error: null,
      started_unix_ms: Date.now(),
      profile_id: profile({
        action: "start",
        max_seconds: args.timeout_seconds ?? 120,
      }).id,
      cancelled: false,
      trace: [],
    };
    runs.set(run.id, run);
    const deadline = performance.now() + (args.timeout_seconds ?? 120) * 1000;
    const check = () => {
      if (run.cancelled) throw Error("CANCELLED: scenario cancelled");
      if (host.snapshot().workspace_id !== workspace)
        throw Error("CONFLICT: workspace changed during scenario");
      if (performance.now() >= deadline)
        throw Error("UNAVAILABLE: scenario deadline exceeded");
    };
    // Return immediately; status/cancel remain available while the recipe runs.
    void (async () => {
      try {
        for (const step of args.steps) {
          check();
          const a = step.arguments;
          if (step.command === "view_set") await host.setView(a);
          else if (step.command === "view_wait") await wait(a, check);
          else if (step.command === "view_playback") await host.playback(a);
          else if (step.command === "view_navigate")
            await host.live(step.command, a);
          else if (step.command === "wait") {
            const until = performance.now() + a.milliseconds;
            while (performance.now() < until) {
              check();
              await sleep(Math.min(50, until - performance.now()));
            }
          } else throw Error("INVALID_ARGUMENT: unsupported scenario step");
          check();
          run.completed_steps++;
          const status = await host.live("view_status");
          // A workspace change, cancellation or deadline can arrive while the
          // asynchronous status request is in flight, including on the last step.
          check();
          run.trace.push({
            step: run.completed_steps,
            unix_ms: Date.now(),
            mode: status.mode,
            scene: status.scene,
            render_errors: status.diagnostics.renderErrorCount,
            terrain: status.diagnostics.terrain,
          });
        }
        run.state = "complete";
      } catch (error) {
        run.error = String(error);
        run.state = run.cancelled ? "cancelled" : "failed";
      } finally {
        profile({ action: "stop", id: run.profile_id });
        run.finished_unix_ms = Date.now();
      }
    })();
    return publicRun(run);
  };
  const publicRun = (r: any) => {
    const { cancelled, ...result } = r;
    return structuredClone(result);
  };
  return { profile, wait, recording, scenario, playback: host.playback };
}
