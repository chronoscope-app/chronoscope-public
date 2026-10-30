// Experimental playback renderer. The engine still owns all analytical filters.
import {
  BoundingSphere,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Primitive,
  PrimitiveType,
  type Cartesian3,
  type Color,
  type Scene,
} from "cesium";
import type { Point } from "./types";
import { ResidentLines } from "./resident-lines";
import { timeParts } from "./resident-track-math";

interface ResidentOptions {
  points: boolean;
  tracks: boolean;
  pointScale: number;
  trackOpacity: number;
  gapSeconds: number;
  ground?: (point: Point) => Cartesian3;
  groundTracks?: (point: Point) => Cartesian3;
  trailOpacity?: number;
  stemOpacity?: number;
  curvedTracks?: boolean;
  maximumStep?: number;
  selection?: boolean;
}

const vertexShader = `
in vec3 position3DHigh;
in vec3 position3DLow;
in float batchId;
in float sampleTime;
in float sampleTimeLow;
in vec4 sampleColor;
out vec3 v_positionEC;
out vec3 v_normalEC;
out float v_sampleTime;
out float v_sampleTimeLow;
out vec4 v_sampleColor;
void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = vec3(0.0, 0.0, 1.0);
  v_sampleTime = sampleTime;
  v_sampleTimeLow = sampleTimeLow;
  v_sampleColor = sampleColor;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
  gl_PointSize = 7.0 * czm_pixelRatio;
}`;

export class ResidentPlayback {
  private primitives: Primitive[] = [];
  private materials: Material[] = [];
  private start = 0;
  private end = 1;
  readonly epoch: number;
  readonly span: number;
  readonly pointCount: number;
  readonly segmentCount: number;
  preparedBytes: number;
  preparationMs: number;
  private pending?: Generator<void>;
  private groups = new Map<number, Point[]>();
  private byId: Map<string, Point>;
  private positionsById: Map<string, Cartesian3>;
  private lines?: ResidentLines;
  private selection?: ResidentPlayback;
  private selectionKey = "";

