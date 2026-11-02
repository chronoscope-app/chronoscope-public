import { call } from "./bridge";
import { escape as esc } from "./types";
import "./workflow-dialogs.css";
export interface InputAdmission {
  path: string;
  bytes: number;
  allowed: boolean;
  limit_bytes: number;
  requires_confirmation: boolean;
  reason?: string | null;
}
export async function inspectInput(path: string): Promise<InputAdmission> {
  const result = await call("file_probe", { path, metadata_only: true });
  return { ...result, path } as unknown as InputAdmission;
}
export const inputSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
/** One explicit decision for the large supported files, before any content reads. */
export function confirmLargeInputs(files: InputAdmission[]): Promise<boolean> {
  const large = files.filter(
    (file) => file.allowed && file.requires_confirmation,
  );
  if (!large.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.id = "large-file-dialog";
    dialog.className = "workflow-dialog";
    dialog.setAttribute("aria-labelledby", "large-file-title");
    const total = large.reduce((n, file) => n + file.bytes, 0);
    dialog.innerHTML = `<header><h2 id="large-file-title">Open large files?</h2><button id="large-file-close" aria-label="Skip large files">×</button></header><p>${large.length === 1 ? "This file is" : "These files are each"} larger than 100 MiB (${inputSize(total)} total). Previews use bounded samples where supported. Full checking, importing or display can take time and disk space.</p><ul>${large.map((file) => `<li>${esc(file.path.split(/[\\/]/).pop() || file.path)} · ${inputSize(file.bytes)}</li>`).join("")}</ul><p class="description">Skipping leaves these files unchanged and continues with any smaller files.</p><footer><button id="large-file-skip" autofocus>Skip large files</button><button id="large-file-continue" class="primary">Continue with these files</button></footer>`;
    let accepted = false;
    dialog.querySelector<HTMLButtonElement>("#large-file-continue")!.onclick =
      () => {
        accepted = true;
        dialog.close();
      };
    for (const id of ["large-file-close", "large-file-skip"])
      dialog.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = () =>
        dialog.close();
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        resolve(accepted);
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
  });
}
