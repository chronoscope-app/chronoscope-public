// Serialized into the selected page's MAIN world. No app credentials or IPC.
// This is the only module that depends on the evolving WebMCP browser API.
export async function pageAdapter(operation, request = {}) {
  const context = document.modelContext;
  if (!context?.getTools || !context?.executeTool)
    throw Error(
      "This browser/page does not expose draft document.modelContext getTools/executeTool. Enable the browser's WebMCP support, or use a compatible browser.",
    );
  const key = Symbol.for("chronoscope.webmcp.document.v1");
  if (!window[key]) {
    const state = { epoch: 0, controllers: new Map() };
    context.addEventListener("toolchange", () => {
      state.epoch++;
      for (const c of state.controllers.values()) c.abort();
    });
    window[key] = state;
  }
  const state = window[key];
  if (operation === "cancel") {
    state.controllers.get(request.id)?.abort();
    return { cancelled: true };
  }
  const registered = (
    await context.getTools({ fromOrigins: [location.origin] })
  ).filter((t) => t.window === window && t.origin === location.origin);
  const tools = registered
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: "object" },
      ...(t.title ? { title: t.title } : {}),
      // Hints are informational; the Chronoscope user supplies the actual grant.
      ...(t.annotations
        ? {
            annotations: {
              readOnlyHint: !!t.annotations.readOnlyHint,
              destructiveHint: !!t.annotations.consequentialHint,
              openWorldHint: true,
            },
          }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const catalogue = JSON.stringify({ tools, epoch: state.epoch });
  if (catalogue.length > 1024 * 1024 || tools.length > 256)
    throw Error("WebMCP tool catalogue exceeds the bridge budget");
  if (operation === "discover")
    return { origin: location.origin, tools, catalogue };
  if (operation !== "execute" || catalogue !== request.catalogue)
    throw Error("WebMCP tools changed: reconnect and review tools");
  const tool = registered.find((t) => t.name === request.name);
  if (!tool) throw Error("WebMCP tool is no longer available");
  const controller = new AbortController();
  state.controllers.set(request.id, controller);
  const timer = setTimeout(() => controller.abort(), 49000);
  try {
    // The current draft returns a JSON string. Preserve it as MCP text.
    const result = await context.executeTool(tool, request.arguments, {
      signal: controller.signal,
    });
    if (typeof result !== "string")
      throw Error("Draft WebMCP executeTool must return a JSON string");
    if (result.length > 1024 * 1024)
      throw Error("WebMCP result exceeds the bridge budget");
    return { result };
  } finally {
    clearTimeout(timer);
    state.controllers.delete(request.id);
  }
}
