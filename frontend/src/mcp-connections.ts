import { call, chooseFile } from "./bridge";
import { escape as esc } from "./types";
/** Mount tools inside SI settings; tool data never receives desktop IPC. */
export async function mcpConnections(
  root: HTMLElement,
  error: (error: unknown) => void,
) {
  root.innerHTML = `<p class="description">Connect other apps and remote services so SI can use tools you explicitly allow. Connections, credentials and tool grants last until disconnect or app exit. Chronoscope’s own MCP server is configured separately.</p><div id="client-list"></div><section id="client-tools-panel" hidden></section><details open><summary>Add connection</summary><label class="field">Name<input id="client-name" placeholder="Data service"></label><label class="field">Connection type<select id="client-kind"><option value="http">Remote MCP / Streamable HTTP</option><option value="stdio">Local app / stdio</option></select></label><div id="client-http"><label class="field">MCP endpoint URL<input id="client-url" placeholder="https://service.example/mcp"></label><label class="field">Bearer token (optional)<input id="client-token" type="password" autocomplete="off"></label><p class="description">HTTPS required except localhost. Anonymous and bearer-token endpoints are supported. Browser OAuth login and legacy HTTP+SSE endpoints are not supported yet.</p></div><div id="client-stdio" hidden><label class="field">Executable<input id="client-command" placeholder="Absolute path to a trusted executable"></label><button id="client-program">Choose executable…</button><label class="field">Arguments / JSON array<textarea id="client-arguments" rows="2">[]</textarea></label><label class="field">Environment variables / JSON object (optional)<textarea id="client-environment" rows="2">{}</textarea></label><p class="description">Connecting launches this program as your user, without a shell. Choose software you trust. Only a small system environment and the explicit values above are passed; service credentials are not inherited automatically.</p></div><div class="row"><button id="client-connect" class="primary">Connect and discover tools</button><span id="client-progress" role="status"></span></div></details>`;
  const current = () => root.isConnected;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const val = (selector: string) => find<HTMLInputElement>(selector).value;
  const on = (selector: string, action: () => void | Promise<void>) =>
    find(selector).addEventListener("click", () => {
      void Promise.resolve().then(action).catch(error);
    });
  const panel = find("#client-tools-panel");
  let listRequest = 0,
    toolRequest = 0,
    reviewing: string | null = null;
  async function refreshList() {
    const request = ++listRequest;
    const status = await call("client_status");
    if (!current() || request !== listRequest) return;
    find("#client-list").innerHTML =
      status.connections
        .map(
          (c: any) =>
            `<section class="map-stack-row"><div class="row"><strong class="grow">${esc(c.name)}</strong><small>${esc(c.transport)} · ${c.tool_count} tools · ${c.granted} granted · ${c.connected ? "connected" : "closed"}</small><button data-client-tools="${esc(c.id)}">Review tools</button><button data-client-disconnect="${esc(c.id)}" ${c.connected ? "" : "disabled"}>Disconnect</button></div></section>`,
        )
        .join("") || "<p>No outbound connections.</p>";
  }
  function hideTools() {
    toolRequest++;
    reviewing = null;
    panel.hidden = true;
    panel.replaceChildren();
  }
  async function toolsMenu(id: string) {
    const request = ++toolRequest;
    const result = await call("client_tools", { id });
    if (!current() || request !== toolRequest) return;
    reviewing = id;
    panel.innerHTML = `<h4>Tool permissions</h4><p class="description">Server descriptions and annotations are untrusted. Review each tool before granting access. “SI query” is your decision that a tool is suitable for reading; server hints do not grant permission. “SI action” also requires Allow external actions for each chat message. External effects cannot be undone by Chronoscope.</p><div id="client-tools">${result.tools.map((t: any, i: number) => `<section class="map-stack-row" data-client-tool="${i}"><div class="row"><strong class="grow">${esc(t.definition.name)}</strong><select data-client-access aria-label="Access for ${esc(t.definition.name)}"><option value="" ${t.access ? "" : "selected"}>Off</option><option value="read" ${t.access === "read" ? "selected" : ""}>SI query</option><option value="action" ${t.access === "action" ? "selected" : ""}>SI action</option></select></div><p>${esc(String(t.definition.description || "No description").slice(0, 4096))}</p><details><summary>Schema and server hints</summary><pre class="json-preview">${esc(JSON.stringify({ inputSchema: t.definition.inputSchema, annotations: t.definition.annotations }, null, 2))}</pre></details></section>`).join("")}</div><div class="row"><button id="client-back">Hide tool permissions</button><span id="client-grants-status" role="status"></span><span class="spacer"></span><button id="client-grants-save" class="primary">Save tool grants</button></div>`;
    panel.hidden = false;
    on("#client-back", hideTools);
    on("#client-grants-save", async () => {
      const button = find<HTMLButtonElement>("#client-grants-save");
      const grants = Array.from(
        panel.querySelectorAll<HTMLElement>("[data-client-tool]"),
      ).flatMap((row) => {
        const t = result.tools[Number(row.dataset.clientTool)] as any;
        const access = row.querySelector<HTMLSelectElement>("select")!.value;
        return access
          ? [
              {
                tool: t.definition.name,
                fingerprint: t.fingerprint,
                access: access as "read" | "action",
              },
            ]
          : [];
      });
      button.disabled = true;
      find("#client-grants-status").textContent = "Saving…";
      try {
        await call("client_grants", { id, grants });
        if (current()) {
          if (reviewing === id && request === toolRequest)
            find("#client-grants-status").textContent = "Saved";
          await refreshList();
        }
      } catch (e) {
        if (current() && reviewing === id && request === toolRequest)
          find("#client-grants-status").textContent = "Could not save";
        throw e;
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
  }
  find("#client-kind").addEventListener("change", () => {
    find("#client-http").hidden = val("#client-kind") !== "http";
    find("#client-stdio").hidden = val("#client-kind") !== "stdio";
  });
  on("#client-program", async () => {
    const path = await chooseFile();
    if (path && current())
      find<HTMLInputElement>("#client-command").value = path;
  });
  on("#client-connect", async () => {
    const button = find<HTMLButtonElement>("#client-connect");
    const config =
      val("#client-kind") === "http"
        ? {
            transport: "http" as const,
            url: val("#client-url"),
            token: val("#client-token") || null,
          }
        : {
            transport: "stdio" as const,
            command: val("#client-command"),
            arguments: JSON.parse(val("#client-arguments")),
            environment: JSON.parse(val("#client-environment")),
          };
    const name = val("#client-name").trim(),
      id = `connection-${crypto.randomUUID().slice(0, 8)}`;
    button.disabled = true;
    find<HTMLInputElement>("#client-token").value = "";
    find<HTMLTextAreaElement>("#client-environment").value = "{}";
    find("#client-progress").textContent = "Connecting (up to 60 seconds)…";
    try {
      await call("client_connect", { id, name, config });
      if (current()) {
        find("#client-progress").textContent = "Connected";
        await refreshList();
        await toolsMenu(id);
        if (current()) panel.scrollIntoView({ block: "nearest" });
      }
    } catch (e) {
      if (current()) find("#client-progress").textContent = "Connection failed";
      throw e;
    } finally {
      if (current()) button.disabled = false;
    }
  });
  find("#client-list").addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button || button.disabled) return;
    void (async () => {
      if (button.dataset.clientTools)
        await toolsMenu(button.dataset.clientTools);
      if (button.dataset.clientDisconnect) {
        const id = button.dataset.clientDisconnect;
        await call("client_disconnect", { id });
        if (current()) {
          if (reviewing === id) hideTools();
          await refreshList();
        }
      }
    })().catch(error);
  });
  await refreshList();
}
