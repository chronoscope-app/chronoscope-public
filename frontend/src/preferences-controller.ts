import { call, chooseFile, native } from "./bridge";
import {
  escape as esc,
  dateFormats,
  displayDate,
  displayClock,
  timeFormats,
  type Preferences,
} from "./types";
import {
  preferencesLayout,
  bindPreferencesLayout,
  type PreferencesSection,
} from "./preferences-layout";

interface Hooks {
  preferences(): Preferences;
  budget(): 20000 | 100000;
  save(preferences: Preferences, budget: 20000 | 100000): Promise<void>;
  $(selector: string): HTMLElement;
  input(selector: string): string;
  check(selector: string): boolean;
  on(selector: string, handler: (event: Event) => unknown): void;
  modal(html: string, small?: boolean): HTMLElement;
  closeModal(): void;
  head(title: string): string;
  toast(message: string, error?: boolean): void;
  mountMaps?(
    panel: HTMLElement,
    navigation: { beforeOpen(): void; back(): Promise<void> },
  ): void;
  updateChecks?(): boolean;
  setUpdateChecks?(enabled: boolean): void;
}
type PreferencesDraft = {
  theme: Preferences["theme"];
  coordinates: Preferences["coordinates"];
  dateFormat: Preferences["date_format"];
  timeFormat: Preferences["time_format"];
  autoSave: boolean;
  aiToolbarSI: boolean;
  basemap: Preferences["basemap"];
  updateChecks: boolean;
  budget: number;
};

