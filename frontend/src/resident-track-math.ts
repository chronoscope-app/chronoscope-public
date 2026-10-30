/** A display-only vertex. Synthetic seam vertices never become event IDs. */
export interface TimedTrackVertex {
  x: number;
  y: number;
  z: number;
  time: number;
  drawNext: boolean;
}
/** Two float components retain narrow intervals inside a multi-year study. */
export function timeParts(value: number): [number, number] {
  const high = Math.fround(value);
  return [high, Math.fround(value - high)];
}

/** Split before Cesium inserts date-line vertices, retaining time and edge masks.
 * Duplicate positions split runs so a stationary interval does not shift an
 * incoming track's arrival time to the end of that stationary interval. */
export function splitTimedTrack(input: readonly TimedTrackVertex[]) {
  const result: TimedTrackVertex[][] = [];
  let current: TimedTrackVertex[] = [];
  const finish = () => {
    if (
      current.length > 1 &&
      current.some((v, i) => i < current.length - 1 && v.drawNext)
    )
      result.push(current);
    current = [];
  };
  for (let i = 0; i < input.length; i++) {
    const vertex = { ...input[i] };
    if (!Number.isFinite(vertex.x + vertex.y + vertex.z + vertex.time))
      throw Error("Invalid track vertex");
    // Keep projection endpoints on their intended side, with a submillimetre
    // display offset matching Cesium's own approach to a coplanar date line.
    if (vertex.x < 0 && Math.abs(vertex.y) < 0.0001) {
      const sign = Math.sign(current.at(-1)?.y || input[i + 1]?.y || 1);
      vertex.y = sign * 0.0001;
    }
    const previous = current.at(-1);
    if (previous) {
      // Match PolylineGeometry's relative duplicate tolerance. Splitting here
      // preserves arrival/departure times before its duplicate removal runs.
      if (
        (["x", "y", "z"] as const).every((axis) => {
          const a = vertex[axis],
            b = previous[axis];
          return (
            Math.abs(a - b) <=
            Math.max(1e-10, Math.max(Math.abs(a), Math.abs(b)) * 1e-10)
          );
        })
      )
        finish();
      else if (previous.y * vertex.y < 0) {
        const fraction = previous.y / (previous.y - vertex.y);
        const x = previous.x + (vertex.x - previous.x) * fraction;
        if (x < 0) {
          const seam = {
            x,
            y: Math.sign(previous.y) * 0.0001,
            z: previous.z + (vertex.z - previous.z) * fraction,
            time: previous.time + (vertex.time - previous.time) * fraction,
            drawNext: false,
          };
          current.push(seam);
          const drawNext = previous.drawNext;
          finish();
          current.push({ ...seam, y: -seam.y, drawNext });
        }
      }
    }
    current.push(vertex);
  }
  finish();
  return result;
}

/** Store high/low time in both standard st channels, which survive projection,
 * seam splitting and batching. Line expansion uses expandAndWidth; our custom
 * material does not need the original lateral texture coordinate.
 * Call with compressVertices=false so Cesium cannot quantize it to 12 bits. */
export function stampTrackTimes(
  st: Float32Array,
  vertices: readonly TimedTrackVertex[],
  epoch: number,
  span: number,
) {
  if (st.length !== (vertices.length * 4 - 4) * 2)
    throw Error("Polyline vertex/time mismatch");
  for (let i = 0; i < st.length; i += 2) {
    const vertex = vertices[Math.round(st[i] * (vertices.length - 1))];
    const [high, low] = timeParts((vertex.time - epoch) / span);
    st[i] = high;
    st[i + 1] = low;
  }
}
