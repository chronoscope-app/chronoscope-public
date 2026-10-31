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
  const work=splitTimedTrackSteps(input);
  while(true){const step=work.next();if(step.done)return step.value;}
}

/** The same seam/stationary semantics, yielding before large CPU loops can
 * monopolize a frame during preparation of a single long entity track. */
export function* splitTimedTrackSteps(input: readonly TimedTrackVertex[]): Generator<void,TimedTrackVertex[][]> {
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
    if(i%256===255)yield;
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

/** Shared seam endpoints retain every original segment and timestamp exactly. */
export function* pageTimedTrack(nodes: TimedTrackVertex[], limit: number): Generator<TimedTrackVertex[]> {
  if (!Number.isInteger(limit) || limit < 2) throw Error("Track page size must be at least two");
  for (let start=0;start<nodes.length-1;start+=limit-1)
    yield nodes.slice(start,Math.min(nodes.length,start+limit));
}

/** Exact entity/time/ID order with bounded sort and merge steps. Stable merging
 * retains source order for equal keys, matching the canonical native sort. */
export function* orderedTrackIndices(points: readonly {entity:number;time:number;id:string}[]): Generator<void,number[]> {
  const compare=(a:number,b:number)=>points[a].entity-points[b].entity || points[a].time-points[b].time || points[a].id.localeCompare(points[b].id);
  let order:number[]=[],sorted=true;
  for(let i=0;i<points.length;i++) {
    order.push(i);if(i && compare(i-1,i)>0)sorted=false;
    if(i%512===511)yield;
  }
  if(sorted)return order;
  for(let offset=0;offset<order.length;offset+=1024) {
    const run=order.slice(offset,offset+1024).sort(compare);
    for(let i=0;i<run.length;i++)order[offset+i]=run[i];
    yield;
  }
  let scratch:number[]=new Array(order.length);
  for(let width=1024;width<order.length;width*=2) {
    for(let start=0;start<order.length;start+=width*2) {
      const middle=Math.min(start+width,order.length),end=Math.min(start+width*2,order.length);
      let a=start,b=middle;
      for(let out=start;out<end;out++) {
        scratch[out]=b>=end || (a<middle && compare(order[a],order[b])<=0) ? order[a++] : order[b++];
        if(out%1024===1023)yield;
      }
    }
    [order,scratch]=[scratch,order];
  }
  return order;
}
