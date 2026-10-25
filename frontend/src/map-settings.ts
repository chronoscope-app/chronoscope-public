import { call } from "./bridge";
import { mapLayers, layerVisible } from "./map-stack";
import { escape as esc, type Preferences, type MapLayer } from "./types";
import type { EngineContracts } from "./contracts";
import type { SpaceTimeView } from "./view";
type MapPreset = Exclude<
  EngineContracts["wmts_servers"]["result"],
  { dry_run: true }
>["presets"][number];
interface Host {
  preferences: Preferences;
  mapPresets: MapPreset[];
  capabilities: any;
  capabilitiesURL: string;
  mapUnavailable: boolean;
  view: Pick<SpaceTimeView, "resources" | "setBasemap" | "showCredits">;
  modal: (html: string, small?: boolean) => HTMLElement;
  head: (title: string) => string;
  closeModal: () => void;
  toast: (message: string, error?: boolean) => void;
  on: (selector: string, fn: (event: Event) => unknown) => void;
  task: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  refresh: (render?: boolean) => Promise<void>;
  loadRasters: () => Promise<void>;
  cancelMap: () => Promise<void>;
  currentMapZoom: () => number;
}
/** Map configuration owns its dialogs; the renderer retains loading/camera state. */
export function createMapSettings(host: Host) {
  const {
    view,
    modal,
    head,
    closeModal,
    toast,
    on,
    task,
    refresh,
    loadRasters,
    cancelMap,
    currentMapZoom,
  } = host;
  const $ = (selector: string) =>
    document.querySelector<HTMLElement>(selector)!;
  const input = (selector: string) => ($(selector) as HTMLInputElement).value;
  const check = (selector: string) => ($(selector) as HTMLInputElement).checked;
  const supportedRasterFormat = (format: string) =>
    ["image/png", "image/jpeg", "image/jpg", "image/jpgpng"].includes(
      format.toLowerCase(),
    );
  async function mapLayerMenu() {
    const stack = structuredClone(mapLayers(host.preferences));
    const render = () => {
      const zoom = currentMapZoom();
      modal(
        `${head("Map layers")}<p class="description">Bottom to top drawing order. Enable layers from any saved server. Zoom uses the standard 256-pixel Web Mercator scale; minimum is inclusive and maximum exclusive. Street imagery can cover 0–14, with aerial imagery at 14–30.</p><div class="notice">Current zoom: ${zoom.toFixed(2)} · approximately 1:${Math.round(591657527.6 / 2 ** zoom).toLocaleString()} at the equator, 96 dpi. Zoom controls visibility; the server matrix setting controls requested resolution.</div><div id="map-stack-list">${stack.map((l, i) => `<section class="map-stack-row" data-map-stack="${esc(l.id)}"><div class="row"><label class="check-row grow"><input data-map-enabled type="checkbox" ${l.config.enabled ? "checked" : ""}> ${esc(l.server_name)} · ${esc(l.config.layer)}</label><button data-map-up="${i}" title="Move layer up in drawing order" ${i === stack.length - 1 ? "disabled" : ""}>↑</button><button data-map-down="${i}" title="Move layer down in drawing order" ${i === 0 ? "disabled" : ""}>↓</button><button data-map-edit="${i}">Edit source</button><button data-map-remove="${i}" aria-label="Remove ${esc(l.name)}">×</button></div><label class="field">Layer name<input data-map-name value="${esc(l.name)}"></label><div class="modal-grid"><label class="field">Opacity / %<input data-map-opacity type="number" min="0" max="100" step="1" value="${l.opacity * 100}"></label><label class="field">Show from zoom<input data-map-min type="number" min="0" max="30" step="0.1" value="${l.min_zoom}"></label><label class="field">Hide at zoom<input data-map-max type="number" min="0" max="30" step="0.1" value="${l.max_zoom}"></label></div><small>${layerVisible(l, zoom) ? "Visible at current zoom" : "Hidden at current zoom"} · ${esc(l.config.time || "Default date")}</small></section>`).join("") || "<p>No map layers. Add layers using Map servers.</p>"}</div><footer><button id="stack-add">Map servers / add layer</button><span class="spacer"></span><button data-close>Cancel</button><button id="save-map-stack" class="primary">Apply layers</button></footer>`,
        true,
      );
      const capture = () => {
        $("#map-stack-list")
          .querySelectorAll<HTMLElement>("[data-map-stack]")
          .forEach((row, i) => {
            const value = (key: string) =>
              (row.querySelector(`[data-map-${key}]`) as HTMLInputElement)
                .value;
            stack[i].config.enabled = (
              row.querySelector("[data-map-enabled]") as HTMLInputElement
            ).checked;
            stack[i].name = value("name");
            stack[i].opacity = Number(value("opacity")) / 100;
            stack[i].min_zoom = Number(value("min"));
            stack[i].max_zoom = Number(value("max"));
          });
      };
      const save = async () => {
        capture();
        await cancelMap();
        host.preferences = await call("preferences", {
          preferences: { map_layers: stack },
        });
        host.mapUnavailable = false;
        await refresh(false);
        await loadRasters();
      };
      $("#map-stack-list").addEventListener("click", (e) => {
        const b = (e.target as Element).closest<HTMLElement>("button");
        if (!b) return;
        capture();
        const perform = async () => {
          if (b.dataset.mapEdit !== undefined) {
            await save();
            const l = stack[Number(b.dataset.mapEdit)];
            await mapMenu(undefined, l);
            return;
          }
          const up = b.dataset.mapUp,
            down = b.dataset.mapDown,
            remove = b.dataset.mapRemove;
          if (up !== undefined) {
            const i = Number(up);
            [stack[i], stack[i + 1]] = [stack[i + 1], stack[i]];
          }
          if (down !== undefined) {
            const i = Number(down);
            [stack[i], stack[i - 1]] = [stack[i - 1], stack[i]];
          }
          if (remove !== undefined) stack.splice(Number(remove), 1);
          render();
        };
        void perform().catch((e) => toast(String(e), true));
      });
      on("#save-map-stack", async () => {
        await save();
        closeModal();
      });
      on("#stack-add", async () => {
        await save();
        await wmtsMenu();
      });
    };
    render();
  }

  async function mapMenu(
    draft?: Parameters<typeof wmtsMenu>[0],
    editing?: MapLayer,
  ) {
    if (draft || editing) return wmtsMenu(draft, editing);
    const custom = mapLayers(host.preferences).filter(
      (l) => l.config.enabled,
    ).length;
    modal(
      `${head("Map")}<label class="check-row"><input id="streets-enabled" type="checkbox" ${host.preferences.basemap === "streets" ? "checked" : ""}> Streets</label><p class="description">Detailed worldwide streets · OpenFreeMap Positron. Detail follows your zoom automatically. No account or API key needed.</p>${custom ? `<p class="notice">${custom} custom map layer(s) are enabled and may cover Streets.</p><button id="streets-only">Use Streets only</button>` : ""}${view.resources.status.basemapError ? `<p class="error">${esc(view.resources.status.basemapError)}</p><button id="retry-streets">Retry Streets</button>` : ""}<details class="map-advanced"><summary>Advanced map settings</summary><div class="row" style="margin-top:12px"><button id="custom-map-server">Add custom map server…</button><button id="custom-map-layers">Custom layers…</button><button id="basemap-cache">Cache and loading…</button><button id="basemap-credits">Map credits</button></div><p class="description">Custom WMTS layers, authentication, opacity and zoom rules remain available here.</p></details><footer><button data-close>Cancel</button><span class="spacer"></span><button id="apply-basemap" class="primary">Apply</button></footer>`,
    );
    on("#custom-map-server", () => wmtsMenu());
    on("#custom-map-layers", mapLayerMenu);
    on("#basemap-cache", mapCacheMenu);
    on("#basemap-credits", () => view.showCredits());
    if (view.resources.status.basemapError)
      on("#retry-streets", async () => {
        await view.setBasemap("none");
        await view.setBasemap("streets");
        closeModal();
      });
    on("#apply-basemap", async () => {
      host.preferences = await call("preferences", {
        preferences: {
          basemap: check("#streets-enabled") ? "streets" : "none",
        },
      });
      closeModal();
      await refresh(false);
    });
    if (custom)
      on("#streets-only", async () => {
        const stack = mapLayers(host.preferences).map((layer) => ({
          ...layer,
          config: { ...layer.config, enabled: false },
        }));
        host.preferences = await call("preferences", {
          preferences: {
            basemap: "streets",
            map: { ...host.preferences.map, enabled: false },
            map_layers: stack,
          },
        });
        closeModal();
        await refresh(false);
        await loadRasters();
      });
  }

  async function wmtsMenu(
    draft?: {
      servers: any[];
      selected: string;
      config: Preferences["map"];
    },
    editing?: MapLayer,
  ) {
    const catalog = await call("wmts_servers");
    host.mapPresets = catalog.presets;
    const library = draft || catalog;
    type Server = {
      id: string;
      name: string;
      config: Preferences["map"];
    };
    const servers: Server[] = library.servers.map((s: Server) => ({
      ...s,
      config: { ...s.config },
    }));
    const initialConfig =
      draft?.config || editing?.config || host.preferences.map;
    let selected =
      draft?.selected ||
      servers.find(
        (s) =>
          s.config.url === initialConfig.url &&
          s.config.layer === initialConfig.layer &&
          s.config.matrix_set === initialConfig.matrix_set,
      )?.id ||
      servers.find((s) => s.config.url === initialConfig.url)?.id ||
      "";
    if (!selected) {
      selected = `workspace-${crypto.randomUUID()}`;
      servers.push({
        id: selected,
        name: initialConfig.url ? "Current workspace map" : "New map server",
        config: { ...initialConfig },
      });
    }
    let c = { ...(draft?.config || editing?.config || host.preferences.map) };
    if (!c.url) c.enabled = true;
    let caps: any = host.capabilitiesURL === c.url ? host.capabilities : null;
    let requestGeneration = 0;
    modal(
      `${head("Map servers")}<p class="description">Save multiple WMTS connections and add imagery layers from any server. The server library stays on this computer; the layer stack and visibility rules are saved with your workspace.</p><div class="row"><label class="field grow">Map source<select id="wmts-server"></select></label><button id="add-wmts-server">Add server</button><button id="remove-wmts-server">Remove</button></div><div id="wmts-source-info" class="notice" hidden></div><label class="field">Server name<input id="wmts-server-name"></label><label class="field">Capabilities or service URL<input id="wmts-url" placeholder="https://…/WMTSCapabilities.xml"></label><div class="row"><button id="inspect-wmts" class="primary">Read capabilities</button><button id="wmts-auth">Authentication…</button><button id="wmts-cache">Cache and loading…</button><span class="spacer"></span><label class="check-row"><input id="map-enabled" type="checkbox"> Show map</label></div><div id="wmts-layer-status" role="status" class="description"></div><div id="wmts-fields" style="margin-top:12px"></div><div class="notice">EPSG:3857 and EPSG:4326/CRS84. Imagery loads directly with a local disk cache. Each server remembers its layer, matrix, style, date and resolution. Multiple sources can be enabled together. Use Map layers to set opacity, order and zoom visibility.</div><footer><button data-close>Close</button><button id="save-wmts-server">Save server</button><button id="map-stack-settings">Map layers…</button><button id="map-credits">Map credits</button><button id="add-map-layer">Add selected layer to map</button><span class="spacer"></span><button id="apply-map" class="primary">Apply to view</button></footer>`,
      false,
    );
    const menuOwner = $("#wmts-server");
    const alive = () => document.querySelector("#wmts-server") === menuOwner;
    const server = () => servers.find((s) => s.id === selected)!;
    const capture = () => {
      c.url = input("#wmts-url").trim();
      c.enabled = check("#map-enabled");
      if ($("#wmts-layer")) c.layer = input("#wmts-layer");
      if ($("#wmts-matrix")) c.matrix_set = input("#wmts-matrix");
      if ($("#wmts-style")) c.style = input("#wmts-style");
      if ($("#wmts-format")) c.format = input("#wmts-format");
      if ($("#wmts-time")) c.time = input("#wmts-time");
      if ($("#wmts-level"))
        c.level =
          input("#wmts-level") === "" ? null : Number(input("#wmts-level"));
      server().name = input("#wmts-server-name").trim();
      server().config = { ...c };
    };
    const options = () => {
      if (!alive()) return;
      $("#wmts-server").innerHTML =
        '<optgroup label="Saved servers">' +
        servers
          .map(
            (s) =>
              `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`,
          )
          .join("") +
        "</optgroup>";
      ($("#remove-wmts-server") as HTMLButtonElement).disabled =
        servers.length === 0;
    };
    const fields = () => {
      if (!alive()) return;
      const preset = host.mapPresets.find(
        (p) => p.config.url === c.url && p.config.layer === c.layer,
      );
      const info = $("#wmts-source-info");
      info.hidden = !preset;
      info.innerHTML = preset
        ? `<strong>${esc(preset.name)}</strong><p>${esc(preset.description)} ${esc(preset.coverage)}</p><p>${esc(preset.license)}</p>${preset.credits.map((credit) => `<a href="${esc(credit.url)}" target="_blank" rel="noopener noreferrer">${esc(credit.text)}</a>`).join(" · ")}`
        : "";
      const layers =
        caps?.layers.filter((l: any) =>
          l.formats.some(supportedRasterFormat),
        ) || [];
      const layer = layers.find((l: any) => l.id === c.layer) || layers[0];
      if (!layer) {
        $("#wmts-fields").innerHTML =
          `<label class="field">Layer<input id="wmts-current-layer" readonly value="${esc(c.layer || "No layer selected")}"></label>`;
        $("#wmts-layer-status").textContent = caps
          ? "This service has no supported PNG/JPEG layers."
          : "Read capabilities to browse all imagery layers. Your current layer is shown below.";
        return;
      }
      c.layer = layer.id;
      if (!layer.matrix_sets.includes(c.matrix_set)) {
        c.matrix_set = layer.matrix_sets[0] || "";
        c.level = null;
      }
      if (!layer.formats.includes(c.format))
        c.format = layer.formats.find(supportedRasterFormat) || "";
      if (!c.style) c.style = layer.style;
      const time = layer.dimensions.find(
        (d: any) => d.name.toLowerCase() === "time",
      );
      $("#wmts-layer-status").textContent =
        `${layers.length.toLocaleString()} imagery layers available`;
      $("#wmts-fields").innerHTML =
        `<div class="modal-grid"><label class="field wide">Layer<select id="wmts-layer">${layers.map((l: any) => `<option value="${esc(l.id)}" ${l.id === c.layer ? "selected" : ""}>${esc(l.title || l.id)} · ${esc(l.id)}</option>`).join("")}</select></label><label class="field">Matrix set<select id="wmts-matrix">${layer.matrix_sets.map((id: string) => `<option ${id === c.matrix_set ? "selected" : ""}>${esc(id)}</option>`).join("")}</select></label><label class="field">Resolution<select id="wmts-level"><option value="">Automatic / screen resolution</option>${(caps.matrix_sets.find((m: any) => m.id === c.matrix_set)?.matrices || []).map((m: any, i: number) => `<option value="${i}" ${c.level === i ? "selected" : ""}>${esc(m.id)} · scale 1:${Math.round(m.scale).toLocaleString()}</option>`).join("")}</select></label><label class="field">Time dimension<input id="wmts-time" value="${esc(c.time)}" placeholder="${esc(time?.default || "Provider default")}"><small class="muted">${esc(time?.values?.slice(0, 3).join(", ") || "This layer has no advertised time dimension")}</small></label><label class="field">Style<input id="wmts-style" value="${esc(c.style)}"></label><label class="field">Format<select id="wmts-format">${layer.formats
          .filter(supportedRasterFormat)
          .map(
            (f: string) =>
              `<option ${f === c.format ? "selected" : ""}>${esc(f)}</option>`,
          )
          .join("")}</select></label></div>`;
      $("#wmts-layer").addEventListener("change", () => {
        capture();
        c.matrix_set = "";
        c.level = null;
        c.style = "";
        c.time = "";
        fields();
      });
      $("#wmts-matrix").addEventListener("change", () => {
        capture();
        c.level = null;
        fields();
      });
    };
    const read = async () => {
      capture();
      const url = c.url,
        generation = ++requestGeneration;
      $("#wmts-layer-status").textContent = "Loading imagery layers…";
      try {
        const result = await call("wmts_capabilities", { url });
        if (
          !alive() ||
          generation !== requestGeneration ||
          input("#wmts-url").trim() !== url
        )
          return;
        caps = result;
        host.capabilities = result;
        host.capabilitiesURL = url;
        fields();
      } catch (error) {
        if (alive() && generation === requestGeneration)
          $("#wmts-layer-status").textContent =
            `Layers unavailable: ${error}. Check the URL or authentication, then read capabilities again.`;
      }
    };
    const show = () => {
      if (!alive()) return;
      requestGeneration++;
      $("#wmts-server-name").setAttribute("value", server().name);
      ($("#wmts-server-name") as HTMLInputElement).value = server().name;
      ($("#wmts-url") as HTMLInputElement).value = c.url;
      ($("#map-enabled") as HTMLInputElement).checked = c.enabled;
      caps = host.capabilitiesURL === c.url ? host.capabilities : null;
      options();
      fields();
      if (!caps && c.enabled && c.url) void read();
    };
    const persist = async () => {
      capture();
      await call("wmts_servers", { settings: { servers } });
      options();
      toast("Map server saved on this computer");
    };
    $("#wmts-server").addEventListener("change", () => {
      capture();
      const choice = input("#wmts-server");
      if (choice.startsWith("builtin:")) {
        const preset = host.mapPresets.find((p) => p.id === choice.slice(8))!;
        const existing = servers.find(
          (s) => JSON.stringify(s.config) === JSON.stringify(preset.config),
        );
        if (!existing && servers.length >= 32) {
          toast(
            "At most 32 saved map servers. Remove an entry before adding another.",
            true,
          );
          options();
          return;
        }
        selected =
          existing?.id ||
          (servers.some((s) => s.id === preset.id)
            ? `server-${crypto.randomUUID()}`
            : preset.id);
        if (!existing) {
          servers.push({
            id: selected,
            name: preset.name,
            config: { ...preset.config },
          });
        }
      } else selected = choice;
      c = { ...server().config };
      show();
    });
    $("#wmts-url").addEventListener("input", () => {
      requestGeneration++;
      caps = null;
      fields();
    });
    on("#inspect-wmts", read);
    on("#add-wmts-server", () => {
      capture();
      if (servers.length >= 32) throw new Error("At most 32 saved map servers");
      selected = `server-${crypto.randomUUID()}`;
      c = {
        url: "",
        layer: "",
        matrix_set: "",
        style: "",
        format: "image/png",
        time: "",
        enabled: false,
        level: null,
      };
      servers.push({ id: selected, name: "New WMTS server", config: { ...c } });
      show();
      $("#wmts-url").focus();
    });
    on("#remove-wmts-server", async () => {
      requestGeneration++;
      const i = servers.findIndex((s) => s.id === selected);
      servers.splice(i, 1);
      await call("wmts_servers", { settings: { servers } });
      if (!servers.length) {
        closeModal();
        await mapMenu();
        return;
      }
      selected = servers[0].id;
      c = { ...server().config };
      show();
    });
    on("#save-wmts-server", persist);
    on("#wmts-auth", () => {
      capture();
      return authenticationMenu(c.url, () =>
        mapMenu({ servers, selected, config: c }, editing),
      );
    });
    on("#wmts-cache", mapCacheMenu);
    on("#map-stack-settings", mapLayerMenu);
    on("#map-credits", () => {
      closeModal();
      view.showCredits();
    });
    on("#add-map-layer", async () => {
      capture();
      if (!c.layer || !c.matrix_set)
        throw new Error(
          "Read capabilities and choose a layer and matrix set first",
        );
      await persist();
      const stack = structuredClone(mapLayers(host.preferences));
      stack.push({
        id: `layer-${crypto.randomUUID()}`,
        name: `${server().name} · ${c.layer}`,
        server_name: server().name,
        config: { ...c, enabled: true },
        opacity: 1,
        min_zoom: 0,
        max_zoom: 30,
      });
      await cancelMap();
      host.preferences = await call("preferences", {
        preferences: { map_layers: stack },
      });
      host.mapUnavailable = false;
      await refresh(false);
      await loadRasters();
      await mapLayerMenu();
    });
    on("#apply-map", async () => {
      capture();
      if (c.enabled && (!c.layer || !c.matrix_set))
        throw new Error(
          "Read capabilities and choose a layer and matrix set first",
        );
      await persist();
      await cancelMap();
      let stack = host.preferences.map_layers
        ? structuredClone(host.preferences.map_layers)
        : null;
      if (editing || stack) {
        stack ??= structuredClone(mapLayers(host.preferences));
        const targetId = editing?.id || stack[0]?.id || "legacy-map";
        const index = stack.findIndex((l) => l.id === targetId);
        const layer = {
          ...(index >= 0
            ? stack[index]
            : {
                id: "legacy-map",
                name: c.layer,
                opacity: 1,
                min_zoom: 0,
                max_zoom: 30,
              }),
          server_name: server().name,
          config: { ...c },
        };
        if (index >= 0) stack[index] = layer;
        else stack.unshift(layer);
      }
      host.preferences = {
        ...host.preferences,
        map: { ...c },
        map_layers: stack,
      };
      await call("preferences", { preferences: host.preferences });
      closeModal();
      await refresh(false);
      host.mapUnavailable = false;
      await loadRasters();
    });
    show();
  }

  async function authenticationMenu(
    url: string,
    returnToMenu?: () => Promise<void>,
  ) {
    const auth = await task("Checking native authentication…", () =>
      call<any>("wmts_auth_status"),
    );
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new Error("Enter a valid HTTPS map server URL first.");
    }
    const profile = auth.profiles.find((p: any) => p.origin === origin);
    const kind = auth.platform_kind;
    const labels: Record<string, string> = {
      "macos-keychain": "Keychain certificate subject name",
      "windows-store": "CurrentUser\\MY\\ + 40-digit certificate thumbprint",
      pkcs11: "PKCS#11 certificate URI (type=cert)",
    };
    modal(
      `${head("Map authentication")}<p class="description">${esc(auth.notice)}</p><div class="notice">${auth.automatic ? "Default: automatic TLS client-certificate detection. The OS/card provider handles PIN prompts. Public servers do not prompt." : "Automatic smartcard detection is unavailable on this platform. Public maps work normally; protected maps need compatible PKCS#11 middleware and an explicit certificate URI."}</div><label class="field">HTTPS server origin<input id="auth-origin" value="${esc(origin)}" placeholder="https://maps.example.org"></label><label class="field">Authentication<select id="auth-mode"><option value="automatic" ${!profile ? "selected" : ""}>${auth.automatic ? "Automatic (default)" : "No override (default)"}</option><option value="identity" ${profile && profile.kind !== "disabled" ? "selected" : ""}>Specific client identity</option><option value="disabled" ${profile?.kind === "disabled" ? "selected" : ""}>No client certificate</option></select></label><label class="field" id="auth-identity-field">${esc(labels[kind])}<input id="auth-identity" value="${esc(profile?.identity || "")}" autocomplete="off" spellcheck="false" placeholder="${kind === "pkcs11" ? "pkcs11:token=My%20Card;id=%01;type=cert" : ""}"></label><p class="description">Overrides stay on this computer and apply only to the exact HTTPS host and port. PINs and private keys are never stored in Chronoscope or shared workspaces. Servers on other origins require their own authentication. Cached imagery can remain visible without the card.</p>${!auth.transport_available ? `<div class="notice error">${esc(auth.unavailable_reason)}</div>` : ""}<footer><button id="auth-back">Back</button><button id="auth-reset">Forget session choices</button><span class="spacer"></span><button id="auth-save" class="primary">Save</button></footer>`,
    );
    const update = () => {
      $("#auth-identity-field").hidden = input("#auth-mode") !== "identity";
    };
    $("#auth-mode").addEventListener("change", update);
    update();
    const back = async () => {
      await (returnToMenu ? returnToMenu() : mapMenu());
    };
    on("#auth-back", back);
    on("#auth-reset", async () => {
      await cancelMap();
      await call("wmts_auth_reset");
      toast(
        "Authentication sessions closed; cached imagery remains on this device.",
      );
    });
    on("#auth-save", async () => {
      const origin = input("#auth-origin");
      await cancelMap();
      if (input("#auth-mode") === "automatic")
        await call("wmts_auth_remove", { origin });
      else
        await call("wmts_auth_set", {
          profile: {
            origin,
            kind: input("#auth-mode") === "disabled" ? "disabled" : kind,
            identity:
              input("#auth-mode") === "disabled" ? "" : input("#auth-identity"),
          },
        });
      host.capabilities = null;
      host.mapUnavailable = false;
      toast("Local map authentication updated");
      await back();
    });
  }

  async function mapCacheMenu() {
    const info = await call("wmts_access"),
      s = info.settings;
    modal(
      `${head("Map cache and loading")}<p class="description">Tiles and capabilities are cached directly in a private folder on this computer. No proxy, service or listening port is involved. Cache files are independent of saved workspaces. Previously viewed imagery can be reused without contacting the provider; offline mode requires all requested tiles and capabilities to be cached.</p><div class="notice mono">${esc(info.directory)}<br>${(info.bytes / 1048576).toFixed(1)} MiB cached</div><div class="modal-grid"><label class="field">Concurrent downloads<input id="cache-concurrency" type="number" min="1" max="32" value="${s.concurrency}"></label><label class="field">Minimum request interval / ms (0 = no imposed delay)<input id="cache-interval" type="number" min="0" max="60000" value="${s.request_interval_ms}"></label><label class="field">Disk cache limit / MiB (0 = unlimited)<input id="cache-limit" type="number" min="0" value="${s.cache_limit_mb}"></label><label class="field">Tile freshness / days<input id="cache-days" type="number" min="1" max="3650" value="${s.tile_ttl_days}"></label></div><label class="check-row"><input id="cache-offline" type="checkbox" ${s.offline ? "checked" : ""}> Use cached maps only / no network access</label><p class="description">Provider terms and HTTP rate limits still apply. The optional request interval is useful for restrained testing; normal loading defaults to no delay. Cache is oldest-file evicted when over its size limit. Offline mode also permits older cached imagery.</p><button id="cache-clear">Clear cached imagery and capabilities</button><footer><button data-close>Cancel</button><span class="spacer"></span><button id="cache-save" class="primary">Save settings</button></footer>`,
      true,
    );
    on("#cache-save", async () => {
      await call("wmts_access", {
        settings: {
          concurrency: Number(input("#cache-concurrency")),
          request_interval_ms: Number(input("#cache-interval")),
          cache_limit_mb: Number(input("#cache-limit")),
          tile_ttl_days: Number(input("#cache-days")),
          offline: check("#cache-offline"),
        },
      });
      host.mapUnavailable = false;
      closeModal();
      toast("Local map loading/cache settings saved");
    });
    on("#cache-clear", async () => {
      await cancelMap();
      await call("wmts_cache_clear");
      host.capabilities = null;
      toast(
        "Map disk cache cleared; displayed imagery stays until the next load",
      );
      closeModal();
    });
  }
  return { mapMenu, mapLayerMenu };
}
