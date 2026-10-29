const markup = new WeakMap<Element, string>();

/** Keep unchanged controls and column geometry attached during live refreshes. */
export function tableMarkup(element: HTMLElement, html: string) {
  if (markup.get(element) === html) return;
  element.innerHTML = html;
  markup.set(element, html);
}

/** Retain row identity (and hover/focus) as a live window gains or loses Events. */
export function tableRows(body: HTMLElement, html: string, attribute: string) {
  if (markup.get(body) === html) return;
  const incoming = document.createElement("tbody");
  incoming.innerHTML = html;
  const key = (row: Element, index: number) => {
    const id = row.getAttribute(attribute);
    return id === null ? `position:${index}` : `${attribute}:${id}`;
  };
  const existing = new Map(
    Array.from(body.children, (row, index) => [key(row, index), row]),
  );
  const desired = Array.from(incoming.children, (row, index) => {
    const retained = existing.get(key(row, index));
    if (!retained) return row;
    for (const attr of Array.from(retained.attributes))
      if (!row.hasAttribute(attr.name)) retained.removeAttribute(attr.name);
    for (const attr of Array.from(row.attributes))
      if (retained.getAttribute(attr.name) !== attr.value)
        retained.setAttribute(attr.name, attr.value);
    if (retained.innerHTML !== row.innerHTML)
      retained.innerHTML = row.innerHTML;
    return retained;
  });
  const keep = new Set(desired);
  for (const row of Array.from(body.children)) if (!keep.has(row)) row.remove();
  let cursor = body.firstElementChild;
  for (const row of desired) {
    if (row !== cursor) body.insertBefore(row, cursor);
    cursor = row.nextElementSibling;
  }
  markup.set(body, html);
}
