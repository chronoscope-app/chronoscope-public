let superIntelligence = false;
export function setAssistantWording(si: boolean) {
  superIntelligence = si;
}
export function assistantName(full = false, si = superIntelligence) {
  return si ? (full ? "Super Intelligence" : "SI") : "AI";
}
/** Product-owned copy only: never pass messages, model names or tool data here. */
export function assistantWording(copy: string, si = superIntelligence) {
  return si ? copy.replace(/\bAI\b/g, "SI") : copy;
}
/** Capture a newly constructed static UI before inserting user/service data.
 * Updates touch only captured labels, never conversation content.
 */
export function bindAssistantWording(root: HTMLElement) {
  const bindings: ((si: boolean) => void)[] = [];
  for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const node of element.childNodes) {
      const original = node.textContent || "";
      if (node.nodeType === Node.TEXT_NODE && /\bAI\b/.test(original))
        bindings.push((si) => {
          node.textContent = assistantWording(original, si);
        });
    }
    for (const attr of ["title", "aria-label", "data-tooltip", "placeholder"]) {
      const original = element.getAttribute(attr);
      if (original && /\bAI\b/.test(original))
        bindings.push((si) => {
          const copy = assistantWording(original, si);
          element.setAttribute(attr, copy);
          if (attr === "title") {
            element.dataset.tooltip = copy;
            element.setAttribute("aria-description", copy);
          }
        });
    }
  }
  return (si = superIntelligence) => bindings.forEach((apply) => apply(si));
}
