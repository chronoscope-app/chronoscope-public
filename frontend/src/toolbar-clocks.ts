import "./toolbar-clocks.css";

const storageKey = "chronoscope.toolbar-time-zone";
const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
};
const cityName = (zone: string) => zone.split("/").at(-1)!.replaceAll("_", " ");

/** Wall clocks are independent of the workspace's data time and playback. */
export function installToolbarClocks(bell: HTMLButtonElement) {
  let selected = "Asia/Tokyo";
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && validZone(saved)) selected = saved;
  } catch { /* Clocks also work when storage is unavailable. */ }
  const clocks = document.createElement("div");
  clocks.className = "toolbar-clocks";
  clocks.setAttribute("role", "group");
  clocks.setAttribute("aria-label", "Current time around the world");
  const values: HTMLElement[] = [];
  let trigger!: HTMLButtonElement;
  for (const label of ["Local", "UTC", cityName(selected)]) {
    const clock = document.createElement(values.length === 2 ? "button" : "div");
    clock.className = "toolbar-clock";
    const name = document.createElement("span");
    name.className = "toolbar-clock-label";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "toolbar-clock-value";
    clock.append(name, value);
    if (clock instanceof HTMLButtonElement) {
      trigger = clock;
      trigger.type = "button";
      trigger.setAttribute("aria-label", "Choose third clock time zone");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-controls", "toolbar-clock-picker");
      trigger.setAttribute("aria-haspopup", "dialog");
      name.classList.add("toolbar-clock-selectable");
    }
    clocks.append(clock);
    values.push(value);
  }
  bell.before(clocks);
  const panel = document.createElement("section");
  panel.id = "toolbar-clock-picker";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Third clock time zone");
  const label = document.createElement("label");
  label.htmlFor = "toolbar-clock-zone";
  label.textContent = "Third clock time zone";
  const select = document.createElement("select");
  select.id = label.htmlFor;
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones = new Set([
    "UTC", selected, Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(intl.supportedValuesOf?.("timeZone") ?? ["America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"]),
  ]);
  for (const zone of [...zones].sort()) {
    select.add(new Option(zone.replaceAll("_", " "), zone));
  }
  select.value = selected;
  const detail = document.createElement("p");
  panel.append(label, select, detail);
  document.body.append(panel);
  const close = (focus = false) => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  };
  const position = () => {
    const bounds = trigger.getBoundingClientRect();
    panel.style.top = `${bounds.bottom + 8}px`;
    panel.style.right = `${Math.max(8, innerWidth - bounds.right)}px`;
  };
  trigger.addEventListener("click", () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position();
    select.focus();
  });
  document.addEventListener("pointerdown", event => {
    if (event.target instanceof Node && !panel.contains(event.target) && !trigger.contains(event.target)) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      close(true);
    }
  });
  window.addEventListener("resize", () => { if (!panel.hidden) position(); });
  const render = () => {
    const now = new Date();
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    [local, "UTC", selected].forEach((zone, i) => {
      values[i].textContent = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(now);
      const description = new Intl.DateTimeFormat(undefined, {
        timeZone: zone, dateStyle: "full",
      }).format(now) + " · " + zone;
      values[i].parentElement!.title = description;
      if (i === 2) detail.textContent = description;
    });
    trigger.querySelector(".toolbar-clock-label")!.textContent = cityName(selected);
  };
  select.addEventListener("change", () => {
    selected = select.value;
    try { localStorage.setItem(storageKey, selected); } catch { /* Session-only choice. */ }
    render();
    close(true);
  });
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
    clearTimeout(timer);
    render();
    timer = setTimeout(update, 60000 - Date.now() % 60000 + 25);
  };
  document.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
  update();
}
