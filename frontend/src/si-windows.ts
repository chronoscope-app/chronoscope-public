import { native } from "./bridge";
type Action = "before" | "after" | "settings" | "capture";
type Request = { id: string; action: Action };
type Reply = { id: string; result?: unknown; error?: string };
const channelName = "chronoscope-si-workspace";
/** Only the main window owns the map renderer. Chat windows request these four fixed actions. */
export async function workspaceHost(
  actions: Record<Action, () => Promise<unknown>>,
) {
  const handle = async (request: Request, reply: (value: Reply) => void) => {
    if (
      !request ||
      typeof request.id !== "string" ||
      request.id.length > 64 ||
      !Object.hasOwn(actions, request.action)
    )
      return;
    try {
      reply({ id: request.id, result: await actions[request.action]() });
    } catch (error) {
      reply({ id: request.id, error: String(error) });
    }
  };
  if (native) {
    const { listen, emitTo } = await import("@tauri-apps/api/event");
    return listen<Request>(
      "si-workspace-request",
      (event) =>
        void handle(
          event.payload,
          (value) => void emitTo("si-chat", "si-workspace-response", value),
        ),
    );
  }
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (e) => {
    if (e.data?.type === "request")
      void handle(e.data.request, (value) =>
        channel.postMessage({ type: "response", ...value }),
      );
  };
  return () => channel.close();
}
let counter = 0;
export async function workspaceAction(action: Action): Promise<any> {
  const id = `${Date.now().toString(16)}-${++counter}`;
  return new Promise(async (resolve, reject) => {
    let clean = () => {};
    const timer = setTimeout(() => {
      clean();
      reject(
        Error(
          "Main workspace did not respond. Return to Chronoscope and try again.",
        ),
      );
    }, 20000);
    const receive = (reply: Reply) => {
      if (reply?.id !== id) return;
      clearTimeout(timer);
      clean();
      reply.error ? reject(Error(reply.error)) : resolve(reply.result);
    };
    try {
      if (native) {
        const { listen, emitTo } = await import("@tauri-apps/api/event");
        clean = await listen<Reply>("si-workspace-response", (e) =>
          receive(e.payload),
        );
        await emitTo("main", "si-workspace-request", { id, action });
      } else {
        const channel = new BroadcastChannel(channelName);
        clean = () => channel.close();
        channel.onmessage = (e) => {
          if (e.data?.type === "response") receive(e.data);
        };
        channel.postMessage({ type: "request", request: { id, action } });
      }
    } catch (error) {
      clearTimeout(timer);
      clean();
      reject(error);
    }
  });
}
export class SIWindowHost {
  private popup: Window | null = null;
  private detached = false;
  constructor(
    private dock: () => Promise<void>,
    private hide: () => void,
  ) {
    if (native)
      void import("@tauri-apps/api/event").then(async ({ listen }) => {
        await listen("si-window-opened", () => {
          this.detached = true;
          this.hide();
        });
        await listen("si-window-docked", () => {
          this.detached = false;
          void this.dock();
        });
      });
    else
      setInterval(() => {
        if (this.detached && this.popup?.closed) {
          this.detached = false;
          this.popup = null;
          void this.dock();
        }
      }, 400);
  }
  async focus(): Promise<boolean> {
    if (native) {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<{ open: boolean }>("si_window", {
        action: "status",
      });
      this.detached = status.open;
      if (status.open) await invoke("si_window", { action: "focus" });
    } else if (this.detached && !this.popup?.closed) this.popup?.focus();
    return this.detached;
  }
  async open() {
    if (native) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("si_window", { action: "open" });
    } else {
      this.popup = window.open(
        "si.html",
        "chronoscope-si",
        "popup,width=860,height=900,resizable=yes,scrollbars=yes",
      );
      if (!this.popup)
        throw Error(
          "Allow this app's chat window in your browser, then try Pop out again.",
        );
    }
    this.detached = true;
    this.hide();
  }
}
export async function dockSIWindow() {
  if (native) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("si_window", { action: "dock" });
  } else window.close();
}
