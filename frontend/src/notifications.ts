export interface AppNotification {
  id: string;
  source: string;
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  actions?: { label: string; run: () => Promise<void> | void }[];
}
type Entry = AppNotification & {
  read: boolean;
  dismissed: boolean;
  error?: string;
};

/** Session notifications. New sources can publish alerts without opening UI. */
export class NotificationCenter {
  private entries = new Map<string, Entry>();
  private panel: HTMLElement;
  private list: HTMLElement;
  private badge: HTMLElement;
  private closeButton: HTMLButtonElement;
  constructor(
    private trigger: HTMLButtonElement,
    closeIcon: string,
  ) {
    this.badge = trigger.querySelector(".notification-badge")!;
    this.panel = document.createElement("section");
    this.panel.id = "notifications-panel";
    this.panel.className = "notifications-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Notifications");
    this.panel.innerHTML = `<header><h2>Notifications</h2><button type="button" class="icon" aria-label="Close notifications">${closeIcon}</button></header><div class="notifications-list"></div>`;
    document.body.append(this.panel);
    this.list = this.panel.querySelector(".notifications-list")!;
    this.closeButton = this.panel.querySelector("button")!;
    trigger.onclick = () => (this.isOpen ? this.close() : this.open());
    this.closeButton.onclick = () => this.close();
    document.addEventListener("pointerdown", (e) => {
      if (
        this.isOpen &&
        e.target instanceof Node &&
        !trigger.contains(e.target) &&
        !this.panel.contains(e.target)
      )
        this.close(false);
    });
    this.paint();
  }
  get isOpen() {
    return !this.panel.hidden;
  }
  replace(source: string, notices: AppNotification[]) {
    const next = new Set(notices.map((n) => n.id));
    for (const [id, n] of this.entries)
      if (n.source === source && !next.has(id)) this.entries.delete(id);
    for (const n of notices) {
      const prior = this.entries.get(n.id);
      const unchanged =
        prior?.title === n.title &&
        prior?.message === n.message &&
        prior?.severity === n.severity;
      this.entries.set(n.id, {
        ...n,
        read: this.isOpen || !!(unchanged && prior.read),
        dismissed: !!(unchanged && prior.dismissed),
      });
    }
    this.paint();
  }
  open() {
    for (const n of this.entries.values()) n.read = true;
    this.panel.hidden = false;
    this.paint();
    this.closeButton.focus({ preventScroll: true });
  }
  close(focus = true) {
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    if (focus) this.trigger.focus({ preventScroll: true });
  }
  private paint() {
    const hadFocus = this.list.contains(document.activeElement);
    const items = [...this.entries.values()].filter((n) => !n.dismissed);
    const unread = items.filter((n) => !n.read).length;
    this.badge.hidden = !unread;
    this.badge.textContent = unread > 99 ? "99+" : String(unread);
    this.trigger.setAttribute(
      "aria-label",
      unread ? `Notifications, ${unread} unread` : "Notifications",
    );
    this.trigger.setAttribute("aria-expanded", String(this.isOpen));
    this.list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "notifications-empty";
      empty.textContent = "No notifications. You’re all caught up.";
      this.list.append(empty);
    }
    for (const n of items) {
      const card = document.createElement("article");
      card.className = `notification-card ${n.error ? "error" : n.severity || "info"}`;
      card.dataset.notificationId = n.id;
      const title = document.createElement("h3");
      title.textContent = n.title;
      const message = document.createElement("p");
      message.textContent = n.message;
      const buttons = document.createElement("div");
      buttons.className = "notification-actions";
      for (const action of n.actions || []) {
        const button = document.createElement("button");
        button.textContent = action.label;
        button.type = "button";
        button.onclick = async () => {
          buttons
            .querySelectorAll("button")
            .forEach((b) => (b.disabled = true));
          n.error = undefined;
          try {
            await action.run();
          } catch (error) {
            n.error = String(error);
            n.read = this.isOpen;
          } finally {
            this.paint();
          }
        };
        buttons.append(button);
      }
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Dismiss";
      dismiss.title = "Hide this alert for this session; saved work is kept";
      dismiss.onclick = () => {
        n.dismissed = true;
        this.paint();
      };
      buttons.append(dismiss);
      card.append(title, message);
      if (n.error) {
        const error = document.createElement("p");
        error.className = "error";
        error.textContent = n.error;
        error.setAttribute("role", "status");
        card.append(error);
      }
      card.append(buttons);
      this.list.append(card);
    }
    if (hadFocus && this.isOpen)
      this.closeButton.focus({ preventScroll: true });
  }
}
