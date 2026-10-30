import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { test } from "node:test";
import {
  ArcType,
  Cartesian3,
  Color,
  PolylineGeometry,
  PolylineMaterialAppearance,
} from "cesium";
const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/resident-track-math.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { splitTimedTrack, stampTrackTimes, timeParts } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const node = (x, y, time, drawNext = true, z = 0) => ({
  x,
  y,
  z,
  time,
  drawNext,
});
test("Date-line splits retain time and do not connect opposite map edges", () => {
  const chunks = splitTimedTrack([node(-10, 2, 10), node(-10, -2, 14)]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0][1].time, 12);
  assert.equal(chunks[1][0].time, 12);
  assert(chunks[0].every((p) => p.y > 0));
  assert(chunks[1].every((p) => p.y < 0));
  assert.equal(chunks[0][0].time, 10);
  assert.equal(chunks[1][1].time, 14);
});
test("Prime meridian crossing stays continuous and masked connectors stay hidden", () => {
  assert.equal(splitTimedTrack([node(10, 2, 10), node(10, -2, 14)]).length, 1);
  assert.deepEqual(
    splitTimedTrack([node(-10, 2, 10, false), node(-10, -2, 14, false)]),
    [],
  );
});
test("Stationary time intervals do not delay arrival on the preceding segment", () => {
  const chunks = splitTimedTrack([
    node(10, 2, 0),
    node(11, 2, 1),
    node(11, 2, 5),
    node(12, 2, 6),
  ]);
  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((c) => c.map((p) => p.time)),
    [
      [0, 1],
      [5, 6],
    ],
  );
});
test("Near-stationary positions split before Cesium removes submillimetre duplicates", () => {
  const chunks = splitTimedTrack([
    node(6000000, 20, 0),
    node(6000001, 20, 1),
    node(6000001.0001, 20, 5),
    node(6000002, 20, 6),
  ]);
  assert.deepEqual(
    chunks.map((c) => c.map((p) => p.time)),
    [
      [0, 1],
      [5, 6],
    ],
  );
});
const textureCoordinates = (length) => {
  const st = new Float32Array((length * 4 - 4) * 2);
  let index = 0;
  for (let j = 0; j < length; j++)
    for (let k = j === 0 ? 2 : 0; k < (j === length - 1 ? 2 : 4); k++) {
      st[index++] = j / (length - 1);
      st[index++] = k % 2;
    }
  return st;
};
test("Batched polyline time preserves high and low parts of nonuniform arrival intervals", () => {
  const nodes = [node(10, 2, 100), node(11, 2, 101), node(12, 2, 200)];
  const st = textureCoordinates(nodes.length);
  stampTrackTimes(st, nodes, 100, 100);
  assert.deepEqual(
    [...st].filter((_, i) => i % 2),
    [0, 0, ...Array(4).fill(Math.fround(0.01 - Math.fround(0.01))), 0, 0],
  );
  assert.deepEqual(
    [...st].filter((_, i) => !(i % 2)),
    [0, 0, ...Array(4).fill(Math.fround(0.01)), 1, 1],
  );
  assert.throws(
    () => stampTrackTimes(new Float32Array(4), nodes, 100, 100),
    /mismatch/,
  );
});
test("Large bounded tracks stamp without spread overflow or 12-bit time quantization", () => {
  const nodes = Array.from({ length: 200000 }, (_, i) => node(10, i + 1, i));
  const st = textureCoordinates(nodes.length);
  stampTrackTimes(st, nodes, 0, 199999);
  assert.equal(st[0], 0);
  assert.equal(st.at(-2), 1);
  const times = new Set([...st].filter((_, i) => !(i % 2)));
  assert.equal(times.size, 200000);
});
test("Real Cesium geometry retains timed vertices and masks independent stem connectors", () => {
  const nodes = Array.from({ length: 4 }, (_, i) =>
    node(6000000, i * 100, 100 + i * i),
  );
  const geometry = PolylineGeometry.createGeometry(
    new PolylineGeometry({
      positions: nodes.map((p) => new Cartesian3(p.x, p.y, p.z)),
      arcType: ArcType.NONE,
      width: 1.6,
      vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
      colors: [Color.WHITE, Color.TRANSPARENT, Color.WHITE],
      colorsPerVertex: false,
    }),
  );
  stampTrackTimes(geometry.attributes.st.values, nodes, 100, 9);
  assert.deepEqual(
    [...geometry.attributes.color.values].filter((_, i) => i % 4 === 3),
    [...Array(4).fill(255), ...Array(4).fill(0), ...Array(4).fill(255)],
  );
  const indices = [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3];
  assert.deepEqual(
    [...geometry.attributes.st.values].filter((_, i) => !(i % 2)),
    indices.map((i) => Math.fround((i * i) / 9)),
  );
});

test("Millisecond-separated events retain their order inside a decade-long study", () => {
  const span = 315360000,
    a = 0.5,
    b = 0.5 + 0.001 / span,
    end = 0.5 + 0.0005 / span;
  const [ah, al] = timeParts(a),
    [bh, bl] = timeParts(b),
    [eh, el] = timeParts(end);
  assert.equal(ah, bh);
  assert(ah - eh + (al - el) < 0);
  assert(bh - eh + (bl - el) > 0);
});
