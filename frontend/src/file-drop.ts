import { native } from "./bridge";
import "./file-drop.css";
/** Native drops supply real paths; browser File objects cannot access local paths. */
export async function installFileDrops(
  open: (paths: string[]) => Promise<void>,
  notice: (message: string) => void,
) {
  const hint = document.createElement("div");
  hint.className = "file-drop-hint";
  hint.textContent = "Drop files to import or display";
  hint.setAttribute("role", "status");
  hint.hidden = true;
  document.body.append(hint);
  const controller = new AbortController();
  const options = { signal: controller.signal };
  document.addEventListener(
    "dragover",
    (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    },
    options,
  );
  document.addEventListener(
    "drop",
    (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      if (!native)
        notice(
          "File dropping is available in the desktop app. Use Open in this browser preview.",
        );
    },
    options,
  );
  let unlisten: (() => void) | undefined;
  const dispose = () => {
    unlisten?.();
    controller.abort();
    hint.remove();
  };
  try {
    if (native) {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const drop = event.payload;
        hint.hidden = drop.type !== "enter" && drop.type !== "over";
        if (drop.type === "drop")
          void open(drop.paths).catch((error) => notice(String(error)));
      });
    }
  } catch (error) {
    dispose();
    throw error;
  }
  window.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}
