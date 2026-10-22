import "./style.css";
import { call, native } from "./bridge";
import { SIChat } from "./si-chat";
import { workspaceAction, dockSIWindow } from "./si-windows";
// Browser preview receives a copy of the opener's sessionStorage token. It then
// drops opener access; all app operations still authenticate through bridge.ts.
if (!native) window.opener = null;
const error = (value: unknown) => {
  const el = document.querySelector<HTMLElement>("#si-window-error")!;
  el.textContent = String(value);
  el.hidden = false;
};
async function workspace(action: Parameters<typeof workspaceAction>[0]) {
  const result = await workspaceAction(action);
  document.querySelector<HTMLElement>("#si-window-error")!.hidden = true;
  return result;
}
const chat = new SIChat(document.querySelector("#si-chat")!, {
  configure: async () => {
    await workspace("settings");
  },
  before: async () => {
    await workspace("before");
  },
  after: async () => {
    await workspace("after");
  },
  capture: async () => await workspace("capture"),
  detach: dockSIWindow,
  close: dockSIWindow,
  detached: true,
  error,
});
async function theme() {
  const p = await call("preferences");
  document.documentElement.dataset.theme =
    p.theme === "system"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : p.theme;
}
void theme()
  .then(() => chat.open())
  .catch(error);
const timer = setInterval(() => void theme().catch(() => {}), 2000);
window.addEventListener("pagehide", () => {
  clearInterval(timer);
  chat.dispose();
});
if (native)
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    let closing = false;
    await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        await chat.flushDraft();
        await dockSIWindow();
      } catch (value) {
        closing = false;
        error(value);
      }
    });
  });
