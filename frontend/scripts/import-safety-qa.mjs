import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp("import-safety", async ({ page, api, out, pass }) => {
  await page.evaluate(async () => {
    await window.__chronoscope.ready;
    await window.__chronoscope.sceneIdle();
  });
  const small = path.join(out, "small.csv"),
    huge = path.join(out, "100-gb.csv"),
    large = path.join(out, "large.csv"),
    work = path.join(out, "review.csv");
  const header = "timestamp,entity,latitude,longitude\n",
    row = "2026-01-01T00:00:00Z,A,40,-74\n";
  fs.writeFileSync(small, header + row);
  fs.writeFileSync(huge, "");
  const extendSparse = (file, bytes) => {
    // Do not reserve 100 GiB on NTFS: mark sparse before extending.
    if (process.platform === "win32")
      execFileSync("fsutil", ["sparse", "setflag", file], { stdio: "pipe" });
    fs.truncateSync(file, bytes);
  };
  extendSparse(huge, 100 * 1024 ** 3);
  fs.writeFileSync(large, header + row.repeat(1200));
  extendSparse(large, 101 * 1024 ** 2);
  fs.writeFileSync(work, header + row.repeat(200000));
  const starts = [];
  let interruptedCancellations = 0;
  let replayInterrupt = false;
  // Reproduce the Windows timing variant without depending on which SQLite
  // instruction happens to observe Cancel on this machine.
  await page.route("**/api/invoke", async route => {
    if (!replayInterrupt || route.request().postDataJSON().command !== "job_status") return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    if (payload.result?.status === "cancelled") {
      payload.result.error = {code: "CANCELLED", message: "Workspace database: interrupted"};
      interruptedCancellations++;
    }
    await route.fulfill({response, json: payload});
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/api/invoke")) {
      try {
        const b = request.postDataJSON();
        if (b.command === "job_start") starts.push(b.args);
      } catch {}
    }
  });
  const drop = (paths) =>
    page.evaluate((paths) => window.__chronoscope.dropFiles(paths), paths);
  const close = async () => {
    await page.locator("#import-dialog [data-close]").click();
    await page.locator("#import-dialog").waitFor({ state: "detached" });
  };
  await drop([huge, small]);
  await page
    .getByRole("alert")
    .filter({ hasText: /too large/ })
    .waitFor();
  assert(
    !starts.some((x) => x.arguments?.path === huge),
    "Oversized file must not start any content-reading job",
  );
  await page.locator("#import-file-next").click();
  await page.locator("#review-import").waitFor();
  await close();
  pass(
    "A sparse 100 GB file is rejected from metadata; smaller files remain reviewable with no content job for the rejected file",
  );

  const pending = drop([large, small]);
  await page.locator("#large-file-dialog").waitFor();
  assert(!starts.some((x) => x.arguments?.path === large));
  await page.screenshot({
    path: path.join(out, "large-file-confirmation.png"),
  });
  await page.locator("#large-file-skip").click();
  await pending;
  assert.equal(await page.locator("#import-file-select").inputValue(), "1");
  assert(!starts.some((x) => x.arguments?.path === large));
  await close();
  pass(
    "One batch warning appears before content reads; skipping large files continues with smaller files",
  );

  const accepted = drop([large]);
  await page.locator("#large-file-continue").waitFor();
  await page.locator("#large-file-continue").click();
  await accepted;
  await page.locator("#review-import").waitFor();
  assert.match(
    await page.locator("#import-dialog header p").innerText(),
    /1,000 sampled rows/,
  );
  assert(
    !starts.some(
      (x) => x.command === "import_review" && x.arguments?.path === large,
    ),
  );
  await close();
  pass(
    "An intentionally accepted 101 MiB CSV opens using a 1,000-row sample without scanning its sparse tail",
  );

  replayInterrupt = true;
  await drop([work]);
  assert.match(
    await page.locator("#import-dialog header p").innerText(),
    /sampled rows/,
  );
  await page.locator("#review-import").click();
  await page
    .locator("#import-dialog [data-close]")
    .filter({ hasText: "Cancel operation" })
    .waitFor();
  await page.locator("#import-dialog [data-close]").click();
  await page
    .locator("#import-status")
    .filter({ hasText: /cancel/i })
    .waitFor();
  assert(interruptedCancellations > 0, "SQLite interruption variant was exercised");
  assert.equal(await page.locator("#import-status").innerText(), "Operation cancelled");
  assert.equal(await page.locator("#import-status").getAttribute("role"), "status");
  replayInterrupt = false;
  assert.equal((await api("snapshot")).count, 0);
  assert.equal(await page.locator("#commit-import").isDisabled(), true);
  await close();
  pass(
    "Full-file review remains responsive to Cancel and cannot publish partial Events",
  );

  await drop([small]);
  await page.locator("#review-import").click();
  await page.locator("#commit-import:not(:disabled)").waitFor();
  await page.locator("#commit-import").click();
  await page
    .getByText("All dropped files have been handled.", { exact: false })
    .waitFor();
  await close();
  assert.equal((await api("snapshot")).count, 1);
  pass("A fresh import still completes after the cancelled review");
});
