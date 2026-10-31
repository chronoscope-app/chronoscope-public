import {
  ArcType,
  Cartesian3,
  Color,
  Material,
  GeometryInstance,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  type Scene,
} from "cesium";
import { createArcBudget, geodesicPositions } from "./cesium-geometry";
import {
  stampTrackTimes,
  timeParts,
  splitTimedTrackSteps,
  pageTimedTrack,
  type TimedTrackVertex,
} from "./resident-track-math";
import type { Point } from "./types";

/** Persistent, time-clipped polylines. Time uses the standard st attribute,
 * which Cesium preserves when projecting/splitting and combining geometry.
 * Bounded primitive pages share one material instead of one material per run. */
export class ResidentLines {
  private instances: GeometryInstance[] = [];
  private primitives: Primitive[] = [];
  private uploads: (() => void)[] = [];
  largestUploadVertices = 0;
  private material?: Material;
  preparedBytes = 0;
  vertices = 0;
  dateLineCuts = 0;
  interpolated = 0;
  coarsened = 0;
  batches = 0;
  runs = 0;
  constructor(
    private scene: Scene,
    private epoch: number,
    private span: number,
    private staged = false,
  ) {}
  private *prepareRun(
    nodes: TimedTrackVertex[],
    color: Color,
    opacity: number,
    width = 1.6,
  ) {
    const chunks = yield* splitTimedTrackSteps(nodes);
    for (let i = 1; i < chunks.length; i++) {
      const a = chunks[i - 1].at(-1)!,
        b = chunks[i][0];
      if (
        a.x < 0 &&
        a.x === b.x &&
        a.z === b.z &&
        a.time === b.time &&
        a.y * b.y < 0
      )
        this.dateLineCuts++;
    }
    for (const section of chunks) for (const chunk of pageTimedTrack(section, 2048)) {
      const geometry = PolylineGeometry.createGeometry(
        new PolylineGeometry({
          positions: chunk.map((v) => new Cartesian3(v.x, v.y, v.z)),
          colors: chunk
            .slice(0, -1)
            .map((v) => color.withAlpha(v.drawNext ? opacity : 0)),
          colorsPerVertex: false,
          width,
          arcType: ArcType.NONE,
          vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
        }),
      );
      if (!geometry) continue;
      stampTrackTimes(
        geometry.attributes.st!.values as Float32Array,
        chunk,
        this.epoch,
        this.span,
      );
      this.instances.push(new GeometryInstance({ geometry }));
      this.vertices += chunk.length;
      this.runs++;
      const bytes = (value: unknown) =>
        ArrayBuffer.isView(value) ? value.byteLength : 0;
      this.preparedBytes +=
        Object.values(geometry.attributes).reduce(
          (n, a) => n + bytes(a?.values),
          0,
        ) + bytes(geometry.indices);
      yield;
    }
  }
  seal() {
    if (!this.instances.length) return;
    this.material = new Material({
      fabric: {
        type: "ResidentBatchedPolylineV2",
        uniforms: {
          windowStart: this.staged ? 1 : 0,
          windowStartLow: 0,
          windowEnd: this.staged ? -1 : 1,
          windowEndLow: 0,
        },
        source: `
      in vec4 v_residentColor;
      in float v_residentTimeLow;
      czm_material czm_getMaterial(czm_materialInput materialInput) {
        if((materialInput.st.s-windowStart)+(v_residentTimeLow-windowStartLow)<0.0 || (materialInput.st.s-windowEnd)+(v_residentTimeLow-windowEndLow)>0.0 || v_residentColor.a<0.001) discard;
        czm_material m=czm_getDefaultMaterial(materialInput);
        m.diffuse=v_residentColor.rgb; m.alpha=v_residentColor.a; return m;
      }`,
      },
    });
    const standard = new PolylineMaterialAppearance({
      material: this.material,
    });
    const vertexShaderSource = standard.vertexShaderSource.replace(
      /void main\s*\(\s*\)\s*\{/,
      "in vec4 color;\nout vec4 v_residentColor;\nout float v_residentTimeLow;\nvoid main(){v_residentColor=color;v_residentTimeLow=st.t;",
    );
    // Each public Primitive processes and uploads a bounded page. All pages
    // share one material/uniform window, avoiding a material/draw per track.
    let page: GeometryInstance[] = [], vertices = 0;
    const flush = () => {
      if (!page.length) return;
      const instances = page, count = vertices;
      const upload = () => {
        this.primitives.push(this.scene.primitives.add(new Primitive({
          geometryInstances: instances,
          appearance: new PolylineMaterialAppearance({material: this.material!, vertexShaderSource}),
          compressVertices: false,
          asynchronous: false,
          releaseGeometryInstances: true,
        })));
      };
      this.largestUploadVertices = Math.max(this.largestUploadVertices, count);
      if (this.staged) this.uploads.push(upload); else upload();
      page = []; vertices = 0; this.batches++;
    };
    for (const instance of this.instances) {
      const geometry = instance.geometry as ReturnType<typeof PolylineGeometry.createGeometry>;
      const count = (geometry!.attributes.position!.values!.length / 3);
      if (vertices + count > 8192) flush();
      page.push(instance); vertices += count;
    }
    flush();
    this.instances = [];

  }
  *prepareTracks(
    points: Point[],
    order: number[],
    position: (point: Point) => Cartesian3,
    color: (entity: number) => Color,
    gap: number,
    opacity: number,
    maximumStep: number,
    width = 1.6,
  ) {
    const budget = createArcBudget(Math.max(0, order.length - 1), 200000);
    let run: TimedTrackVertex[] = [],
      entity = -1;
    let processed = 0;
    for (const index of order) {
      if (++processed % 256 === 0) yield;
      const point = points[index];
      const last = run.at(-1);
      if (
        entity !== point.entity ||
        (last && gap && point.time - last.time > gap)
      ) {
        if(run.length>1)yield* this.prepareRun(run,color(entity),opacity,width);
        run=[];
      }
      entity = point.entity;
      const p = position(point);
      if (run.length) {
        const a = run.at(-1)!;
        const arc = geodesicPositions(
          [new Cartesian3(a.x, a.y, a.z), p],
          maximumStep,
          budget,
        );
        for (let i = 1; i < arc.length; i++)
          run.push({
            ...arc[i],
            time: a.time + ((point.time - a.time) * i) / (arc.length - 1),
            drawNext: true,
          });
      } else run.push({ ...p, time: point.time, drawNext: true });
    }
    if(run.length>1)yield* this.prepareRun(run,color(entity),opacity,width);
    this.interpolated += budget.interpolated;
    this.coarsened += budget.coarsened;
  }
  *prepareStems(
    points: Point[],
    ground: (point: Point) => Cartesian3,
    position: (point: Point) => Cartesian3,
    opacity: number,
  ) {
    // Invisible connectors batch independent stems without a draw per event.
    for (let offset = 0; offset < points.length; offset += 1000) {
      const nodes: TimedTrackVertex[] = [];
      for (const point of points.slice(offset, offset + 1000)) {
        nodes.push(
          { ...ground(point), time: point.time, drawNext: true },
          { ...position(point), time: point.time, drawNext: false },
        );
      }
      yield* this.prepareRun(nodes, Color.fromCssColorString("#99b8c7"), opacity, 1);
      yield;
    }
  }
  addTracks(...args: Parameters<ResidentLines["prepareTracks"]>) {
    for (const _ of this.prepareTracks(...args)) { /* synchronous small overlays */ }
  }
  addStems(...args: Parameters<ResidentLines["prepareStems"]>) {
    for (const _ of this.prepareStems(...args)) { /* synchronous small overlays */ }
  }
  takeUpload() { return this.uploads.shift(); }
  get pendingUploads() { return this.uploads.length; }
  get uploadedReady() { return this.primitives.every(p => p.ready); }
  get ready() { return !this.uploads.length && this.uploadedReady; }
  setWindow(start: number, end: number) {
    if (!this.material) return;
    [
      this.material.uniforms.windowStart,
      this.material.uniforms.windowStartLow,
    ] = timeParts((start - this.epoch) / this.span);
    [this.material.uniforms.windowEnd, this.material.uniforms.windowEndLow] =
      timeParts((end - this.epoch) / this.span);
  }
  destroy() {
    if (!this.scene.isDestroyed()) for (const primitive of this.primitives) this.scene.primitives.remove(primitive);
    this.material?.destroy();
    this.primitives = [];
    this.uploads = [];
    this.material = undefined;
    this.instances = [];
  }
}
