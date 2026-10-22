import { invoke } from "@tauri-apps/api/core";
import type { EngineCommand, EngineContracts, ErrorCode } from "./contracts";
export type { EngineCommand } from "./contracts";
export class CommandError extends Error {
  readonly code: ErrorCode;
  constructor(value: unknown) {
    const failure = value as { message?: unknown; code?: ErrorCode };
    super(
      typeof failure?.message === "string"
        ? failure.message
        : typeof value === "string"
          ? value
          : "Backend request failed",
    );
    this.name = "CommandError";
    this.code = failure?.code || "OPERATION_FAILED";
  }
}
export const native = "__TAURI_INTERNALS__" in window;
let token =
  sessionStorage.getItem("chronoscope-token") ||
  new URLSearchParams(location.hash.slice(1)).get("token") ||
  "";
if (token) {
  sessionStorage.setItem("chronoscope-token", token);
  history.replaceState(null, "", location.pathname + location.search);
}
type Executed<K extends EngineCommand> = Exclude<
  EngineContracts[K]["result"],
  { dry_run: true }
>;
type OptionalCommand = {
  [K in EngineCommand]: {} extends EngineContracts[K]["args"] ? K : never;
}[EngineCommand];
type ResultFor<K extends EngineCommand, A> = A extends { dry_run?: infer D }
  ? true extends D
    ? EngineContracts[K]["result"]
    : Executed<K>
  : Executed<K>;
export function call<K extends OptionalCommand>(
  command: K,
): Promise<Executed<K>>;
export function call<
  K extends EngineCommand,
  const A extends EngineContracts[K]["args"],
>(command: K, args: A): Promise<ResultFor<K, A>>;
export async function call(
  command: EngineCommand,
  args: unknown = {},
): Promise<unknown> {
  if (native) {
    try {
      return await invoke("dispatch", { command, args });
    } catch (error) {
      throw new CommandError(error);
    }
  }
  if (!token)
    throw new Error(
      "Browser preview requires the local bridge token in #token=…",
    );
  const response = await fetch("/api/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ command, args }),
  });
  const data = await response.json();
  if (!response.ok) throw new CommandError(data.error);
  return data.result;
}
export async function chooseFile(
  options: {
    title?: string;
    directory?: boolean;
    save?: boolean;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  } = {},
): Promise<string | null> {
  if (native) {
    const { open, save } = await import("@tauri-apps/plugin-dialog");
    return options.save
      ? save({
          title: options.title,
          defaultPath: options.defaultPath,
          filters: options.filters,
        })
      : (open({
          title: options.title,
          directory: options.directory,
          multiple: false,
          filters: options.filters,
        }) as Promise<string | null>);
  }
  return window.prompt(
    options.title ||
      (options.directory ? "Local folder path" : "Local file path"),
    options.defaultPath || "",
  );
}
