import "./preferences-layout.css";
export type PreferencesSection = "general" | "workspace" | "display" | "agents";
const sections: [PreferencesSection, string][] = [
  ["general", "General"],
  ["workspace", "Workspace"],
  ["display", "Display"],
  ["agents", "Agent access"],
];
export function preferencesLayout(content: Record<PreferencesSection, string>) {
  return `<div class="preferences-body"><nav class="preferences-nav" role="tablist" aria-label="Preference categories" aria-orientation="vertical">${sections.map(([id, label]) => `<button type="button" role="tab" id="preferences-tab-${id}" aria-controls="preferences-panel-${id}" aria-selected="false" tabindex="-1">${label}</button>`).join("")}</nav><div class="preferences-panels">${sections.map(([id, label]) => `<section id="preferences-panel-${id}" role="tabpanel" aria-labelledby="preferences-tab-${id}" tabindex="0" hidden><h3>${label}</h3>${content[id]}</section>`).join("")}</div></div>`;
}
export function bindPreferencesLayout(
  root: HTMLElement,
  initial: PreferencesSection,
) {
  root.querySelector(".modal")!.classList.add("preferences-dialog");
  const tabs = sections.map(([id]) =>
    root.querySelector<HTMLButtonElement>(`#preferences-tab-${id}`)!,
  );
  const panels = sections.map(([id]) =>
    root.querySelector<HTMLElement>(`#preferences-panel-${id}`)!,
  );
  const show = (index: number, focus = false) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => show(index));
    tab.addEventListener("keydown", (event) => {
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % tabs.length
          : event.key === "ArrowUp"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : null;
      if (next === null) return;
      event.preventDefault();
      show(next, true);
    });
  });
  show(sections.findIndex(([id]) => id === initial));
}
