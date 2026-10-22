/** Coordinates document saves, unsaved-work policy and close requests.
 * Dialogs, notifications and layout remain with the presentation layer. */
interface LifecycleStatus {
  dirty: boolean;
  auto_save_unsaved: boolean;
}
export interface WorkspaceHooks {
  settle: () => Promise<unknown>;
  status: () => Promise<LifecycleStatus>;
  autosave: () => Promise<unknown>;
  source: () => string | null;
  identity: () => string;
  chooseSavePath: () => Promise<string | null>;
  persist: (path: string, workspace: string) => Promise<unknown>;
  saved: (path: string) => void;
  confirmUnsaved: (action: string) => Promise<boolean>;
}
export class WorkspaceController {
  private saving?: Promise<boolean>;
  private autosaving?: Promise<void>;
  private closing?: Promise<void>;
  constructor(private hooks: WorkspaceHooks) {}

  save(saveAs = false): Promise<boolean> {
    if (this.saving) return this.saving;
    const work = this.saveOnce(saveAs);
    this.saving = work;
    void work
      .finally(() => {
        if (this.saving === work) this.saving = undefined;
      })
      .catch(() => {});
    return work;
  }
  private async saveOnce(saveAs: boolean) {
    await this.hooks.settle();
    const identity = this.hooks.identity();
    let path = saveAs ? null : this.hooks.source();
    if (!path) path = await this.hooks.chooseSavePath();
    if (!path) return false;
    if (this.hooks.identity() !== identity)
      throw Error(
        "CONFLICT: workspace changed while choosing the save destination",
      );
    if (!/\.(chronoscope|json)$/i.test(path)) path += ".chronoscope";
    await this.hooks.persist(path, identity);
    this.hooks.saved(path);
    return true;
  }
  async guard(action: string): Promise<boolean> {
    await this.hooks.settle();
    const status = await this.hooks.status();
    if (!status.dirty) return true;
    if (status.auto_save_unsaved) {
      await this.autosave();
      return true;
    }
    return this.hooks.confirmUnsaved(action);
  }
  autosave(): Promise<void> {
    if (this.autosaving) return this.autosaving;
    const work = (async () => {
      await this.hooks.settle();
      await this.hooks.autosave();
    })();
    this.autosaving = work;
    void work
      .finally(() => {
        if (this.autosaving === work) this.autosaving = undefined;
      })
      .catch(() => {});
    return work;
  }
  close(exit: () => Promise<unknown>): Promise<void> {
    if (this.closing) return this.closing;
    const work = (async () => {
      if (await this.guard("quit")) await exit();
    })();
    this.closing = work;
    void work
      .finally(() => {
        if (this.closing === work) this.closing = undefined;
      })
      .catch(() => {});
    return work;
  }
}