  constructor(
    private scene: Scene,
    points: Point[],
    position: (point: Point) => Cartesian3,
    color: (entity: number) => Color,
    private options: ResidentOptions = {
      points: true,
      tracks: true,
      pointScale: 1,
      trackOpacity: 0.25,
      gapSeconds: 0,
    },
    incremental = false,
  ) {
    const started = performance.now();
    if (!points.length || points.length > 100000)
      throw Error("Smooth graphics requires 1-100,000 points");
    // Flat tracks are regional. Curved tracks handle date-line splitting;
    // rich geometry and duration semantics stay with the canonical renderer.
    const west = points.reduce((n, p) => Math.min(n, p.lon), Infinity),
      east = points.reduce((n, p) => Math.max(n, p.lon), -Infinity);
    if (
      !options.curvedTracks &&
      (east - west > 120 || west < -170 || east > 170)
    )
      throw Error("Resident preview currently requires a regional dataset");
    this.epoch = points.reduce((n, p) => Math.min(n, p.time), Infinity);
    this.span = Math.max(
      1,
      points.reduce((n, p) => Math.max(n, p.time), -Infinity) - this.epoch,
    );
    // Resolve colors and positions once per entity/record, including curved runs.
    const colorSource = color, colorCache = new Map<number, Color>();
    color = entity => {
      let value = colorCache.get(entity);
      if (!value) { value = colorSource(entity); colorCache.set(entity, value); }
      return value;
    };
    const positions = points.map(position);
    const cachedPositions = new Map(points.map((p, i) => [p, positions[i]]));
    const originalPosition = position;
    position = p => cachedPositions.get(p) || originalPosition(p);
    this.positionsById = new Map(points.map((p, i) => [p.id, positions[i]]));
    this.byId = new Map(points.map((p) => [p.id, p]));
    for (const point of points) {
      const group = this.groups.get(point.entity) || [];
      group.push(point);
      this.groups.set(point.entity, group);
    }
    if (this.groups.size > 2048)
      throw Error("This dataset uses standard playback");
    const order = points
      .map((_, i) => i)
      .sort(
        (a, b) =>
          points[a].entity - points[b].entity ||
          points[a].time - points[b].time ||
          points[a].id.localeCompare(points[b].id),
      );
    const edges: number[] = [];
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1],
        b = order[i];
      if (
        points[a].entity === points[b].entity &&
        !points[a].inferred &&
        !points[b].inferred &&
        (!options.gapSeconds ||
          points[b].time - points[a].time <= options.gapSeconds)
      )
        edges.push(a, b);
    }
    this.pointCount = points.length;
    this.segmentCount = edges.length / 2;
    this.preparedBytes =
      (options.points
        ? this.add(
            points.map((_, i) => i),
            PrimitiveType.POINTS,
            points,
            positions,
            color,
          )
        : 0) +
      (options.tracks && !options.curvedTracks
        ? this.add(edges, PrimitiveType.LINES, points, positions, color)
        : 0);
    if (options.curvedTracks) {
      this.lines = new ResidentLines(scene, this.epoch, this.span);
      const lines = this.lines;
      const prepare = function* () {
        if (options.tracks)
          yield* lines.prepareTracks(points, order, position, color, options.gapSeconds,
            options.trackOpacity, options.maximumStep ?? 200000);
        if (options.groundTracks)
          yield* lines.prepareTracks(points, order, options.groundTracks, color, options.gapSeconds,
            options.trailOpacity ?? 0.25, options.maximumStep ?? 200000, 2);
        if (options.ground)
          yield* lines.prepareStems(points, options.ground, position, options.stemOpacity ?? 0.15);
        lines.seal();
      };
      this.pending = prepare();
      if (!incremental) {
        try {
          for (const _ of this.pending) { /* small synchronous overlays */ }
          this.pending = undefined;
          this.preparedBytes += lines.preparedBytes;
        } catch (error) { this.destroy(); throw error; }
      }
    }
    if (options.ground && !options.curvedTracks) {
      const stemPoints: Point[] = [],
        stemPositions: Cartesian3[] = [];
      points.forEach((p, i) => {
        stemPoints.push(p, p);
        stemPositions.push(options.ground!(p), positions[i]);
      });
      this.preparedBytes += this.add(
        stemPoints.map((_, i) => i),
        PrimitiveType.LINES,
        stemPoints,
        stemPositions,
        () => ({ red: 0.6, green: 0.72, blue: 0.78 }) as Color,
        options.stemOpacity ?? 0.15,
      );
    }
    if (options.groundTracks && !options.curvedTracks) {
      this.preparedBytes += this.add(
        edges,
        PrimitiveType.LINES,
        points,
        points.map(options.groundTracks),
        color,
        options.trailOpacity ?? 0.25,
      );
    }
    this.preparationMs = performance.now() - started;
  }

  /** Warm discarded geometry while the current renderer remains visible.
   * Yield curved preparation to input/rendering; cancel obsolete work promptly. */
  async prepare(accept: () => boolean) {
    const started = performance.now();
    const alive = () => accept() && !this.scene.isDestroyed();
    this.setWindow(this.epoch + this.span, this.epoch - this.span);
    if (this.pending) {
      let deadline = performance.now() + 6;
      for (const _ of this.pending) {
        if (!alive()) return false;
        if (performance.now() >= deadline) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          deadline = performance.now() + 6;
        }
      }
      this.pending = undefined;
      this.preparedBytes += this.lines?.preparedBytes || 0;
      // The line material was created at seal(), after the first discarded window.
      this.setWindow(this.epoch + this.span, this.epoch - this.span);
    }
    const limit = performance.now() + 30000;
    // Primitive.ready is set after an update. Do not hide the previous drawing
    // until every point/line batch has actually passed through Cesium's pipeline.
    while (alive()) {
      this.scene.requestRender();
      await new Promise<void>(resolve => setTimeout(resolve, 16));
      if (this.primitives.every(p => p.ready) && (!this.lines || this.lines.ready)) {
        this.preparationMs += performance.now() - started;
        return true;
      }
      if (performance.now() > limit) throw Error("Prepared graphics timed out");
    }
    return false;
  }

  private add(
    indices: number[],
    primitiveType: PrimitiveType,
    points: Point[],
    positions: Cartesian3[],
    color: (entity: number) => Color,
    opacity = this.options.trackOpacity,
  ) {
    if (!indices.length) return 0;
    const xyz = new Float64Array(indices.length * 3),
      times = new Float32Array(indices.length),
      lowTimes = new Float32Array(indices.length),
      colors = new Uint8Array(indices.length * 4);
    indices.forEach((index, i) => {
      const p = positions[index],
        c = color(points[index].entity);
      xyz.set([p.x, p.y, p.z], i * 3);
      [times[i], lowTimes[i]] = timeParts(
        (points[index].time - this.epoch) / this.span,
      );
      colors.set(
        [
          c.red * 255,
          c.green * 255,
          c.blue * 255,
          primitiveType === PrimitiveType.POINTS ? 230 : opacity * 255,
        ],
        i * 4,
      );
    });
    const isPoint = primitiveType === PrimitiveType.POINTS;
    const material = new Material({
      fabric: {
        type: this.options.selection
          ? "ResidentSelectionRing"
          : isPoint
            ? "ResidentPreviewPoints"
            : "ResidentPreviewTracks",
        uniforms: {
          windowStart: 0,
          windowStartLow: 0,
          windowEnd: 1,
          windowEndLow: 0,
        },
        source: `in float v_sampleTime; in float v_sampleTimeLow; in vec4 v_sampleColor;
      czm_material czm_getMaterial(czm_materialInput materialInput) {
        if ((v_sampleTime-windowStart)+(v_sampleTimeLow-windowStartLow)<0.0 || (v_sampleTime-windowEnd)+(v_sampleTimeLow-windowEndLow)>0.0) discard;
        czm_material m = czm_getDefaultMaterial(materialInput);
        m.diffuse = v_sampleColor.rgb;
        m.alpha = v_sampleColor.a;
        ${this.options.selection ? "float radius=length(gl_PointCoord-vec2(0.5)); if(radius>0.5 || radius<0.35) discard;" : isPoint ? "float radius = length(gl_PointCoord - vec2(0.5)); if (radius > 0.5) discard; m.alpha *= 1.0 - smoothstep(0.2,0.5,radius);" : ""}
        return m;
      }`,
      },
    });
    this.materials.push(material);
    const geometry = new Geometry({
      attributes: Object.assign(new GeometryAttributes(), {
        position: new GeometryAttribute({
          componentDatatype: ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: xyz,
        }),
        sampleTime: new GeometryAttribute({
          componentDatatype: ComponentDatatype.FLOAT,
          componentsPerAttribute: 1,
          values: times,
        }),
        sampleTimeLow: new GeometryAttribute({
          componentDatatype: ComponentDatatype.FLOAT,
          componentsPerAttribute: 1,
          values: lowTimes,
        }),
        sampleColor: new GeometryAttribute({
          componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 4,
          normalize: true,
          values: colors,
        }),
      }),
      primitiveType,
      boundingSphere: BoundingSphere.fromVertices(xyz),
    });
    // One geometry per entity keeps GPU picking bounded without allocating a
    // separate primitive or a large batch-table entry for every event.
    const grouped = new Map<number, number[]>();
    if (isPoint)
      indices.forEach((index, i) => {
        const members = grouped.get(points[index].entity) || [];
        members.push(i);
        grouped.set(points[index].entity, members);
      });
    const instances = isPoint
      ? [...grouped].map(([entity, members]) => {
          const groupXyz = new Float64Array(members.length * 3),
            groupTimes = new Float32Array(members.length),
            groupLowTimes = new Float32Array(members.length),
            groupColors = new Uint8Array(members.length * 4);
          members.forEach((i, j) => {
            groupXyz.set(xyz.subarray(i * 3, i * 3 + 3), j * 3);
            groupTimes[j] = times[i];
            groupLowTimes[j] = lowTimes[i];
            groupColors.set(colors.subarray(i * 4, i * 4 + 4), j * 4);
          });
          return new GeometryInstance({
            id: {
              residentEntity: entity,
              residentSelection: !!this.options.selection,
            },
            geometry: new Geometry({
              attributes: Object.assign(new GeometryAttributes(), {
                position: new GeometryAttribute({
                  componentDatatype: ComponentDatatype.DOUBLE,
                  componentsPerAttribute: 3,
                  values: groupXyz,
                }),
                sampleTime: new GeometryAttribute({
                  componentDatatype: ComponentDatatype.FLOAT,
                  componentsPerAttribute: 1,
                  values: groupTimes,
                }),
                sampleTimeLow: new GeometryAttribute({
                  componentDatatype: ComponentDatatype.FLOAT,
                  componentsPerAttribute: 1,
                  values: groupLowTimes,
                }),
                sampleColor: new GeometryAttribute({
                  componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
                  componentsPerAttribute: 4,
                  normalize: true,
                  values: groupColors,
                }),
              }),
              primitiveType,
              boundingSphere: BoundingSphere.fromVertices(groupXyz),
            }),
          });
        })
      : new GeometryInstance({ geometry });
    this.primitives.push(
      this.scene.primitives.add(
        new Primitive({
          geometryInstances: instances,
          appearance: new MaterialAppearance({
            material,
            flat: true,
            translucent: true,
            materialSupport: MaterialAppearance.MaterialSupport.BASIC,
            vertexShaderSource: vertexShader.replace(
              "7.0 * czm_pixelRatio",
              `${(7 * this.options.pointScale + (this.options.selection ? 3 : 0)).toFixed(5)} * czm_pixelRatio`,
            ),
          }),
          asynchronous: false,
          allowPicking: isPoint,
          compressVertices: false,
        }),
      ),
    );
    return (
      xyz.byteLength +
      times.byteLength +
      lowTimes.byteLength +
      colors.byteLength
    );
  }

  setWindow(start: number, end: number) {
    this.start = start;
    this.end = end;
    for (const material of this.materials) {
      [material.uniforms.windowStart, material.uniforms.windowStartLow] =
        timeParts((start - this.epoch) / this.span);
      [material.uniforms.windowEnd, material.uniforms.windowEndLow] = timeParts(
        (end - this.epoch) / this.span,
      );
    }
    this.lines?.setWindow(start, end);
    this.selection?.setWindow(start, end);
    this.scene.requestRender();
  }
  point(id: string) {
    return this.byId.get(id);
  }
  visiblePoint(id: string) {
    const point = this.byId.get(id);
    return point && point.time >= this.start && point.time <= this.end
      ? point
      : undefined;
  }
  setSelection(ids: readonly string[], color: Color) {
    const key = JSON.stringify([ids, color.toCssColorString()]);
    if (key === this.selectionKey) return;
    this.selectionKey = key;
    this.selection?.destroy();
    this.selection = undefined;
    const selected = ids.flatMap((id) => {
      const p = this.byId.get(id);
      return p ? [p] : [];
    });
    if (selected.length) {
      this.selection = new ResidentPlayback(
        this.scene,
        selected,
        (p) => this.positionsById.get(p.id)!,
        () => color,
        {
          points: true,
          tracks: false,
          pointScale: this.options.pointScale,
          trackOpacity: 1,
          gapSeconds: 0,
          selection: true,
          curvedTracks: true,
        },
      );
      this.selection.setWindow(this.start, this.end);
    }
  }
  pointPosition(id: string) {
    return this.positionsById.get(id);
  }
  visiblePoints() {
    return [...this.byId.values()].filter(
      (p) => p.time >= this.start && p.time <= this.end,
    );
  }
  pick(
    entity: number,
    x: number,
    y: number,
    project: (point: Point) => { x: number; y: number } | undefined,
    selectedOnly = false,
  ): string | undefined {
    if (selectedOnly) return this.selection?.pick(entity, x, y, project);
    let result: Point | undefined,
      distance = Math.max(7, 5 * this.options.pointScale) ** 2;
    for (const point of this.groups.get(entity) || []) {
      if (point.time < this.start || point.time > this.end) continue;
      const pixel = project(point);
      if (!pixel) continue;
      const d = (pixel.x - x) ** 2 + (pixel.y - y) ** 2;
      if (d < distance) {
        result = point;
        distance = d;
      }
    }
    return result?.id;
  }
  diagnostics() {
    return {
      pointCount: this.pointCount,
      segmentCount: this.segmentCount,
      preparedBytes: this.preparedBytes,
      preparationMs: this.preparationMs,
      selectedCount: this.selection?.pointCount || 0,
      window: [this.start, this.end],
      drawPrimitives: this.primitives.length + (this.lines?.batches || 0),
      curvedTracks: this.lines
        ? {
            batches: this.lines.batches,
            runs: this.lines.runs,
            vertices: this.lines.vertices,
            dateLineCuts: this.lines.dateLineCuts,
            interpolated: this.lines.interpolated,
            coarsened: this.lines.coarsened,
          }
        : null,
    };
  }
  destroy() {
    this.selection?.destroy();
    this.selection = undefined;
    this.lines?.destroy();
    this.lines = undefined;
    if (!this.scene.isDestroyed())
      for (const primitive of this.primitives) this.scene.primitives.remove(primitive);
    this.primitives = [];
    this.materials = [];
    if (!this.scene.isDestroyed()) this.scene.requestRender();
  }
}
