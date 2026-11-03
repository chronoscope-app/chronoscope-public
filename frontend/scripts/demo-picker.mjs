/** Reveal a dataset in the continuously scrolling demo gallery. */
export async function revealDemo(page, id) {
  const target = page.locator(`[data-demo-id="${id}"]`);
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  return target;
}
