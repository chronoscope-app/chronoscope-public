import { native } from "./bridge";
import type { AttributeTables, AttributeTableState } from "./attribute-tables";

type Message =
  | { kind: "ready" }
  | { kind: "state"; state: AttributeTableState }
  | { kind: "refresh" }
  | { kind: "dock" };
/** Fixed local table surface; records and selection remain in the shared engine. */
export async function tableChannel(
  main: boolean,
  receive: (message: Message) => void,
) {
  if (native) {
    const { listen, emitTo } = await import("@tauri-apps/api/event");
    const unlisten = await listen<Message>(
      main ? "table-main" : "table-child",
      (event) => receive(event.payload),
    );
    return {
      send: (message: Message) => {
        void emitTo(
          main ? "attribute-tables" : "main",
          main ? "table-child" : "table-main",
          message,
        );
      },
      dispose: unlisten,
    };
  }
  const channel = new BroadcastChannel("chronoscope-attribute-tables");
  channel.onmessage = (event) => {
    if (event.data?.main !== main) receive(event.data.message);
  };
  return {
    send: (message: Message) => channel.postMessage({ main, message }),
    dispose: () => channel.close(),
  };
}
export class TableWindowHost {
  detached = false;
  private popup: Window | null = null;
  private applying = false;
  private lastSent = "";
  private queue = Promise.resolve();
  private channel = tableChannel(true, (message) => {
    this.queue = this.queue
      .then(async () => {
        if (message.kind === "ready") {
          this.lastSent = "";
          this.publish();
        } else if (message.kind === "state" && this.detached) {
          this.applying = true;
          try {
            await this.tables.receive(message.state);
            if (!message.state.open) await this.dock();
          } finally {
            this.applying = false;
          }
        } else if (message.kind === "refresh") await this.changed();
        else if (message.kind === "dock") await this.dock();
      })
      .catch(this.error);
  });
  constructor(
    private tables: AttributeTables,
    private changed: () => Promise<void>,
    private error: (error: unknown) => void,
  ) {
    if (native) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen(
            "table-window-docked",
            () => void this.returnToWorkspace().catch(error),
          ),
        )
        .catch(error);
    } else {
      const timer = setInterval(() => {
        if (this.detached && this.popup?.closed)
          void this.returnToWorkspace().catch(error);
      }, 300);
      window.addEventListener("pagehide", () => {
        clearInterval(timer);
        this.popup?.close();
      });
    }
  }
  publish() {
    if (!this.detached || this.applying) return;
    const state = this.tables.capture();
    const serialized = JSON.stringify(state);
    if (serialized === this.lastSent) return;
    this.lastSent = serialized;
    void this.channel
      .then((channel) => channel.send({ kind: "state", state }))
      .catch(this.error);
  }
  async focus() {
    if (!this.detached) return;
    if (native) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("table_window", { action: "focus" });
    } else this.popup?.focus();
  }
  async open() {
    if (this.detached) return this.focus();
    // Open browser popups before awaiting IPC so the user gesture is retained.
    if (!native) {
      this.popup = window.open(
        "tables.html",
        "chronoscope-attributes",
        "popup,width=1100,height=600,resizable=yes,scrollbars=yes",
      );
      if (!this.popup)
        throw Error(
          "Allow this app's attribute window in your browser, then try Detach again.",
        );
    } else {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("table_window", { action: "open" });
    }
    this.detached = true;
    this.lastSent = "";
    this.publish();
    await this.changed();
  }
  private async returnToWorkspace() {
    if (!this.detached) return;
    this.detached = false;
    this.popup = null;
    await this.changed();
  }
  private async dock() {
    if (native) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("table_window", { action: "dock" });
    } else this.popup?.close();
    await this.returnToWorkspace();
  }
}
