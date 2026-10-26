import { call, chooseFile } from "./bridge";
interface Hooks {
  configure: () => Promise<void>;
  before: () => Promise<void>;
  after: () => Promise<void>;
  error: (error: unknown) => void;
  capture?: () => Promise<string>;
  detach?: () => Promise<void>;
  close?: () => Promise<void>;
  detached?: boolean;
}
interface LocalDraft {
  session: string | null;
  generation: number;
  text: string;
}
/** Rust owns messages and jobs. Every WebView is a replaceable session client. */
export class SIChat {
  private busy = false;
  private submitting = false;
  private stopping = false;
  private connected = false;
  private root: string | null = null;
  private revision: number | undefined;
  private session: string | null | undefined;
  private syncing: Promise<void> | undefined;
  private retryAt = 0;
  private syncFailure = "";
  private disposed = false;
  private initialized = false;
  private sessionReady = false;
  private heldDraft: LocalDraft | null = null;
  private localDraft: LocalDraft | undefined;
  private draftGeneration = 0;
  private viewEpoch = 0;
  private messages: HTMLElement;
  private prompt: HTMLTextAreaElement;
  private progress: HTMLElement;
  private sendButton: HTMLButtonElement;
  private stopButton: HTMLButtonElement;
  private draftWrites: Promise<unknown> = Promise.resolve();
  private draftDirty = false;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setInterval>;
  private entries = new Map<
    string,
    { node: HTMLElement; dispose: (() => void)[] }
  >();
  constructor(
    private host: HTMLElement,
    private hooks: Hooks,
  ) {
    host.innerHTML = `<header class="si-chat-header"><strong>SI</strong><span class="spacer"></span><button id="si-new" title="Clear this session’s conversation">New chat</button><button id="si-popout" title="${hooks.detached ? "Return chat to the main workspace" : "Move chat to a separate window"}" aria-label="${hooks.detached ? "Dock SI chat" : "Pop out SI chat"}">${hooks.detached ? "Dock" : "↗"}</button><button id="si-settings" class="icon" title="SI settings: service and tools" aria-label="SI settings">⚙</button><button id="si-close" title="Close chat; an active request continues" aria-label="Close SI chat">×</button></header>
      <p class="si-chat-note">Super Intelligence · Session-only conversation. Requested data is sent to your service.</p>
      <div id="si-messages" class="si-messages" role="log" aria-label="SI conversation" aria-live="polite"></div>
      <details class="si-permissions"><summary>Permissions</summary><label class="check-row"><input id="si-edits" type="checkbox"> Allow record changes for the next message</label><p>Filtering, selection and views are available by default. Record changes include editing, deleting, aggregation and import/export. Save a copy first; completed actions remain if stopped.</p><label class="check-row"><input id="si-external-actions" type="checkbox"> Allow granted external actions for the next message</label><p>External effects cannot be undone here. Review tools in SI settings → Tools; reading tools need an explicit grant too.</p><div class="si-file-permissions"><p id="si-folder">No file access. A folder is optional, for importing and saving files.</p><div class="row"><button id="si-grant">Allow folder…</button><button id="si-revoke">Remove access</button></div></div></details>
      <form id="si-form"><label class="sr-only" for="si-prompt">Message Super Intelligence</label><textarea id="si-prompt" rows="3" maxlength="16384" placeholder="Ask about this workspace or request an action…"></textarea><div class="row"><button id="si-capture" type="button" title="Add a current map snapshot to chat. Its pixels are not sent to the SI service.">Capture map</button><small id="si-progress" role="status"></small><span class="spacer"></span><button id="si-stop" type="button" hidden>Stop</button><button id="si-send" type="submit" class="primary">Send</button></div></form>`;
    this.messages = host.querySelector("#si-messages")!;
    this.prompt = host.querySelector("#si-prompt")!;
    this.progress = host.querySelector("#si-progress")!;
    this.sendButton = host.querySelector("#si-send")!;
    this.stopButton = host.querySelector("#si-stop")!;
    this.sendButton.disabled = true;
    this.prompt.disabled = true;
    (host.querySelector("#si-new") as HTMLButtonElement).disabled = true;
    const on = (selector: string, action: () => Promise<void> | void) =>
      host
        .querySelector(selector)!
        .addEventListener("click", () =>
          Promise.resolve().then(action).catch(hooks.error),
        );
    on("#si-close", async () => {
      await this.flushDraft();
      if (hooks.close) await hooks.close();
      else this.hide();
    });
    on("#si-popout", async () => {
      const button = host.querySelector<HTMLButtonElement>("#si-popout")!;
      button.disabled = true;
      try {
        await this.flushDraft();
        await hooks.detach?.();
      } finally {
        button.disabled = false;
      }
    });
    on("#si-settings", hooks.configure);
    on("#si-new", async () => {
      await this.flushDraft();
      await call("si_clear");
      this.draftGeneration++;
      this.localDraft = undefined;
      this.heldDraft = null;
      this.prompt.readOnly = false;
      clearTimeout(this.draftTimer);
      this.draftDirty = false;
      this.prompt.value = "";
      await this.sync();
      this.progress.textContent = "Conversation cleared";
    });
    on("#si-grant", async () => {
      const root = await chooseFile({ directory: true });
      if (root) {
        await call("si_permissions", { root });
        await this.connection();
      }
    });
    on("#si-revoke", async () => {
      await call("si_permissions", { root: null });
      await this.connection();
    });
    on("#si-stop", async () => {
      await call("si_cancel");
      const state = await call("si_chat_state");
      if (state.active?.job_id)
        await call("job_cancel", { job_id: state.active.job_id });
      this.progress.textContent = "Stopping… Completed actions remain.";
    });
    on("#si-capture", async () => {
      const button = host.querySelector<HTMLButtonElement>("#si-capture")!;
      button.disabled = true;
      try {
        if (!hooks.capture) throw Error("Map capture is unavailable");
        const data_url = await hooks.capture();
        await call("si_chat_attach", { data_url, title: "Current map view" });
        await this.sync();
      } finally {
        button.disabled = false;
      }
    });
    host.querySelector("#si-form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.send().catch(hooks.error);
    });
    this.prompt.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.send().catch(hooks.error);
      }
    });
    this.prompt.addEventListener("input", () => {
      this.draftDirty = true;
      this.captureDraft();
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(
        () => void this.flushDraft().catch(hooks.error),
        250,
      );
    });
    if (!hooks.detach)
      (host.querySelector("#si-popout") as HTMLElement).hidden = true;
    this.timer = setInterval(() => {
      if (!host.hidden && !this.disposed && Date.now() >= this.retryAt)
        void this.sync()
          .then(() => {
            this.syncFailure = "";
          })
          .catch((error) => {
            const message = String(error);
            if (message !== this.syncFailure) hooks.error(error);
            this.syncFailure = message;
            this.retryAt = Date.now() + 3000;
          });
    }, 500);
  }
  hide() {
    this.viewEpoch++;
    for (const entry of this.entries.values())
      for (const cleanup of entry.dispose) cleanup();
    this.entries.clear();
    this.messages.replaceChildren();
    this.revision = undefined;
    this.host.hidden = true;
    document.querySelector("#si")?.setAttribute("aria-expanded", "false");
  }
  async open(focus = true) {
    this.host.hidden = false;
    document.querySelector("#si")?.setAttribute("aria-expanded", "true");
    const epoch = ++this.viewEpoch;
    this.revision = undefined;
    this.sessionReady = false;
    this.sendButton.disabled = true;
    this.prompt.disabled = true;
    this.progress.textContent = "Synchronizing…";
    // A configure/open must wait out the previous view's poll, then read the
    // current conversation before accepting a draft for that session.
    await this.syncing?.catch(() => {});
    if (!this.isCurrentView(epoch)) return;
    await (this.syncing || this.sync());
    if (!this.isCurrentView(epoch)) return;
    this.prompt.disabled = this.submitting || !this.sessionReady;
    this.showHeldDraft();
    if (focus) this.prompt.focus();
  }
  async flushDraft() {
    clearTimeout(this.draftTimer);
    if (!this.draftDirty || this.heldDraft) return;
    const draft = this.captureDraft(),
      text = draft.text,
      session_id = draft.session;
    this.draftWrites = this.draftWrites
      .catch(() => {})
      .then(() => call("si_chat_draft", { text, session_id }));
    try {
      await this.draftWrites;
    } catch (error) {
      if (String(error).includes("CONFLICT: conversation changed"))
        this.holdDraft(draft);
      throw error;
    }
    if (this.prompt.value === text) this.draftDirty = false;
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.draftTimer);
    for (const entry of this.entries.values())
      for (const cleanup of entry.dispose) cleanup();
  }
  private isCurrentView(epoch: number) {
    return epoch === this.viewEpoch && !this.disposed && !this.host.hidden;
  }
  private captureDraft(): LocalDraft {
    const session = this.session ?? null;
    if (
      !this.localDraft ||
      this.localDraft.session !== session ||
      this.localDraft.generation !== this.draftGeneration
    )
      this.localDraft = {
        session,
        generation: this.draftGeneration,
        text: this.prompt.value,
      };
    else this.localDraft.text = this.prompt.value;
    return this.localDraft;
  }
  private holdDraft(draft: LocalDraft) {
    // A late failed save must not replace a newer draft object or resurrect
    // text the user explicitly cleared.
    if (draft !== this.localDraft || draft.generation !== this.draftGeneration)
      return;
    // Pending saves retain this draft object, whose text follows newer input
    // for the same session even before the next debounce has saved it.
    this.heldDraft = draft;
    this.draftDirty = false;
    clearTimeout(this.draftTimer);
    this.showHeldDraft();
  }
  private showHeldDraft() {
    if (!this.heldDraft || this.disposed || this.host.hidden) return;
    if (this.prompt.value !== this.heldDraft.text)
      this.prompt.value = this.heldDraft.text;
    this.prompt.readOnly = true;
    this.prompt.disabled = false;
    this.sessionReady = false;
    this.sendButton.disabled = true;
    this.progress.textContent =
      "Service changed. This draft was not sent. Copy it or start a new chat.";
  }
  private async connection(epoch = this.viewEpoch) {
    const status = await call("si_status");
    if (!this.isCurrentView(epoch)) return false;
    // Connecting between the state and status reads must not enable a draft
    // still bound to the disconnected conversation (or the reverse).
    if (status.connected !== (this.session != null)) {
      this.revision = undefined;
      this.sessionReady = false;
      this.sendButton.disabled = true;
      this.prompt.disabled = true;
      this.progress.textContent = "Synchronizing…";
      this.showHeldDraft();
      return false;
    }
    this.connected = status.connected;
    this.root = status.root;
    this.host.querySelector("#si-folder")!.textContent = this.root
      ? `File access: ${this.root}. Used only when record changes are allowed. Ends on disconnect.`
      : "No file access. A folder is optional, for importing and saving files.";
    this.sendButton.disabled =
      this.busy || status.running || !this.connected || !this.sessionReady;
    (this.host.querySelector("#si-new") as HTMLButtonElement).disabled =
      this.busy || status.running;
    (this.host.querySelector("#si-grant") as HTMLButtonElement).disabled =
      this.busy || !this.connected;
    (this.host.querySelector("#si-revoke") as HTMLButtonElement).disabled =
      this.busy || !this.root;
    this.stopButton.hidden = this.submitting || (!this.busy && !status.running);
    this.stopButton.disabled = this.stopping;
    return status;
  }
  private sync(): Promise<void> {
    if (this.syncing || this.submitting || this.disposed || this.host.hidden)
      return Promise.resolve();
    const epoch = this.viewEpoch;
    this.syncing = this.syncState(epoch).finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }
  private async syncState(epoch: number) {
    const state = await call(
      "si_chat_state",
      this.revision == null ? {} : { since_revision: this.revision },
    );
    if (!this.isCurrentView(epoch)) return;
    const wasBusy = this.busy;
    this.busy = this.submitting || !!state.active;
    this.stopping = state.active?.cancel_requested === true;
    if (state.active)
      this.progress.textContent = this.stopping
        ? "Stopping… Completed actions remain."
        : state.active.message || "Working…";
    if (this.session !== state.session_id) {
      this.sessionReady = false;
      this.sendButton.disabled = true;
      this.prompt.disabled = true;
      clearTimeout(this.draftTimer);
      this.draftDirty = false;
      for (const entry of this.entries.values())
        for (const cleanup of entry.dispose) cleanup();
      this.entries.clear();
      this.messages.replaceChildren();
      this.session = state.session_id;
    }
    if (state.messages) {
      const keep = new Set(state.messages.map((m: any) => m.id));
      for (const [id, entry] of this.entries)
        if (!keep.has(id)) {
          for (const cleanup of entry.dispose) cleanup();
          entry.node.remove();
          this.entries.delete(id);
        }
      for (const message of state.messages) {
        if (!this.isCurrentView(epoch)) break;
        if (!this.entries.has(message.id)) await this.append(message);
      }
    }
    if (!this.isCurrentView(epoch)) return;
    this.revision = state.revision;
    if (
      !this.draftDirty &&
      !this.heldDraft &&
      typeof state.draft === "string" &&
      this.prompt.value !== state.draft
    )
      this.prompt.value = state.draft;
    if (wasBusy && !this.busy) await this.hooks.after().catch(this.hooks.error);
    if (!this.isCurrentView(epoch)) return;
    const connection = await this.connection(epoch);
    if (!connection) return;
    if (!this.isCurrentView(epoch)) return;
    // Session identity and its draft/messages must publish together. Permission
    // status refreshes alone cannot make a partially rendered session sendable.
    this.sessionReady = !this.heldDraft;
    this.sendButton.disabled =
      this.busy || connection.running || !this.connected || !this.sessionReady;
    if (!this.initialized) this.initialized = true;
    this.prompt.disabled = this.submitting;
    if (this.heldDraft) {
      this.showHeldDraft();
      return;
    }
    if (!state.active && !this.submitting)
      this.progress.textContent = this.connected
        ? "Ready"
        : "Use SI settings ⚙ to connect a service";
  }
  private async append(message: any) {
    const node = document.createElement("article");
    node.className = `si-message si-message-${["user", "assistant"].includes(message.role) ? message.role : "notice"}`;
    node.dataset.messageId = message.id;
    const label = document.createElement("strong");
    label.textContent =
      message.role === "user"
        ? "You"
        : message.role === "assistant"
          ? "SI"
          : "Notice";
    node.append(label);
    const entry = { node, dispose: [] as (() => void)[] };
    this.entries.set(message.id, entry);
    this.messages.append(node);
    const body = document.createElement("div");
    body.textContent = message.content;
    node.append(body);
    if (message.role === "assistant") {
      try {
        const { renderMarkdown } = await import("./si-markdown");
        if (!this.disposed && node.isConnected)
          body.replaceWith(renderMarkdown(message.content));
      } catch (error) {
        this.hooks.error(error);
      }
    }
    if (message.blocks?.length) {
      const { renderRichBlock } = await import("./si-rich");
      for (const block of message.blocks) {
        const placeholder = document.createElement("p");
        placeholder.textContent = "Loading result…";
        node.append(placeholder);
        void renderRichBlock(block, this.hooks)
          .then((result) => {
            if (!this.disposed && placeholder.isConnected) {
              placeholder.replaceWith(result.node);
              entry.dispose.push(result.dispose);
            } else result.dispose();
          })
          .catch((error) => {
            placeholder.textContent = `Result unavailable: ${String(error)}`;
          });
      }
    }
    if (message.tool_calls?.length) {
      const detail = document.createElement("details"),
        summary = document.createElement("summary"),
        audit = document.createElement("pre");
      summary.textContent = `${message.tool_calls.length} tool actions`;
      audit.textContent = message.tool_calls
        .map((t: any) => `${t.tool} · ${t.ok ? "completed" : t.error}`)
        .join("\n");
      detail.append(summary, audit);
      node.append(detail);
    }
    if (message.completed === false) {
      const note = document.createElement("p");
      note.textContent =
        "Step limit reached; inspect completed actions before continuing.";
      node.append(note);
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }
  private async send() {
    const prompt = this.prompt.value.trim();
    if (this.busy || !this.sessionReady || this.heldDraft || !prompt) return;
    if (!this.connected) {
      await this.hooks.configure();
      return;
    }
    const intendedSession = this.session;
    if (intendedSession == null) return;
    const draft = this.captureDraft();
    const edits = this.host.querySelector<HTMLInputElement>("#si-edits")!,
      actions = this.host.querySelector<HTMLInputElement>(
        "#si-external-actions",
      )!;
    const allow_edits = edits.checked,
      allow_external_actions = actions.checked;
    edits.checked = false;
    actions.checked = false;
    // A poll started before this send may finish after the worker was queued.
    // Its idle state must not replace this request's progress or messages.
    this.viewEpoch++;
    this.busy = true;
    this.submitting = true;
    this.sendButton.disabled = true;
    this.prompt.disabled = true;
    this.progress.textContent = "Starting…";
    try {
      await this.flushDraft();
      await this.hooks.before();
      await call("si_chat_send", {
        request_id: crypto.randomUUID().replaceAll("-", ""),
        prompt,
        allow_edits,
        allow_external_actions,
        expected_session: intendedSession,
      });
      this.draftGeneration++;
      this.localDraft = undefined;
      this.prompt.value = "";
      this.draftDirty = false;
      this.revision = undefined;
    } catch (error) {
      this.busy = false;
      if (String(error).includes("CONFLICT: conversation changed"))
        this.holdDraft(draft);
      throw error;
    } finally {
      this.submitting = false;
      this.prompt.disabled = false;
      await this.sync();
      this.showHeldDraft();
    }
  }
}
