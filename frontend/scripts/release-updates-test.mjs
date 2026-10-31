import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const module = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/release-updates.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { ReleaseUpdates, newestRelease, releasesApi, releasesPage } =
  await import(
    "data:text/javascript;base64," +
      Buffer.from(module.outputFiles[0].text).toString("base64")
  );
const published = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: true,
  published_at: "2026-10-31T12:00:00Z",
  ...extra,
});
function fixture({
  version = "0.16.11",
  data = [published("v0.16.12")],
  storage = new Map(),
  fetcher,
} = {}) {
  let now = Date.parse("2026-10-31T15:00:00Z");
  const requests = [],
    notices = [],
    opened = [];
  const hooks = {
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    now: () => now,
    notify: (n) => notices.push(n),
    open: (url) => {
      opened.push(url);
    },
    fetch: async (...args) => {
      requests.push(args);
      return fetcher ? fetcher(...args) : new Response(JSON.stringify(data));
    },
  };
  return {
    updates: new ReleaseUpdates(version, hooks),
    hooks,
    requests,
    notices,
    opened,
    storage,
    advance: (ms) => {
      now += ms;
    },
  };
}
test("published previews use semantic ordering; drafts, unpublished and tester tags are ignored", () => {
  const r = newestRelease([
    published("v0.16.9"),
    published("v0.16.12"),
    published("v99.0.0", { draft: true }),
    published("v88.0.0", { published_at: null }),
    published("tester-20261022"),
  ]);
  assert.equal(r.version, "0.16.12");
  assert(r.preview);
  assert.equal(newestRelease([]), null);
  assert.throws(() => newestRelease({ message: "bad" }), /unexpected/);
});
test("API requests omit credentials and open only a constructed Chronoscope release URL", async () => {
  const f = fixture({
    data: [
      published("v0.16.12", {
        html_url: "https://evil.invalid/",
        name: "<img onerror=alert(1)>",
      }),
    ],
  });
  const result = await f.updates.check(true);
  assert.equal(result.release.version, "0.16.12");
  const [url, o] = f.requests[0];
  assert.equal(url, releasesApi);
  assert.equal(o.credentials, "omit");
  assert.equal(o.redirect, "error");
  assert.equal(o.cache, "no-cache");
  assert(o.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(o.headers).sort(), [
    "Accept",
    "X-GitHub-Api-Version",
  ]);
  assert.equal(f.notices.at(-1).length, 1);
  assert.equal(f.opened.length, 0);
  await f.notices.at(-1)[0].actions[0].run();
  assert.deepEqual(f.opened, [releasesPage + "/tag/v0.16.12"]);
});
test("equal, older and build-metadata-only releases never advertise a downgrade", async () => {
  for (const tag of [
    "v0.16.11",
    "v0.16.9",
    "v0.16.11+build.99",
    "v0.16.11-beta.2",
  ]) {
    const f = fixture({ data: [published(tag)] });
    const r = await f.updates.check(true);
    assert(!f.updates.isNewer(r.release), tag);
    assert.deepEqual(f.notices.at(-1), []);
  }
});
test("a final version supersedes its prerelease build", async () => {
  const f = fixture({
    version: "0.17.0-beta.2",
    data: [published("v0.17.0", { prerelease: false })],
  });
  await f.updates.check(true);
  assert.equal(f.notices.at(-1).length, 1);
});
test("successful checks are shared across launches and repeat after a day", async () => {
  const f = fixture();
  await f.updates.check();
  await f.updates.check();
  assert.equal(f.requests.length, 1);
  const next = fixture({ storage: f.storage });
  assert((await next.updates.check()).cached);
  assert.equal(next.requests.length, 0);
  assert.equal(next.notices.at(-1).length, 1);
  next.advance(24 * 60 * 60 * 1000 + 1);
  await next.updates.check();
  assert.equal(next.requests.length, 1);
});
test("automatic opt-out persists while manual checks still work", async () => {
  const f = fixture();
  f.updates.setAutomatic(false);
  await f.updates.check();
  assert.equal(f.requests.length, 0);
  const next = fixture({ storage: f.storage });
  assert(!next.updates.automatic);
  await next.updates.check();
  assert.equal(next.requests.length, 0);
  await next.updates.check(true);
  assert.equal(next.requests.length, 1);
});
test("concurrent checks share a request and later manual checks bypass the daily cache", async () => {
  let resolve;
  const f = fixture({
    fetcher: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const a = f.updates.check(true),
    b = f.updates.check(true);
  assert.equal(f.requests.length, 1);
  resolve(new Response(JSON.stringify([published("v0.16.12")])));
  await Promise.all([a, b]);
  const c = f.updates.check(true);
  assert.equal(f.requests.length, 2);
  resolve(new Response("[]"));
  await c;
});
test("rate limiting and offline failures stay explicit; automatic failures back off for an hour", async () => {
  const f = fixture({
    fetcher: async () => new Response("{}", { status: 403 }),
  });
  assert.match((await f.updates.check()).error, /limiting/);
  await f.updates.check();
  assert.equal(f.requests.length, 1);
  f.advance(60 * 60 * 1000 + 1);
  await f.updates.check();
  assert.equal(f.requests.length, 2);
  const offline = fixture({
    fetcher: async () => {
      throw TypeError("network down");
    },
  });
  assert.match((await offline.updates.check(true)).error, /connection/);
  assert.equal(offline.notices.at(-1).length, 0);
});
test("malformed API data reports an error rather than up to date", async () => {
  const f = fixture({ data: { message: "bad" } });
  assert.match((await f.updates.check(true)).error, /unexpected/);
});
test("unavailable local storage cannot block checking", async () => {
  const f = fixture();
  f.hooks.storage.getItem = () => {
    throw Error("blocked");
  };
  f.hooks.storage.setItem = () => {
    throw Error("blocked");
  };
  assert.equal(
    (await new ReleaseUpdates("0.16.11", f.hooks).check(true)).release.version,
    "0.16.12",
  );
});
test("disabling automatic checking during a request suppresses its notification", async () => {
  let resolve;
  const f = fixture({
    fetcher: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const check = f.updates.check();
  f.updates.setAutomatic(false);
  resolve(new Response(JSON.stringify([published("v0.16.12")])));
  await check;
  assert.deepEqual(f.notices.at(-1), []);
});
