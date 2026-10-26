import "./style.css";
import { call, native } from "./bridge";
import {
  attributeTableMarkup,
  createAttributeTables,
} from "./attribute-tables";
import { tableChannel } from "./table-windows";
import { setDateTimeDisplay, type Snapshot } from "./types";
if (!native) window.opener = null;
const host = document.querySelector<HTMLElement>("#table-panel")!;
host.innerHTML = attributeTableMarkup;
const error = (value: unknown) => {
  const el = document.querySelector<HTMLElement>("#table-window-error")!;
  el.textContent = String(value);
  el.hidden = false;
};
let snapshot: Snapshot;
let polling = false;
let initialized = false;
let lastRevision = -1;
let pending = Promise.resolve();
async function readSnapshot() {
  snapshot = (await call("snapshot", {
    compact: false,
    include_statistics: false,
  })) as Snapshot;
  setDateTimeDisplay(snapshot.preferences);
  const theme = snapshot.preferences.theme;
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
}
const tables = createAttributeTables(host, {
  snapshot: () => snapshot,
  error,
  changed: () => {
    if (initialized) channel.send({ kind: "state", state: tables.capture() });
  },
  refresh: async () => {
    await readSnapshot();
    await tables.render();
    channel.send({ kind: "refresh" });
  },
  detach: async () => {
    channel.send({ kind: "state", state: tables.capture() });
    channel.send({ kind: "dock" });
  },
});
const button = host.querySelector<HTMLButtonElement>("#table-popout")!;
button.textContent = "Dock";
button.setAttribute("aria-label", "Dock attribute tables");
button.title = "Return all attribute tabs to the main workspace";
let channel: Awaited<ReturnType<typeof tableChannel>>;
async function start() {
  channel = await tableChannel(false, (message) => {
    if (message.kind !== "state") return;
    pending = pending
      .then(async () => {
        await readSnapshot();
        await tables.receive(message.state);
        initialized = true;
      })
      .catch(error);
  });
  await readSnapshot();
  channel.send({ kind: "ready" });
  const timer = setInterval(() => {
    if (!initialized || polling) return;
    polling = true;
    pending = pending
      .then(async () => {
        await readSnapshot();
        if (snapshot.revision !== lastRevision) {
          lastRevision = snapshot.revision;
          await tables.render(undefined, undefined, false);
        }
      })
      .catch(error)
      .finally(() => {
        polling = false;
      });
  }, 600);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    channel.dispose();
  });
  if (native) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      channel.send({ kind: "state", state: tables.capture() });
      channel.send({ kind: "dock" });
    });
  }
}
void start().catch(error);
