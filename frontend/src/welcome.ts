import { escape as esc } from "./types";
import "./welcome.css";

type Recent = { path: string; name: string; count: number; updated: number };
interface Host {
  icon: (name: string) => string;
  open: () => Promise<unknown>;
  openPath: (path: string) => Promise<unknown>;
  demos: () => Promise<unknown>;
  help: () => void;
  error: (error: unknown) => void;
}
const key = "chronoscope-recent-workspaces-v1";

/** The start surface is only shown for an empty, unsaved workspace. */
export class Welcome {
  readonly element = document.createElement("section");
  private recents: Recent[] = [];
  private dismissed = false;
  private identity = "";
  constructor(
    private workspace: HTMLElement,
    private host: Host,
  ) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(stored))
        this.recents = stored
          .filter(
            (r): r is Recent =>
              !!r &&
              typeof r.path === "string" &&
              /\.chronoscope$/i.test(r.path) &&
              typeof r.name === "string" &&
              Number.isFinite(r.count) &&
              r.count >= 0 &&
              Number.isFinite(r.updated),
          )
          .slice(0, 8);
    } catch {
      /* A restricted or corrupt local store must not block Open. */
    }
    this.element.id = "welcome";
    this.element.className = "welcome";
    this.element.hidden = true;
    this.element.setAttribute("aria-labelledby", "welcome-title");
    workspace.after(this.element);
    this.render();
  }
  remember(path: string, count: number) {
    if (!/\.chronoscope$/i.test(path)) return;
    const name = path
      .split(/[\\/]/)
      .pop()!
      .replace(/\.chronoscope$/i, "");
    this.recents = [
      { path, name, count, updated: Date.now() },
      ...this.recents.filter((r) => r.path !== path),
    ].slice(0, 8);
    this.persist();
    this.render();
  }
  private persist() {
    try {
      localStorage.setItem(key, JSON.stringify(this.recents));
    } catch {}
  }
  update(identity: string, empty: boolean, source: string | null) {
    if (identity !== this.identity) {
      this.identity = identity;
      this.dismissed = false;
    }
    const show = empty && !source && !this.dismissed;
    const hadFocus = this.element.contains(document.activeElement);
    this.element.hidden = !show;
    this.workspace.inert = show;
    this.workspace.style.visibility = show ? "hidden" : "";
    if (hadFocus && !show)
      document.querySelector<HTMLElement>("#open")?.focus();
  }
  dismiss() {
    this.dismissed = true;
    this.element.hidden = true;
    this.workspace.inert = false;
    this.workspace.style.visibility = "";
  }
  private render() {
    const icon = this.host.icon;
    this.element.innerHTML = `<div class="welcome-content"><p class="caps">Untitled workspace</p>
      <h1 id="welcome-title">Explore events across<br>space and time.</h1>
      <p class="welcome-intro">Open your data, follow a recorded journey, or return to a saved investigation.</p>
      <div class="welcome-actions"><button id="welcome-open" class="primary">${icon("folder")} Open data <kbd>${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl"} O</kbd></button><button id="welcome-demo" class="secondary">${icon("play")} Try a demo</button></div>
      <section class="welcome-recents" aria-labelledby="recent-title"><div class="row"><h2 id="recent-title">Recent workspaces</h2><span class="spacer"></span>${this.recents.length ? '<button id="welcome-clear">Clear list</button>' : ""}</div>
      ${this.recents.map((r, i) => `<button class="welcome-file" data-recent="${i}" title="${esc(r.path)}">${icon("folder")}<span><strong>${esc(r.name)}</strong><small>${r.count.toLocaleString()} Events · ${esc(new Date(r.updated).toLocaleDateString())}</small></span><span class="spacer"></span><small>.chronoscope</small>${icon("collapse-right")}</button>`).join("") || '<p class="welcome-empty">Saved workspaces you open here will appear in this list.</p>'}</section>
      <p class="welcome-hint"><kbd>Tab</kbd> Move between controls <span>·</span><kbd>Enter</kbd> Open <span>·</span><button id="welcome-help"><kbd>F1</kbd> Help &amp; keyboard shortcuts</button></p>
      <button id="welcome-empty" class="welcome-skip">Continue with an empty workspace</button>
      </div><footer class="welcome-footer">${icon("folder")} Workspace processing stays on this device</footer>`;
    const run = (selector: string, action: () => unknown) =>
      this.element.querySelector(selector)?.addEventListener("click", () => {
        Promise.resolve().then(action).catch(this.host.error);
      });
    run("#welcome-open", this.host.open);
    run("#welcome-demo", this.host.demos);
    run("#welcome-help", this.host.help);
    run("#welcome-empty", () => {
      this.dismiss();
      document.querySelector<HTMLElement>("#open")?.focus();
    });
    run("#welcome-clear", () => {
      this.recents = [];
      this.persist();
      this.render();
      this.element.querySelector<HTMLElement>("#welcome-open")?.focus();
    });
    this.element
      .querySelectorAll<HTMLElement>("[data-recent]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const recent = this.recents[Number(button.dataset.recent)];
          if (recent)
            Promise.resolve()
              .then(() => this.host.openPath(recent.path))
              .catch(this.host.error);
        }),
      );
  }
}
