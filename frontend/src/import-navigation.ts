import { escape as esc } from "./types";
import type { EngineContracts } from "./contracts";
type Mapping = NonNullable<EngineContracts["import_commit"]["args"]["mapping"]>;
export interface ImportDraft {
  headers: string[][];
  mappings: Mapping[];
  sheet: number;
  targetSource: string;
  append: boolean;
  aggregate: boolean;
  windowMinutes: number;
  radius: number;
}
/** Optional batch context; ordinary Open keeps the single-file importer. */
export interface ImportNavigation {
  index: number;
  handled?: boolean;
  items: () => { name: string; status: string }[];
  navigate(index: number): Promise<void>;
  skip(): Promise<void>;
  closed(): void;
  imported(workspace?: string): Promise<void>;
  display?: () => Promise<void>;
  failed(error: string): void;
  draft?: ImportDraft;
  delimiter?: NonNullable<
    EngineContracts["import_preview"]["args"]["delimiter"]
  >;
}
const guarded = new WeakSet<HTMLDialogElement>();
export function mountImportNavigation(
  dialog: HTMLDialogElement,
  navigation?: ImportNavigation,
  remember = () => {},
) {
  if (!navigation) return;
  if (!guarded.has(dialog)) {
    guarded.add(dialog);
    dialog.addEventListener(
      "cancel",
      (event) => {
        if (dialog.dataset.fileActionBusy === "true") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }
  dialog.querySelector(".import-file-navigation")?.remove();
  const items = navigation.items();
  const bar = document.createElement("nav");
  bar.className = "import-file-navigation";
  bar.setAttribute("aria-label", "Dropped files");
  bar.innerHTML = `<div class="import-file-pages"><button id="import-file-previous" ${navigation.index === 0 ? "disabled" : ""}>Previous file</button><label class="field">File ${navigation.index + 1} of ${items.length}<select id="import-file-select" aria-label="Dropped file">${items.map((item, i) => `<option value="${i}" ${i === navigation.index ? "selected" : ""}>${esc(item.name)} · ${esc(item.status)}</option>`).join("")}</select></label><button id="import-file-next" ${navigation.index === items.length - 1 ? "disabled" : ""}>Next file</button></div><div class="import-file-alternatives"><span class="description">Files are added individually. Closing leaves unimported files unchanged.</span>${navigation.handled ? "" : '<button id="import-file-skip">Skip file</button>'}${navigation.display ? '<button id="import-file-display">Add reference layer</button>' : ""}</div>`;
  dialog.querySelector("header")!.after(bar);
  const run = async (action: () => Promise<void>) => {
    remember();
    const controls = [
      ...dialog.querySelectorAll<
        HTMLInputElement | HTMLButtonElement | HTMLSelectElement
      >("input,button,select"),
    ].map((el) => [el, el.disabled] as const);
    dialog.dataset.fileActionBusy = "true";
    controls.forEach(([el]) => (el.disabled = true));
    try {
      await action();
    } catch (error) {
      navigation.failed(String(error));
      if (dialog.open) {
        let alert = dialog.querySelector<HTMLElement>("#import-file-error");
        if (!alert) {
          alert = document.createElement("p");
          alert.id = "import-file-error";
          alert.setAttribute("role", "alert");
          bar.after(alert);
        }
        alert.textContent = String(error);
        mountImportNavigation(dialog, navigation, remember);
      }
    } finally {
      delete dialog.dataset.fileActionBusy;
      if (dialog.open)
        controls.forEach(([el, disabled]) => {
          if (el.isConnected) el.disabled = disabled;
        });
    }
  };
  bar.querySelector<HTMLButtonElement>("#import-file-previous")!.onclick = () =>
    void run(() => navigation.navigate(navigation.index - 1));
  bar.querySelector<HTMLButtonElement>("#import-file-next")!.onclick = () =>
    void run(() => navigation.navigate(navigation.index + 1));
  bar.querySelector<HTMLSelectElement>("#import-file-select")!.onchange = (e) =>
    void run(() =>
      navigation.navigate(Number((e.target as HTMLSelectElement).value)),
    );
  const skip = bar.querySelector<HTMLButtonElement>("#import-file-skip");
  if (skip) skip.onclick = () => void run(navigation.skip);
  const display = bar.querySelector<HTMLButtonElement>("#import-file-display");
  if (display) display.onclick = () => void run(navigation.display!);
}
