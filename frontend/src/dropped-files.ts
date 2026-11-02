import {
  inspectInput,
  confirmLargeInputs,
  type InputAdmission,
} from "./file-preflight";
import { runJob } from "./operation-job";
import { escape as esc } from "./types";
import type { ImportDialog } from "./import-dialog";
import type { ImportNavigation } from "./import-navigation";
interface Entry {
  path: string;
  name: string;
  status: string;
  kind?: "data" | "gis" | "workspace";
  format?: string;
  error?: string;
  navigation?: ImportNavigation;
  admission?: InputAdmission;
}
interface Host {
  importer: ImportDialog;
  workspace(): string;
  available(): boolean;
  settle(): Promise<unknown>;
  pause(): void;
  openWorkspace(path: string): Promise<unknown>;
  display(path: string, format: string): Promise<void>;
  notice(message: string): void;
}
const displayOnly = (format?: string) =>
  ["tiles3d", "gltf", "glb"].includes(format || "");
const terminal = (entry: Entry) =>
  ["Imported", "Displayed", "Skipped", "Companion file"].includes(entry.status);
/** One reviewed file at a time; engine tickets, validation and commits stay shared. */
export class DroppedFiles {
  private entries: Entry[] = [];
  private workspace = "";
  private active = false;
  private moving = false;
  private generation = 0;
  private abort?: AbortController;
  constructor(private host: Host) {}
  async open(paths: string[]) {
    const unique = [
      ...new Set(
        paths.filter((path) => typeof path === "string" && path.length > 0),
      ),
    ];
    if (!unique.length) return;
    if (this.active || !this.host.available()) {
      this.host.notice(
        "Finish or close the current dialog before dropping more files.",
      );
      return;
    }
    if (unique.length > 256) {
      this.host.notice("Drop up to 256 files at a time.");
      return;
    }
    const generation = ++this.generation;
    const current = () => this.active && generation === this.generation;
    this.active = true;
    this.moving = false;
    this.workspace = this.host.workspace();
    this.entries = unique.map((path) => ({
      path,
      name: path.split(/[\\/]/).pop() || path,
      status: "Pending",
    }));
    try {
      await this.host.settle();
      if (!current()) return;
      this.assertWorkspace();
      this.host.pause();
      const loading = this.host.importer.showFile(
        this.navigation(0),
        '<p role="status">Checking dropped files…</p>',
      );
      loading
        .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          ".import-file-navigation button,.import-file-navigation select",
        )
        .forEach((el) => (el.disabled = true));
      // A Shapefile's companions are collected by the existing GIS loader.
      const shapes = new Set(
        unique
          .filter((path) => /\.shp$/i.test(path))
          .map((path) => path.slice(0, -4)),
      );
      for (const entry of this.entries) {
        if (!current()) return;
        try {
          entry.admission = await inspectInput(entry.path);
          if (entry.admission.allowed === false) {
            entry.error =
              entry.admission.reason || "File exceeds its size limit.";
            entry.status = "Not imported";
          }
        } catch (error) {
          entry.error = String(error);
          entry.status = "Not imported";
        }
      }
      if (!current()) return;
      const confirmed = await confirmLargeInputs(
        this.entries
          .filter(
            (entry) => !entry.error && !/\.chronoscope$/i.test(entry.path),
          )
          .map((entry) => entry.admission!),
      );
      if (!current()) return;
      if (!confirmed)
        for (const entry of this.entries)
          if (
            entry.admission?.requires_confirmation &&
            !/\.chronoscope$/i.test(entry.path)
          )
            entry.status = "Skipped";
      for (const entry of this.entries) {
        if (!current()) return;
        this.assertWorkspace();
        if (entry.error || entry.status === "Skipped") continue;
        if (
          /\.(shx|dbf|prj|cpg)$/i.test(entry.path) &&
          shapes.has(entry.path.slice(0, -4))
        ) {
          entry.status = "Companion file";
          continue;
        }
        try {
          const controller = new AbortController();
          this.abort = controller;
          const probe = await runJob(
            "file_probe",
            { path: entry.path },
            {
              signal: controller.signal,
              progress: (state) => {
                const node = loading.querySelector('[role="status"]');
                if (node)
                  node.textContent = state.message || "Checking dropped file…";
              },
            },
          );
          if (this.abort === controller) this.abort = undefined;
          if (!current()) return;
          entry.kind = probe.kind;
          entry.format = probe.format || undefined;
          if (entry.kind === "workspace") {
            entry.error =
              "Workspace files open separately. Use Open to switch workspaces.";
            entry.status = "Not imported";
          } else if (displayOnly(entry.format)) {
            await this.addReference(entry);
          }
        } catch (error) {
          entry.error = String(error);
          entry.status = "Needs attention";
        }
      }
      if (!current()) return;
      if (
        this.entries.length === 1 &&
        this.entries[0].kind === "workspace"
      ) {
        this.active = false;
        // Close our review modal before the existing unsaved-work guard opens.
        this.host.importer.dismiss();
        await this.host.openWorkspace(this.entries[0].path);
        return;
      }
      const index = this.entries.findIndex((entry) => !terminal(entry));
      await this.show(index < 0 ? 0 : index);
    } catch (error) {
      if (generation !== this.generation) return;
      this.active = false;
      this.host.importer.dismiss();
      this.host.notice(String(error));
    }
  }
  private assertWorkspace() {
    if (!this.active || this.host.workspace() !== this.workspace)
      throw Error(
        "The workspace changed. Drop the remaining files again in the intended workspace.",
      );
  }
  private navigation(index: number): ImportNavigation {
    const entry = this.entries[index];
    if (entry.navigation) return entry.navigation;
    const generation = this.generation;
    const current = () => this.active && generation === this.generation;
    return (entry.navigation = {
      index,
      items: () => this.entries.map(({ name, status }) => ({ name, status })),
      navigate: async (next) => {
        if (current()) await this.show(next);
      },
      skip: async () => {
        if (!current()) return;
        if (!terminal(entry)) entry.status = "Skipped";
        await this.advance(index);
      },
      closed: () => {
        if (generation === this.generation) {
          this.active = false;
          this.abort?.abort();
        }
      },
      imported: async (workspace) => {
        if (!current()) return;
        entry.status = "Imported";
        entry.error = undefined;
        if (!workspace || workspace !== this.host.workspace()) {
          this.active = false;
          this.host.importer.dismiss();
          this.host.notice(
            "Import completed, but the workspace changed. Drop the remaining files again in the intended workspace.",
          );
          return;
        }
        this.workspace = workspace;
        if (this.active) await this.advance(index);
      },
      failed: (error) => {
        entry.error = error;
        entry.status = "Needs attention";
      },
      ...(!displayOnly(entry.format) && entry.kind === "gis"
        ? {
            display: async () => {
              if (this.moving) return;
              this.moving = true;
              try {
                await this.addReference(entry);
              } finally {
                this.moving = false;
              }
              await this.advance(index);
            },
          }
        : {}),
    });
  }
  private async addReference(entry: Entry) {
    this.assertWorkspace();
    await this.host.display(entry.path, entry.format!);
    entry.status = "Displayed";
    entry.error = undefined;
  }
  private async advance(index: number) {
    const order = [...this.entries.keys()]
      .slice(index + 1)
      .concat([...this.entries.keys()].slice(0, index));
    const next = order.find(
      (i) => !terminal(this.entries[i]) && !this.entries[i].error,
    );
    await this.show(next ?? index);
  }
  private async show(index: number) {
    if (index < 0 || index >= this.entries.length || this.moving) return;
    this.assertWorkspace();
    const entry = this.entries[index];
    // Classification may have mounted a loading page before discovering GIS.
    if (
      entry.navigation &&
      !terminal(entry) &&
      entry.kind === "gis" &&
      !displayOnly(entry.format)
    )
      entry.navigation.display = async () => {
        if (this.moving) return;
        this.moving = true;
        try {
          await this.addReference(entry);
        } finally {
          this.moving = false;
        }
        await this.advance(index);
      };
    const navigation = this.navigation(index);
    navigation.handled = terminal(entry);
    if (terminal(entry)) {
      navigation.display = undefined;
      const pending = this.entries.filter((item) => !terminal(item)).length;
      this.host.importer.showFile(
        navigation,
        `<h3>${esc(entry.name)}</h3><p role="status">${esc(entry.status)}${entry.status === "Companion file" ? " · included with its Shapefile" : ""}.</p><p class="description">${pending ? `${pending} file(s) still need review. Use the file menu or Previous/Next to return to them.` : "All dropped files have been handled. You can close this window."}</p>`,
      );
      return;
    }
    if (entry.error || entry.kind === "workspace") {
      this.host.importer.showFile(
        navigation,
        `<h3>${esc(entry.name)}</h3><p role="alert">${esc(entry.error || "Open workspace files separately.")}</p><p class="description">This file has not been imported. You can move to another file or close the queue.</p>${entry.kind === "data" ? '<button id="import-file-retry">Retry import</button>' : ""}`,
        (dialog) => {
          const retry =
            dialog.querySelector<HTMLButtonElement>("#import-file-retry");
          if (retry)
            retry.onclick = () => {
              entry.error = undefined;
              void this.openEvents(index);
            };
        },
      );
      return;
    }
    if (entry.kind === "gis") {
      this.host.importer.showFile(
        navigation,
        `<h3>${esc(entry.name)}</h3><p>Display this file as a reference layer, retaining supported shapes, styles and animation, or import it as Events for filtering and analysis.</p><p class="description">External links remain disabled. Reference layers do not use Event filters.</p><button id="import-file-events" class="primary">Import as Events…</button>`,
        (dialog) => {
          dialog.querySelector<HTMLButtonElement>(
            "#import-file-events",
          )!.onclick = () => void this.openEvents(index);
        },
      );
      return;
    }
    await this.openEvents(index);
  }
  private async openEvents(index: number) {
    try {
      this.assertWorkspace();
    } catch (error) {
      this.active = false;
      this.host.importer.dismiss();
      this.host.notice(String(error));
      return;
    }
    const entry = this.entries[index];
    await this.host.importer.open(
      entry.path,
      entry.navigation?.delimiter || "auto",
      undefined,
      true,
      this.navigation(index),
    );
  }
}
