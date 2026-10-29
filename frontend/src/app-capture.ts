import { invoke } from "@tauri-apps/api/core";
import { native } from "./bridge";

/** Real native WebView pixels, including overlays. Never a DOM reconstruction. */
export async function captureAppWindow(label: "main" | "si-chat" = "main") {
  if (!native)
    throw Error(
      "UNAVAILABLE: whole-app screenshots require the native desktop",
    );
  // Permit current layout/fonts and canvas requests to reach the compositor.
  // A background/throttled window must not hang screenshot requests indefinitely.
  await Promise.race([
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 200)),
  ]);
  return invoke<string>("capture_app_window", { label });
}

export async function recordAppWindow(args: Record<string, unknown>) {
  if (!native)
    throw Error(
      "UNAVAILABLE: video recording requires an attached native desktop",
    );
  return invoke<Record<string, unknown>>("record_app_window", { args });
}
