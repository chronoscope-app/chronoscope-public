import { pageAdapter } from "./page-adapter.js";
let session,
  looping = false;
let pollController;
const active = new Set();
const initialize = chrome.storage.session.get("bridge").then((x) => {
  session = x.bridge;
});
async function invokePage(s, operation, request = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: s.tab, documentIds: [s.document] },
    world: "MAIN",
    func: pageAdapter,
    args: [operation, request],
  });
  const item = results[0];
  if (!item || item.documentId !== s.document || item.error)
    throw Error("Browser document changed or tool failed");
  return item.result;
}
async function send(s, path, body) {
  const cancellation =
    path === "/poll" ? (pollController = new AbortController()) : undefined;
  const response = await fetch(s.url + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(s.token ? { Authorization: "Bearer " + s.token } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: cancellation
      ? AbortSignal.any([AbortSignal.timeout(25000), cancellation.signal])
      : AbortSignal.timeout(25000),
    redirect: "error",
  });
  if (!response.ok)
    throw Error(
      "Chronoscope browser bridge rejected the request (" +
        response.status +
        ")",
    );
  return response.status === 204 ? {} : response.json();
}
async function disconnect(reason = "Disconnected") {
  pollController?.abort();
  const previous = session;
  session = undefined;
  await chrome.storage.session.remove("bridge");
  await chrome.storage.session.set({ status: reason });
  if (previous) {
    for (const id of active)
      void invokePage(previous, "cancel", { id }).catch(() => {});
    void send(previous, "/invalidate").catch(() => {});
  }
  await chrome.action.setBadgeText({ text: "" });
}
async function execute(s, job) {
  active.add(job.id);
  try {
    if (job.document !== s.document) throw Error("Stale browser document");
    const result = await invokePage(s, "execute", {
      ...job,
      catalogue: s.catalogue,
    });
    await send(s, "/result", { id: job.id, document: s.document, ...result });
  } catch (e) {
    if (session === s)
      await send(s, "/result", {
        id: job.id,
        document: s.document,
        error: String(e).slice(0, 4096),
      }).catch(() => {});
  } finally {
    active.delete(job.id);
  }
}
async function loop() {
  await initialize;
  if (looping || !session) return;
  looping = true;
  let observed;
  try {
    while (session) {
      const s = session;
      observed = s;
      const discovered = await invokePage(s, "discover");
      if (
        discovered.catalogue !== s.catalogue ||
        discovered.origin !== s.origin
      )
        throw Error(
          "Page tools changed. Reconnect in Chronoscope and review the new tools.",
        );
      const job = await send(s, "/poll");
      if (session !== s) continue;
      if (job.kind === "call") {
        if (active.size >= 4) throw Error("Browser call budget exceeded");
        void execute(s, job);
      } else if (job.kind === "cancel") {
        void invokePage(s, "cancel", { id: job.id }).catch(() => {});
      }
    }
  } catch (e) {
    if (session === observed) await disconnect(String(e));
  } finally {
    looping = false;
    if (session) void loop();
  }
}
chrome.tabs.onUpdated.addListener((id, change) => {
  if (session?.tab === id && (change.status === "loading" || change.url))
    void disconnect(
      "The selected page navigated. Start a new connection and review tools.",
    );
});
chrome.tabs.onRemoved.addListener((id) => {
  if (session?.tab === id) void disconnect("Selected tab closed");
});
chrome.alarms.create("keep-bridge", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => void loop());
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our extension UI, never page scripts or arbitrary tab messages.
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  (async () => {
    await initialize;
    if (message.kind === "status")
      return {
        connected: !!session,
        origin: session?.origin,
        ...(await chrome.storage.session.get("status")),
      };
    if (message.kind === "disconnect") {
      await disconnect();
      return { connected: false };
    }
    if (message.kind !== "pair") throw Error("Unknown browser action");
    const url = new URL(message.url);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw Error("Use the exact loopback address displayed by Chronoscope");
    if (!/^[a-f0-9]{64}$/.test(message.code))
      throw Error("Paste the pairing code from Chronoscope");
    await disconnect();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw Error("Select the WebMCP page first");
    const [discovery] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pageAdapter,
      args: ["discover"],
    });
    if (!discovery?.documentId || !discovery.result?.tools?.length)
      throw Error("Selected page has no supported WebMCP tools");
    const s = {
      url: url.origin,
      tab: tab.id,
      document: discovery.documentId,
      ...discovery.result,
    };
    const paired = await send(s, "/pair", {
      pairing_code: message.code,
      origin: s.origin,
      document: s.document,
      tools: s.tools,
    });
    session = { ...s, token: paired.token };
    await chrome.storage.session.set({
      bridge: session,
      status: "Connected. Return to Chronoscope to discover and review tools.",
    });
    await chrome.action.setBadgeText({ text: "ON" });
    void loop();
    return { connected: true, origin: s.origin };
  })().then(respond, (e) => respond({ error: String(e) }));
  return true;
});
void loop();
