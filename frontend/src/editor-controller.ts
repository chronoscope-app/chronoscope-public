/** Drafts and submitted values outlive DOM refreshes. Presentation owns the form. */
export interface EditorTarget {
  workspace: string;
  id: string;
  revision: number;
  originalWkt: string;
}
export interface EditorSubmission {
  target: EditorTarget;
  values: Record<string, string>;
}
type Draft = EditorSubmission & { dirty: Set<string> };

export class EditorController {
  private workspace?: string;
  private active?: Draft;
  private drafts = new Map<string, Draft>();
  private pending: Promise<void> = Promise.resolve();

  get target() {
    return this.active ? { ...this.active.target } : undefined;
  }

  open(target: EditorTarget, values: Record<string, string>) {
    if (target.workspace !== this.workspace) {
      this.drafts.clear();
      this.workspace = target.workspace;
    }
    let draft = this.drafts.get(target.id);
    if (!draft) {
      if (this.drafts.size >= 32)
        this.drafts.delete(this.drafts.keys().next().value!);
      draft = {
        target: { ...target },
        values: { ...values },
        dirty: new Set(),
      };
      this.drafts.set(target.id, draft);
    } else {
      draft.target = { ...target };
      for (const [key, value] of Object.entries(values))
        if (!draft.dirty.has(key)) draft.values[key] = value;
    }
    this.active = draft;
    return { ...draft.values };
  }

  deactivate() {
    this.active = undefined;
  }

  change(field: string, value: string) {
    if (!this.active) return;
    this.active.values[field] = value;
    this.active.dirty.add(field);
  }

  submit<T>(
    prepare: (submission: EditorSubmission) => Promise<T>,
    persist: (submission: EditorSubmission, prepared: T) => Promise<unknown>,
  ): Promise<void> {
    const draft = this.active;
    if (!draft) return Promise.reject(Error("No event is selected"));
    // Capture everything synchronously, before parsing or any other awaited work.
    const submission = {
      target: { ...draft.target },
      values: { ...draft.values },
    };
    const check = () => {
      if (this.workspace !== submission.target.workspace)
        throw Error("CONFLICT: workspace changed before the edit completed");
    };
    const work = this.pending.then(async () => {
      check();
      const prepared = await prepare(submission);
      check();
      await persist(submission, prepared);
      for (const [key, value] of Object.entries(submission.values))
        if (draft.values[key] === value) draft.dirty.delete(key);
    });
    this.pending = work.catch(() => {});
    return work;
  }

  idle() {
    return this.pending;
  }
}
