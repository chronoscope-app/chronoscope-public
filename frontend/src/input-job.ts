import { runJob } from "./operation-job";
import { inputSize } from "./file-preflight";
import type { EngineContracts } from "./contracts";
import { escape as esc } from "./types";
import "./workflow-dialogs.css";
type JobCommand = EngineContracts["job_start"]["args"]["command"];
/** Keep file operations visible and cancel through the engine's actual job outcome. */
export async function runInputJob<K extends JobCommand>(
  command: K,
  args: EngineContracts[K]["args"],
  title: string,
): Promise<Exclude<EngineContracts[K]["result"], { dry_run: true }>> {
  const controller = new AbortController();
  const dialog = document.createElement("dialog");
  dialog.className = "workflow-dialog";
  dialog.id = "input-job-dialog";
  dialog.setAttribute("aria-labelledby", "input-job-title");
  dialog.innerHTML = `<header><h2 id="input-job-title">${esc(title)}</h2></header><p role="status" aria-live="polite">Preparing…</p><footer><button id="cancel-input-job">Cancel</button></footer>`;
  const cancel = () => {
    controller.abort();
    const button = dialog.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    button.textContent = "Cancelling…";
  };
  dialog.querySelector<HTMLButtonElement>("button")!.onclick = cancel;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  document.body.append(dialog);
  dialog.showModal();
  try {
    const result = await runJob(command, args, {
      signal: controller.signal,
      progress: (state) => {
        const amount =
          state.progress_event?.unit === "bytes"
            ? inputSize(state.progress)
            : `${state.progress.toLocaleString()} ${state.progress_event?.unit || "items"}`;
        dialog.querySelector('[role="status"]')!.textContent =
          `${state.message || title}${state.progress ? ` · ${amount}` : ""}`;
      },
    });
    if ((result as { dry_run?: boolean }).dry_run)
      throw Error("File operation did not execute");
    return result as Exclude<EngineContracts[K]["result"], { dry_run: true }>;
  } finally {
    dialog.close();
    dialog.remove();
  }
}