/** Preferences owns its form/draft/agent-setup flow; the app owns persistence. */
export function createPreferencesController(hooks: Hooks) {
  const { $, input, check, on, modal, closeModal, head, toast } = hooks;
  async function settings(
    section: PreferencesSection = "general",
    draft?: PreferencesDraft,
  ) {
    const lifecycle = await call("workspace_status");
    const agent = native
      ? await (await import("@tauri-apps/api/core")).invoke<any>("agent_status")
      : { enabled: false };
    // Read live values after asynchronous status/setup work, as the original
    // app controller did. An engine update can arrive while status is pending.
    const preferences = hooks.preferences();
    const renderBudget = hooks.budget();
    const dialog = modal(
      `${head("Preferences")}${preferencesLayout({
        general: `<div class="modal-grid"><label class="field">Appearance<select id="pref-theme">${["system", "light", "dark"].map((t) => `<option value="${t}" ${t === (draft?.theme ?? preferences.theme) ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></label><label class="field">Display coordinates<select id="pref-coordinates">${[
          ["dd", "Decimal degrees (DD)"],
          ["dms", "Degrees/minutes/seconds (DMS)"],
          ["utm", "Universal Transverse Mercator (UTM)"],
          ["mgrs", "Military Grid Reference System (MGRS)"],
        ]
          .map(
            ([t, label]) =>
              `<option value="${t}" ${t === (draft?.coordinates ?? preferences.coordinates) ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label><label class="field">Date format<select id="pref-date-format">${dateFormats.map(([value, label]) => `<option value="${value}" ${value === (draft?.dateFormat ?? preferences.date_format ?? "system") ? "selected" : ""}>${label}</option>`).join("")}</select><small id="pref-date-preview"></small></label><label class="field">Time format<select id="pref-time-format">${timeFormats.map(([value, label]) => `<option value="${value}" ${value === (draft?.timeFormat ?? preferences.time_format ?? "system") ? "selected" : ""}>${label}</option>`).join("")}</select><small id="pref-time-preview"></small></label></div><div id="pref-update-options"></div><p class="description">Dates and times are displayed in UTC. These choices change readouts only; exact editing, imports, exports and stored timestamps retain their original precision.</p>`,
        workspace: `<label class="check-row"><input id="pref-autosave" type="checkbox" ${(draft?.autoSave ?? lifecycle.auto_save_unsaved) ? "checked" : ""}> Automatically save unsaved work</label><p class="description">Saves a copy every 30 seconds and before switching workspaces or quitting. Previous-session work is saved here automatically, without recovery prompts.</p><div class="notice mono">${esc(lifecycle.document_directory)}</div>`,
        display: `<label class="field">Marker budget<select id="pref-render-budget"><option value="20000" ${(draft?.budget ?? renderBudget) === 20000 ? "selected" : ""}>20,000 representatives in Points mode</option><option value="100000" ${(draft?.budget ?? renderBudget) === 100000 ? "selected" : ""}>100,000 representatives (uses more memory)</option></select></label><p class="description">This workspace setting changes the maximum in Points mode. Automatic display uses count clusters above 2,000 located records. Heat map and bloom are off by default. Exact queries and selection retain all matching records.</p>`,
        agents: `<p class="notice"><strong>Changes apply immediately.</strong> Agent access and folder actions are separate from saved preferences. Closing or cancelling this dialog does not undo them.</p><div class="agent-access-actions"><div class="notice mono agent-commands">${esc(agent.cli ? `"${agent.cli}" agent enable\n"${agent.cli}" --attach call snapshot\n"${agent.cli}" mcp --attach` : "chronoscope agent enable\nchronoscope --attach call snapshot\nchronoscope mcp --attach")}</div><p class="description">Enable once here or run <code>agent enable</code> from a terminal. No folder is required: agents can operate the live workspace and exchange files in a private app folder. Access stays enabled across launches. Optionally choose a different folder for importing/exporting files. The app executable shown above also runs the CLI; a separate CLI download or administrator install is unnecessary.</p><div class="notice">AI agent access: ${agent.enabled ? `enabled · ${esc(agent.root)}<br>Connection: ${esc(agent.descriptor)}` : "disabled"}</div>${native ? `<button id="agent-toggle" class="secondary">${agent.enabled ? "Disable AI agent access" : "Enable AI agent access"}</button><button id="agent-folder">Choose folder and enable access…</button><button id="agent-default-folder">Enable access with default folder</button><button id="agent-config">MCP setup</button>` : ""}</div>`,
      })}<footer><button data-close>Close without saving preferences</button><span class="spacer"></span><button id="save-preferences" class="primary">Save preferences</button></footer>`,
    );
    const general = dialog.querySelector<HTMLElement>("#pref-update-options");
    general?.insertAdjacentHTML(
      "beforeend",
      `<label class="field">Assistant wording<select id="pref-ai-wording"><option value="ai" ${!(draft?.aiToolbarSI ?? preferences.ai_toolbar_si) ? "selected" : ""}>AI (default)</option><option value="si" ${(draft?.aiToolbarSI ?? preferences.ai_toolbar_si) ? "selected" : ""}>SI · Super Intelligence</option></select></label><p class="description">Changes the assistant’s menu button, chat, settings and help labels.</p>`,
    );
    general?.insertAdjacentHTML(
      "beforeend",
      `<label class="check-row"><input id="pref-updates" type="checkbox" ${(draft?.updateChecks ?? hooks.updateChecks?.() ?? true) ? "checked" : ""}> Check GitHub releases automatically</label><p class="description">Checks once a day for new versions, including experimental previews. Update notices appear in Notifications. You can also use Help → Check for updates.</p>`,
    );
    bindPreferencesLayout(dialog, section);
    const previewInstant = Date.UTC(2026, 10, 1, 14, 5, 9) / 1000;
    const previewFormats = () => {
      $("#pref-date-preview").textContent =
        `Example: ${displayDate(previewInstant, input("#pref-date-format"))}`;
      $("#pref-time-preview").textContent =
        `Example: ${displayClock(previewInstant, false, input("#pref-time-format"))} UTC`;
    };
    dialog
      .querySelector("#pref-date-format")!
      .addEventListener("change", previewFormats);
    dialog
      .querySelector("#pref-time-format")!
      .addEventListener("change", previewFormats);
    previewFormats();
    const preferenceDraft = (): PreferencesDraft => ({
      theme: input("#pref-theme") as Preferences["theme"],
      coordinates: input("#pref-coordinates") as Preferences["coordinates"],
      dateFormat: input("#pref-date-format") as Preferences["date_format"],
      timeFormat: input("#pref-time-format") as Preferences["time_format"],
      autoSave: check("#pref-autosave"),
      aiToolbarSI: input("#pref-ai-wording") === "si",
      basemap: hooks.mountMaps
        ? check("#streets-enabled")
          ? "streets"
          : "none"
        : hooks.preferences().basemap,
      updateChecks: check("#pref-updates"),
      budget: Number(input("#pref-render-budget")),
    });
    let mapsDraft: PreferencesDraft | undefined;
    let mapsFocus = "";
    hooks.mountMaps?.(
      dialog.querySelector<HTMLElement>("#preferences-panel-maps")!,
      {
        beforeOpen: () => {
          mapsDraft = preferenceDraft();
          mapsFocus = (document.activeElement as HTMLElement)?.id || "";
        },
        back: async () => {
          await settings("maps", mapsDraft);
          if (mapsFocus) document.getElementById(mapsFocus)?.focus();
        },
      },
    );
    if (hooks.mountMaps && draft)
      ($("#streets-enabled") as HTMLInputElement).checked =
        draft.basemap === "streets";
    const reopenPreferences = async () => {
      const draft = preferenceDraft();
      closeModal();
      await settings("agents", draft);
    };
    if (native)
      on("#agent-toggle", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        if (agent.enabled) {
          await invoke("agent_access", { enabled: false, root: null });
        } else {
          await invoke("agent_access", { enabled: true, root: null });
        }
        await reopenPreferences();
      });
    if (native) {
      on("#agent-folder", async () => {
        const root = await chooseFile({ directory: true });
        if (!root) return;
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("agent_access", { enabled: true, root });
        await reopenPreferences();
      });
      on("#agent-default-folder", async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("agent_access", { enabled: true, root: null });
        await reopenPreferences();
      });
      on("#agent-config", () => {
        const draft = preferenceDraft();
        modal(
          `${head("Connect an AI client")}<p class="description">Use this configuration in a client that supports local stdio MCP, such as Codex. Enable agent access first and keep Chronoscope open. This configuration contains no credential.</p><label class="field">MCP configuration<textarea id="agent-client-config" readonly rows="10">${esc(JSON.stringify(agent.config, null, 2))}</textarea></label><p class="description">For Codex CLI, run the command below. It uses the app executable directly, including when the path contains spaces.</p><textarea id="agent-codex-command" readonly rows="3">${esc(agent.codex_command)}</textarea><div class="row"><button id="agent-copy-config">Copy MCP configuration</button><button id="agent-copy-codex">Copy Codex command</button></div><footer><button id="agent-setup-back">Back</button><button data-close>Close</button></footer>`,
          true,
        );
        const copySetup = async (id: string) => {
          const field = $(id) as HTMLTextAreaElement;
          field.focus();
          field.select();
          try {
            if (navigator.clipboard?.writeText)
              await navigator.clipboard.writeText(field.value);
            else if (!document.execCommand("copy"))
              throw new Error("Copy unavailable");
            toast("Copied to clipboard");
          } catch {
            toast("Text selected; press Cmd/Ctrl+C to copy");
          }
        };
        on("#agent-copy-config", () => copySetup("#agent-client-config"));
        on("#agent-copy-codex", () => copySetup("#agent-codex-command"));
        $("#agent-client-config").addEventListener("focus", (e) =>
          (e.target as HTMLTextAreaElement).select(),
        );
        on("#agent-setup-back", async () => {
          closeModal();
          await settings("agents", draft);
        });
      });
    }
    on("#save-preferences", async () => {
      const nextPreferences: Preferences = {
        ...hooks.preferences(),
        theme: input("#pref-theme") as Preferences["theme"],
        coordinates: input("#pref-coordinates") as Preferences["coordinates"],
        date_format: input("#pref-date-format") as Preferences["date_format"],
        time_format: input("#pref-time-format") as Preferences["time_format"],
        ai_toolbar_si: input("#pref-ai-wording") === "si",
        ...(hooks.mountMaps
          ? {
              basemap: check("#streets-enabled")
                ? ("streets" as const)
                : ("none" as const),
            }
          : {}),
        auto_save_unsaved: check("#pref-autosave"),
      };
      const nextBudget =
        Number(input("#pref-render-budget")) === 100000 ? 100000 : 20000;
      const nextUpdateChecks = check("#pref-updates");
      await hooks.save(nextPreferences, nextBudget);
      hooks.setUpdateChecks?.(nextUpdateChecks);
    });
  }
  return settings;
}
