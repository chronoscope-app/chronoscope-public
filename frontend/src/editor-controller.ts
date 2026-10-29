/** Drafts and submitted values outlive DOM refreshes. Presentation owns the form. */
export interface EditorTarget {
  workspace: string;
  id: string;
  revision: number;
  originalWkt: string;
}
/** Primitive UI identity captured before a local scene-only RPC. */
export interface SceneSyncFence {
  workspace: string;
  revision: number;
  expectedRevision?: number;
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

  /** Advance only a proven adjacent local scene commit, never arbitrary heads.
   * Submitted edits already own copies of their target and remain immutable.
   * Dirty fields and original source values are untouched by this acknowledgement.
   */
  acknowledgeScene(
    fence: SceneSyncFence,
    currentWorkspace: string,
    result: unknown,
  ) {
    if (
      fence.workspace !== currentWorkspace ||
      this.workspace !== fence.workspace ||
      !Number.isSafeInteger(fence.revision) ||
      fence.revision < 0 ||
      !result ||
      typeof result !== "object"
    )
      return false;
    const response = result as {
      revision?: unknown;
      dry_run?: unknown;
      executed?: unknown;
      commit_receipt?: unknown;
    };
    if (
      response.dry_run === true ||
      response.executed === false ||
      !response.commit_receipt ||
      typeof response.commit_receipt !== "object"
    )
      return false;
    const receipt = response.commit_receipt as Record<string, unknown>;
    const decimal = (value: unknown): value is string =>
      typeof value === "string" &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      value.length <= 20 &&
      BigInt(value) <= 18446744073709551615n;
    const separator = fence.workspace.lastIndexOf(":");
    if (
      separator <= 0 ||
      !decimal(fence.workspace.slice(separator + 1)) ||
      receipt.store_id !== fence.workspace.slice(0, separator) ||
      receipt.kind !== "workspace" ||
      receipt.committed !== true ||
      !decimal(receipt.revision_before) ||
      !decimal(receipt.revision_after) ||
      BigInt(receipt.revision_before) < BigInt(fence.revision) ||
      (fence.expectedRevision !== undefined &&
        (!Number.isSafeInteger(fence.expectedRevision) ||
          receipt.revision_before !== String(fence.expectedRevision))) ||
      BigInt(receipt.revision_after) !== BigInt(receipt.revision_before) + 1n ||
      !Number.isSafeInteger(response.revision) ||
      String(response.revision) !== receipt.revision_after
    )
      return false;
    let advanced = false;
    for (const draft of this.drafts.values()) {
      if (
        draft.target.workspace === fence.workspace &&
        String(draft.target.revision) === receipt.revision_before
      ) {
        draft.target = {
          ...draft.target,
          revision: response.revision as number,
        };
        advanced = true;
      }
    }
    return advanced;
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
