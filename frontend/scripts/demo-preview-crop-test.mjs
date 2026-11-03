import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/demo-preview-crop.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { previewSideCrop, cropDemoPreview, bundledPreviewCrops } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const image = (pixel) => {
  const width = 100,
    height = 32,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set([...pixel(x, y), 255], (y * width + x) * 4);
  return () => previewSideCrop(data, width, height);
};
test("asymmetric dark mattes are removed along with their JPEG transition", () => {
  const crop = image((x, y) =>
    x < 10 || x >= 85 ? [16, 23, 34] : [100 + y, 120 + y, 140 + y],
  );
  assert.deepEqual(crop(), { left: 12, right: 83 });
});
test("one-sided matte does not crop the opposite side", () => {
  assert.deepEqual(
    image((x, y) => (x < 10 ? [16, 23, 34] : [100 + y, 120 + y, 140 + y]))(),
    { left: 12, right: 100 },
  );
});
test("dark scene content with vertical detail remains intact", () => {
  assert.deepEqual(image((x, y) => [10 + (y % 2) * 30, 20, 30])(), {
    left: 0,
    right: 100,
  });
});
test("uniform blank images and bright edges are preserved", () => {
  for (const pixel of [
    () => [16, 23, 34],
    (x, y) =>
      x < 10 || x >= 85 ? [255, 255, 255] : [100 + y, 120 + y, 140 + y],
  ])
    assert.deepEqual(image(pixel)(), { left: 0, right: 100 });
});

test("bundled crop bounds match every thumbnail capture", () => {
  for (const [file, bounds] of Object.entries(bundledPreviewCrops)) {
    const bytes = fs.readFileSync(
      new URL(`../public/demos/${file}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      bounds.sha256,
      `${file}: refresh crop bounds after regenerating thumbnails`,
    );
    assert(
      bounds.left >= 0 &&
        bounds.right <= bounds.width &&
        bounds.right > bounds.left,
    );
  }
});
test("bundled previews crop without canvas access in native WebViews", () => {
  const frame = { style: {}, dataset: {} };
  const image = {
    naturalWidth: 480,
    naturalHeight: 300,
    complete: true,
    style: {},
    closest: () => frame,
    getAttribute: () => "/demos/flight-altitude-globe.jpg",
    addEventListener() {},
  };
  const before = globalThis.document;
  globalThis.document = {
    createElement() {
      throw Error("Canvas pixel access unavailable");
    },
  };
  try {
    cropDemoPreview(image);
    assert(Number.parseFloat(image.style.width) > 110);
    assert(Number.parseFloat(image.style.marginLeft) < -5);
    assert.notEqual(frame.style.aspectRatio, undefined);
    assert.equal(frame.dataset.previewReady, "true");
  } finally {
    globalThis.document = before;
  }
});
