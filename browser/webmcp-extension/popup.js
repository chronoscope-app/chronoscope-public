const $ = (s) => document.querySelector(s);
const show = (r) => {
  $("#status").textContent =
    r.error ||
    (r.connected ? "Connected to " + r.origin + ". " : "") + (r.status || "");
};
show(await chrome.runtime.sendMessage({ kind: "status" }));
$("#pair").onclick = async () => {
  $("#pair").disabled = true;
  try {
    show(
      await chrome.runtime.sendMessage({
        kind: "pair",
        url: $("#url").value.trim(),
        code: $("#code").value.trim(),
      }),
    );
  } catch (e) {
    show({ error: String(e) });
  } finally {
    $("#code").value = "";
    $("#pair").disabled = false;
  }
};
$("#disconnect").onclick = async () =>
  show(await chrome.runtime.sendMessage({ kind: "disconnect" }));
