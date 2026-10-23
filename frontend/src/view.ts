import { TOOLTIP_DELAY_MS } from "./tooltips";
import { GisLayers } from "./gis";
import {
  Viewer,
  Cartesian2,
  Cartesian3,
  Cartesian4,
  Cartographic,
  Color,
  CreditDisplay,
  SceneMode,
  GeographicProjection,
  PointPrimitiveCollection,
  BillboardCollection,
  LabelCollection,
  PolylineCollection,
  EllipsoidGeodesic,
  PrimitiveCollection,
  Primitive,
  GeometryInstance,
  PolygonGeometry,
  PolygonHierarchy,
  PerInstanceColorAppearance,
  ColorGeometryInstanceAttribute,
  Material,
  MaterialAppearance,
  Rectangle,
  Ellipsoid,
  EllipsoidalOccluder,
  HeadingPitchRange,
  Transforms,
  Matrix4,
  BoundingSphere,
  ScreenSpaceEventType,
  CameraEventType,
  LabelStyle,
  HorizontalOrigin,
  VerticalOrigin,
  ArcType,
  Math as CesiumMath,
  type PointPrimitive,
  type Billboard,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { CesiumResources } from "./cesium-resources";
import { DisplayLayer } from "./cesium-display-layer";
import {
  defaultDisplay,
  type DisplayOptions,
  type DisplayBin,
  type DisplayCell,
} from "./display-options";
import { trailEdges } from "./display-math";
import { timeAxisTicks, timeElevationFraction } from "./time-axis";
import { groundWindow, spaceTimePadding } from "./space-time-frame";
import { flatLineGeometry, flatLineVertexShader } from "./flat-lines";
import {
  geodesicPositions,
  projectedFrustumBounds,
  createArcBudget,
  lineIntersectsBox,
  polygonIntersectsBox,
} from "./cesium-geometry";
import {
  entityColor,
  time,
  type Point,
  type Terrain,
  type Raster,
  type Bounds,
  type GeometryFeature,
} from "./types";

/** Web Mercator utility retained for clients; the Cesium scene itself uses WGS84 geographic projection. */
export function mercator(lat: number, lon: number) {
  const limit = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return new Cartesian2(
    (6378137 * lon * Math.PI) / 180,
    6378137 * Math.log(Math.tan(Math.PI / 4 + (limit * Math.PI) / 360)),
  );
}
export interface CesiumCameraState {
  position: [number, number, number];
  direction: [number, number, number];
  up: [number, number, number];
  frustum_width?: number;
}
type PickId =
  | { kind: "event" | "geometry"; id: string }
  | { kind: "cluster"; bin: DisplayBin }
  | { kind: "orbit"; side: string }
  | { kind: "gis"; layer: string; id: string };
type Glyph = PointPrimitive | Billboard;
const safeColor = (name: string, theme: string) =>
  Color.fromCssColorString(entityColor(name, theme)) || Color.CYAN;
const finite = (v: number) => Number.isFinite(v);

/** One Cesium scene drives Globe, 2D and Columbus space-time. Rust remains the source of truth. */
export class SpaceTimeView {
  viewer!: Viewer;
  resources!: CesiumResources;
  private basemap: "streets" | "none" = "none";
  gis!: GisLayers;
  onGisPick: (layer: string, id: string) => void = () => {};
  onGisError: (id: string, message: string) => void = () => {};
  displayLayer!: DisplayLayer;
  display: DisplayOptions = { ...defaultDisplay };
  controls = new EventTarget();
  ready: Promise<void>;
  disposed = false;
  recovering = false;
  renderQueued = false;
  effectError = "";
  mode = "space-time";
  theme = "dark";
  timeHeight = 2.8;
  globeTime = false;
  globeTimeScale = 1;
  exaggeration = 1;
  bounds: Bounds = [-122.47, 37.75, -122.36, 37.82];
  private spaceTimeFloor: Bounds | null = null;
  lo = 0;
  hi = 1;
  points: Point[] = [];
  renderPoints: Point[] = [];
  trianglePoints: Point[] = [];
  names: string[] = [];
  geometryFeatures: GeometryFeature[] = [];
  geometryLimited = false;
  projectionOmitted = 0;
  renderLOD = false;
  trailsLimited = false;
  trailInputEdges = 0;
  trailOutputEdges = 0;
  terrain: Terrain | null = null;
  terrainGeneration = 0;
  generation = 0;
  selected = new Set<string>();
  mapCredits: string[] = [];
  playback = false;
  boxMode = false;
  box = document.createElement("div");
  tooltip = document.createElement("div");
  private hoverHintKey = "";
  private hoverHintTimer?: ReturnType<typeof setTimeout>;
  labels = { domElement: document.createElement("div") };
  markerRadius = 5;
  selectionRadius = 9;
  onPick: (ids: string[], add: boolean) => void = () => {};
  onCluster: (bin: DisplayBin) => void = () => {};
  onClusters: (cells: DisplayCell[], add: boolean, ids: string[]) => void =
    () => {};
  onSceneChange: () => void = () => {};
  onViewportChange: () => void = () => {};
  private glyphs!: PointPrimitiveCollection;
  private triangles!: BillboardCollection;
  private arrivingPoints!: PointPrimitiveCollection;
  private arrivingTriangles!: BillboardCollection;
  private selections!: PointPrimitiveCollection;
  private shapes!: PrimitiveCollection;
  private trails!: PolylineCollection;
  private stemsPrimitive?: Primitive;
  private stemSegments = 0;
  private axes!: PolylineCollection;
  private focusLines!: PolylineCollection;
  private axisLabels!: LabelCollection;
  private handles!: PointPrimitiveCollection;
  private glyphById = new Map<string, Glyph>();
  private pointById = new Map<string, Point>();
  private abort = new AbortController();
  private resizeObserver?: ResizeObserver;
  private focusFraction = 0.45;
  private pendingPick?: ReturnType<typeof setTimeout>;
  private pendingPickAction?: () => void;
  private clickSequence?: {
    at: number;
    x: number;
    y: number;
    selection: string[];
    applied: boolean;
  };
  private rightClick?: { at: number; x: number; y: number };
  private inputSuspended = false;
  private drag?: {
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    box: boolean;
    add: boolean;
    orbit: boolean;
    pointer: number;
    button: number;
    navigation?: "orbit" | "zoom";
    anchor: Cartesian2;
  };
  private triangleImage = "";
  private renderErrors = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private fadeFrame = 0;
  private incomingAt = new Map<string, number>();
  private glyphStarted = new WeakMap<Glyph, number>();
  private incoming: Glyph[] = [];
  private outgoing: {
    glyph: Glyph;
    alpha: number;
    started: number;
    id: string;
    triangle: boolean;
  }[] = [];
  private fadeTrails: {
    primitive: Primitive;
    material: Material;
    started: number;
    alpha: number;
    ids: Set<string>;
    segments: number;
  }[] = [];
  private fadingTriangles!: BillboardCollection;
  private fading!: PointPrimitiveCollection;
  private cameraDirty = false;
  private occluder?: EllipsoidalOccluder;
  private occluderCamera = new Cartesian3(Number.NaN, Number.NaN, Number.NaN);
  private geometrySelectionKey = "";
  private selectionRenderKey = "";
  private trailRenderKey = "";
  private trailViewMatrix?: number[];
  private renderStarted = 0;
  private lastRendered = 0;
  private renderedFrames = 0;
  private frameIntervals: number[] = [];
  private renderTimes: number[] = [];
  private geometryArcBudget = createArcBudget(0);
  private trailArcBudget = createArcBudget(0);
  private lastRaster?: Raster;
  private contextRecoveries = 0;
  private recoveryPromise?: Promise<void>;
  private automaticRenderRecovery = false;
  private lastRenderError = "";
  constructor(
    public host: HTMLElement,
    public backend: (s: string) => void,
  ) {
    this.ready = this.initialize();
  }
  get camera() {
    return this.viewer.camera;
  }
  get scene() {
    return this.viewer.scene;
  }
  get renderer() {
    return {
      domElement: this.viewer.canvas,
      backend: { isWebGPUBackend: false, isWebGLBackend: true },
    };
  }
  get timeHeightMeters() {
    const b = this.bounds;
    const width =
      Math.abs(b[2] - b[0]) *
      111319.4908 *
      Math.max(0.05, Math.cos(((b[1] + b[3]) * Math.PI) / 360));
    const height = Math.abs(b[3] - b[1]) * 111319.4908;
    const extent = Math.max(100, width, height);
    // Globe starts near the surface: 12% of the study extent, capped at 50 km.
    // Its independent multiplier is logarithmic in the UI. Time is display
    // elevation, never measured altitude or a change to source coordinates.
    if (this.mode === "globe")
      return Math.min(extent * 0.12, 50000) * this.globeTimeScale;
    return (extent * Math.max(0.01, this.timeHeight)) / 4;
  }
  async initialize() {
    // This app supplies its own imagery and terrain, without Cesium ion.
    // Remove only the engine's default logo; provider-required credits remain.
    CreditDisplay.cesiumCredit = undefined!;
    this.viewer = new Viewer(this.host, {
      creditContainer: document.getElementById("cesium-credits") || undefined,
      baseLayer: false,
      baseLayerPicker: false,
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      automaticallyTrackDataSourceClocks: false,
      sceneMode:
        this.mode === "globe"
          ? SceneMode.SCENE3D
          : this.mode === "map"
            ? SceneMode.SCENE2D
            : SceneMode.COLUMBUS_VIEW,
      scene3DOnly: false,
      mapProjection: new GeographicProjection(Ellipsoid.WGS84),
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      contextOptions: {
        // Capture renders and copies within one task; retaining the default
        // buffer between frames forces costly presentation copies in WebKit.
        webgl: { alpha: false, antialias: true, preserveDrawingBuffer: false },
      },
    });
    this.viewer.resolutionScale = Math.min(devicePixelRatio || 1, 1.5);
    const scene = this.viewer.scene;
    scene.backgroundColor = Color.fromCssColorString(
      this.theme === "light" ? "#e5e9ef" : "#0e1420",
    );
    scene.globe.baseColor = Color.fromCssColorString(
      this.theme === "light" ? "#c9d2df" : "#2f3c50",
    );
    scene.globe.enableLighting = false;
    scene.globe.depthTestAgainstTerrain = false;
    scene.globe.maximumScreenSpaceError = 2;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    scene.screenSpaceCameraController.minimumZoomDistance = 2;
    scene.screenSpaceCameraController.maximumZoomDistance = 8e7;
    // Keep native left-drag/pinch support. All orbit/zoom bindings below are
    // explicit; no free-look, automatic tilt, momentum or throw-to-keep-moving.
    const controller = scene.screenSpaceCameraController;
    // Cesium 1.146's input loop still applies a short decay at zero. Its
    // momentum branch is skipped at one; release tests verify an exact stop.
    controller.inertiaSpin =
      controller.inertiaTranslate =
      controller.inertiaZoom =
        1;
    controller.enableLook = false;
    controller.lookEventTypes = undefined;
    controller.zoomEventTypes = [CameraEventType.PINCH];
    controller.tiltEventTypes = undefined;
    controller.enableTilt = false;
    controller.enableRotate = this.mode !== "map";
    controller.maximumTiltAngle = CesiumMath.toRadians(85);
    this.resources = new CesiumResources(this.viewer, () =>
      this.requestRender(),
    );
    this.gis = new GisLayers(this.viewer);
    this.gis.onError = (id, message) => this.onGisError(id, message);
    this.resources.setMode(this.mode);
    scene.globe.show = true;
    this.glyphs = scene.primitives.add(new PointPrimitiveCollection());
    this.triangles = scene.primitives.add(new BillboardCollection());
    this.arrivingPoints = scene.primitives.add(new PointPrimitiveCollection());
    this.arrivingTriangles = scene.primitives.add(new BillboardCollection());
    this.fading = scene.primitives.add(new PointPrimitiveCollection());
    this.fadingTriangles = scene.primitives.add(new BillboardCollection());
    this.selections = scene.primitives.add(new PointPrimitiveCollection());
    this.shapes = scene.primitives.add(new PrimitiveCollection());
    this.trails = scene.primitives.add(new PolylineCollection());
    this.axes = scene.primitives.add(new PolylineCollection());
    this.focusLines = scene.primitives.add(new PolylineCollection());
    this.axisLabels = scene.primitives.add(new LabelCollection());
    this.handles = scene.primitives.add(new PointPrimitiveCollection());
    this.displayLayer = new DisplayLayer(this);
    this.triangleImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M12 2 23 22H1Z" fill="white" stroke="white" stroke-width="1"/></svg>')}`;
    this.labels.domElement.className = "scene-labels";
    this.labels.domElement.style.pointerEvents = "none";
    this.box.className = "selection-box";
    this.box.style.display = "none";
    this.tooltip.className = "scene-tooltip";
    this.hideTooltip();
    this.tooltip.style.pointerEvents = "none";
    this.host.append(this.labels.domElement, this.box, this.tooltip);
    this.bindCanvas();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.camera.percentageChanged = 0.01;
    this.camera.changed.addEventListener(() => {
      this.cameraDirty = true;
      this.controls.dispatchEvent(new Event("change"));
      this.displayLayer.cameraChanged();
      // Viewport loading is throttled separately and must follow a held drag.
      // Keep expensive scene bookkeeping on the trailing idle timer.
      this.onViewportChange();
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (!this.disposed) {
          this.rebuildTrails();
          this.updateAxes();
          this.onViewportChange();
          this.onSceneChange();
        }
      }, 160);
    });
    scene.preRender.addEventListener(() => {
      this.constrainCamera();
      if (this.updateSpaceTimeFloor()) this.updateAxes();
      this.renderStarted = performance.now();
    });
    scene.postRender.addEventListener(() => {
      const now = performance.now(),
        interval = now - this.lastRendered;
      // Idle gaps are intentional in request-render mode, not dropped frames.
      if (interval > 250) {
        this.frameIntervals = [];
        this.renderTimes = [];
      } else this.frameIntervals.push(interval);
      this.renderTimes.push(now - this.renderStarted);
      if (this.frameIntervals.length > 120) this.frameIntervals.shift();
      if (this.renderTimes.length > 120) this.renderTimes.shift();
      this.lastRendered = now;
      this.renderedFrames++;
      this.renderQueued = false;
      this.cameraDirty = false;
    });
    scene.renderError.addEventListener((_scene, error) => {
      console.error("Cesium render failure", error);
      this.effectError = String(error?.message || error);
      this.lastRenderError = String(error?.stack || error).slice(0, 8192);
      this.renderErrors++;
      this.viewer.useDefaultRenderLoop = false;
      this.backend("WebGL2 · rendering error; click to refresh map");
      // Recreate all Cesium resources once; retries of a broken primitive just
      // leave the default render loop stopped across every map mode.
      if (!this.automaticRenderRecovery && !this.recoveryPromise) {
        this.automaticRenderRecovery = true;
        void this.recoverRenderer(false);
      }
    });
    this.viewer.canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this.recovering = true;
        this.viewer.useDefaultRenderLoop = false;
        this.backend("WebGL2 · graphics context lost; waiting for restoration");
      },
      { signal: this.abort.signal },
    );
    this.viewer.canvas.addEventListener(
      "webglcontextrestored",
      () => {
        void this.recoverRenderer(false);
      },
      { signal: this.abort.signal },
    );
    // Chronoscope owns picking/table linkage; Cesium's default handler also
    // queries imagery with a 3D-only ray and throws in 2D/Columbus views.
    this.viewer.screenSpaceEventHandler.removeInputAction(
      ScreenSpaceEventType.LEFT_CLICK,
    );
    this.viewer.screenSpaceEventHandler.removeInputAction(
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
    this.backend("WebGL2");
    this.rebuild();
    this.fit();
  }
  /** A fresh renderer retains the workspace, selection, camera and map layers. */
  async recoverRenderer(manual = true) {
    if (this.disposed) return;
    if (this.recoveryPromise) return this.recoveryPromise;
    if (manual) this.automaticRenderRecovery = false;
    this.recovering = true;
    this.backend("WebGL2 · refreshing map renderer");
    this.recoveryPromise = Promise.resolve()
      .then(() => this.recoverGraphicsContext(manual))
      .finally(() => {
        this.recoveryPromise = undefined;
      });
    return this.recoveryPromise;
  }
  private async recoverGraphicsContext(manual = false) {
    if (this.disposed) return;
    if (!manual && this.contextRecoveries >= 1) {
      this.recovering = false;
      this.effectError =
        "Graphics recovery stopped after a repeated failure. Click the renderer indicator to refresh the map. Workspace data remains available.";
      this.backend("WebGL2 · repeated graphics failure; click to refresh map");
      return;
    }
    this.contextRecoveries++;
    const camera = this.captureCamera(),
      datum = this.resources.status.verticalDatum,
      packet = this.displayLayer.packet,
      gisLayers = this.gis.descriptors;
    try {
      this.stopFades();
      clearTimeout(this.idleTimer);
      this.resizeObserver?.disconnect();
      this.abort.abort();
      this.displayLayer.dispose();
      this.resources.dispose();
      this.gis.dispose();
      if (!this.viewer.isDestroyed()) this.viewer.destroy();
      this.abort = new AbortController();
      this.renderErrors = 0;
      this.renderQueued = false;
      this.selectionRenderKey = "";
      this.trailRenderKey = "";
      this.occluder = undefined;
      this.ready = this.initialize();
      await this.ready;
      if (this.disposed) return;
      await this.resources.setBasemap(this.basemap);
      await this.gis.sync(gisLayers);
      this.setTerrainDatum(datum);
      await this.resources.setTerrain(this.terrain, this.exaggeration);
      if (this.disposed) return;
      this.rebuild(true);
      this.restoreCamera(camera);
      if (this.lastRaster) await this.resources.setRasters(this.lastRaster);
      if (packet) await this.displayLayer.set(packet, this.display);
      this.recovering = false;
      this.effectError = "";
      this.backend("WebGL2 · graphics restored");
      this.requestRender();
    } catch (error) {
      console.error("Cesium graphics recovery failed", error);
      this.recovering = false;
      this.effectError = String(error);
      this.backend("WebGL2 · graphics recovery failed; click to refresh map");
    }
  }
  groundHeight(lat: number, lon: number) {
    return this.resources?.groundHeight(lat, lon) ?? 0;
  }
  position(
    lat: number,
    lon: number,
    epoch?: number,
    groundOnly = false,
  ): Cartesian3 {
    let height = this.groundHeight(lat, lon) + 2;
    if (
      !groundOnly &&
      this.mode !== "map" &&
      (this.mode !== "globe" || this.globeTime) &&
      epoch !== undefined
    )
      height +=
        timeElevationFraction(epoch, this.lo, this.hi) * this.timeHeightMeters;
    return Cartesian3.fromDegrees(lon, lat, height);
  }
  groundPosition(lat: number, lon: number) {
    return this.position(lat, lon, undefined, true);
  }
  pos(point: Point) {
    return this.position(point.lat, point.lon, point.time);
  }
  project(position: Cartesian3): Cartesian2 | undefined {
    if (!this.viewer || this.disposed) return undefined;
    if (this.mode === "globe") {
      if (
        !this.occluder ||
        !Cartesian3.equals(this.camera.positionWC, this.occluderCamera)
      ) {
        this.occluder = new EllipsoidalOccluder(
          Ellipsoid.WGS84,
          this.camera.positionWC,
        );
        Cartesian3.clone(this.camera.positionWC, this.occluderCamera);
      }
      if (!this.occluder.isPointVisible(position)) return undefined;
    }
    const p = this.scene.cartesianToCanvasCoordinates(position);
    return p && finite(p.x) && finite(p.y) ? p : undefined;
  }
  async setData(
    points: Point[],
    names: string[],
    bounds?: number[],
    timeBounds?: [number, number],
    geometries: GeometryFeature[] = [],
    accept = () => true,
    displayPacketWillFollow = false,
  ) {
    await this.ready;
    if (!accept() || this.disposed) return false;
    const same =
      points.length === this.points.length &&
      names.join("\0") === this.names.join("\0") &&
      (!bounds || bounds.every((v, i) => v === this.bounds[i])) &&
      (!timeBounds ||
        (timeBounds[0] === this.lo && timeBounds[1] === this.hi)) &&
      JSON.stringify(geometries) === JSON.stringify(this.geometryFeatures) &&
      points.every((p, i) => {
        const q = this.points[i];
        return (
          p.id === q.id &&
          p.lat === q.lat &&
          p.lon === q.lon &&
          p.time === q.time &&
          p.entity === q.entity &&
          p.value === q.value &&
          p.inferred === q.inferred &&
          p.centroid === q.centroid
        );
      });
    if (same) return false;
    const old = this.playback
      ? new Map(this.renderPoints.map((p) => [p.id, p]))
      : undefined;
    this.points = points;
    this.names = names;
    this.geometryFeatures = geometries;
    if (bounds) this.bounds = bounds.slice(0, 4) as Bounds;
    if (timeBounds) [this.lo, this.hi] = timeBounds;
    this.rebuild(true, old, !displayPacketWillFollow);
    return true;
  }
  setTheme(theme: string) {
    if (this.theme === theme) return;
    this.theme = theme;
    if (!this.viewer) return;
    this.scene.backgroundColor = Color.fromCssColorString(
      theme === "light" ? "#e5e9ef" : "#0e1420",
    );
    this.scene.globe.baseColor = Color.fromCssColorString(
      theme === "light" ? "#c9d2df" : "#2f3c50",
    );
    this.rebuild(true);
  }
  setGlobeTimeScale(scale: number) {
    if (this.globeTimeScale === scale) return;
    this.globeTimeScale = scale;
    if (this.mode === "globe" && this.globeTime) this.rebuild(true);
  }
  setGlobeTime(enabled: boolean) {
    if (this.globeTime === enabled) return;
    this.globeTime = enabled;
    if (this.mode === "globe") this.rebuild(true);
  }
  setMode(mode: string) {
    if (!this.viewer || this.disposed) {
      this.mode = mode;
      return;
    }
    if (this.mode === mode) return;
    this.cancelNavigation();
    this.cancelPendingPick();
    this.rightClick = undefined;
    this.mode = mode;
    this.scene.screenSpaceCameraController.enableRotate = mode !== "map";
    const desired =
      mode === "globe"
        ? SceneMode.SCENE3D
        : mode === "map"
          ? SceneMode.SCENE2D
          : SceneMode.COLUMBUS_VIEW;
    if (desired === SceneMode.SCENE3D) this.scene.morphTo3D(0);
    else if (desired === SceneMode.SCENE2D) this.scene.morphTo2D(0);
    else this.scene.morphToColumbusView(0);
    this.scene.completeMorph();
    this.resources.setMode(mode);
    this.scene.globe.show = true;
    this.stopFades();
    this.rebuild();
    this.fit();
    this.onSceneChange();
  }
  rebuild(
    _keepGeography = false,
    previous?: Map<string, Point>,
    refreshDisplay = true,
  ) {
    if (!this.viewer || this.disposed) return;
    this.generation++;
    // The study bounds remain data metadata. The space-time floor instead
    // follows the camera, so geographic zoom cannot shrink it to a tiny tile.
    this.scene.globe.cartographicLimitRectangle =
      this.mode === "space-time"
        ? Rectangle.fromDegrees(...(this.spaceTimeFloor || this.bounds))
        : Rectangle.clone(Rectangle.MAX_VALUE);
    // Keep departure timestamps across playback packets. A 200ms refresh must
    // not erase a two-second afterimage or restart its clock.
    if (!previous) this.stopFades();
    else {
      cancelAnimationFrame(this.fadeFrame);
      this.fadeFrame = 0;
      this.incoming = [];
    }
    const now = performance.now();
    // Resolve styles once per entity, rather than parsing CSS for every event.
    const colors = this.names.map((name, i) =>
      safeColor(name || String(i), this.theme),
    );
    const colorFor = (entity: number) =>
      colors[entity] || safeColor(String(entity), this.theme);
    const incomingIds = new Set(this.points.map((p) => p.id));
    for (const id of this.incomingAt.keys())
      if (!incomingIds.has(id)) this.incomingAt.delete(id);
    this.pruneFades(now, incomingIds);
    const departed: Point[] = [];
    if (previous)
      for (const p of previous.values())
        if (!incomingIds.has(p.id)) {
          departed.push(p);
          if (!this.display.show_points || !this.glyphById.get(p.id)?.show)
            continue;
          const color = colorFor(p.entity);
          const glyph: Glyph = p.inferred
            ? this.fadingTriangles.add({
                position: this.pos(p),
                image: this.triangleImage,
                color,
                width: 11 * this.display.point_scale,
                height: 11 * this.display.point_scale,
              })
            : this.fading.add({
                position: this.pos(p),
                color,
                pixelSize: 8 * this.display.point_scale,
                outlineColor:
                  this.theme === "light"
                    ? Color.WHITE
                    : Color.BLACK.withAlpha(0.8),
                outlineWidth: 1,
              });
          // No pick ID: afterimages never enter selection, queries or analysis.
          this.outgoing.push({
            glyph,
            alpha: color.alpha,
            started: now,
            id: p.id,
            triangle: !!p.inferred,
          });
        }
    this.addFadeTrails(departed, now);
    // Bound transient history separately from the current event packet.
    this.pruneFades(now);
    this.glyphs.removeAll();
    this.triangles.removeAll();
    this.arrivingPoints.removeAll();
    this.arrivingTriangles.removeAll();
    this.glyphById.clear();
    this.renderPoints = this.display.show_centroids
      ? this.points
      : this.points.filter((p) => !p.centroid);
    this.pointById = new Map(this.points.map((p) => [p.id, p]));
    this.trianglePoints = this.points.filter((p) => p.inferred);
    this.projectionOmitted = 0;
    for (const p of this.renderPoints) {
      const color = colorFor(p.entity);
      const id: PickId = { kind: "event", id: p.id };
      const show =
        this.display.show_points &&
        (p.inferred ||
          !this.displayLayer.replacesEvents ||
          this.selected.has(p.id));
      // Cesium individually uploads sparse per-point edits (<10% dirty). On
      // WebKit/Metal each tiny upload can copy/fence the buffer. Isolate arrivals
      // so fade updates affect an entire small batch instead of the static scene.
      if (previous && !previous.has(p.id)) this.incomingAt.set(p.id, now);
      const started = this.incomingAt.get(p.id);
      const arriving = started !== undefined && now - started < 550;
      let glyph: Glyph;
      if (p.inferred)
        glyph = (arriving ? this.arrivingTriangles : this.triangles).add({
          position: this.pos(p),
          id,
          image: this.triangleImage,
          color,
          width: 11 * this.display.point_scale,
          height: 11 * this.display.point_scale,
          show,
        });
      else
        glyph = (arriving ? this.arrivingPoints : this.glyphs).add({
          position: this.pos(p),
          id,
          color,
          pixelSize: 8 * this.display.point_scale,
          outlineColor:
            this.theme === "light" ? Color.WHITE : Color.BLACK.withAlpha(0.8),
          outlineWidth: 1,
          show,
        });
      this.glyphById.set(p.id, glyph);
      if (arriving) {
        const f = Math.min(1, (now - started!) / 550);
        glyph.color = color.withAlpha(f * f * (3 - 2 * f));
        this.glyphStarted.set(glyph, started!);
        this.incoming.push(glyph);
      }
    }
    this.buildGeometryFeatures();
    this.setSelection([...this.selected]);
    this.updateAxes();
    this.rebuildTrails();
    // Main refresh supplies the new packet immediately after setData. Avoid
    // starting a worker for the obsolete packet and then cancelling it.
    if (refreshDisplay && this.displayLayer.packet)
      void this.displayLayer.set(this.displayLayer.packet, this.display);
    if (
      previous &&
      (this.incoming.length || this.outgoing.length || this.fadeTrails.length)
    )
      this.advanceFades();
    this.requestRender();
  }
  buildGeometryFeatures() {
    this.shapes.removeAll();
    const segments = this.geometryFeatures.reduce(
      (total, feature) =>
        total +
        feature.shape.lines.reduce(
          (n, line) => n + Math.max(0, line.length - 1),
          0,
        ) +
        feature.shape.polygons.reduce(
          (n, polygon) =>
            n +
            polygon.reduce(
              (count, ring) => count + Math.max(0, ring.length - 1),
              0,
            ),
          0,
        ),
      0,
    );
    this.geometryArcBudget = createArcBudget(segments, 200000);
    const polygonInstances: GeometryInstance[] = [];
    const lines = this.shapes.add(new PolylineCollection());
    const vertices = this.shapes.add(new PointPrimitiveCollection());
    this.geometrySelectionKey = this.geometryFeatures
      .filter((f) => this.selected.has(f.id))
      .map((f) => f.id)
      .join("|");
    for (const feature of this.geometryFeatures) {
      const color = this.selected.has(feature.id)
          ? this.theme === "light"
            ? Color.fromCssColorString("#7c4b00")
            : Color.fromCssColorString("#ffd27a")
          : safeColor(feature.entity, this.theme),
        id: PickId = { kind: "geometry", id: feature.id };
      const position = ([lon, lat]: [number, number]) =>
        this.position(lat, lon, feature.time);
      for (const p of feature.shape.points)
        vertices.add({
          position: position(p),
          id,
          color,
          pixelSize: 7,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
        });
      for (const line of feature.shape.lines)
        if (line.length > 1)
          lines.add({
            positions:
              this.mode === "globe"
                ? geodesicPositions(
                    line.map(position),
                    200000,
                    this.geometryArcBudget,
                  )
                : line.map(position),
            id,
            width: 2,
            material: Material.fromType("Color", {
              color: color.withAlpha(0.9),
            }),
          });
      for (const polygon of feature.shape.polygons) {
        if (!polygon[0] || polygon[0].length < 3) continue;
        const hierarchy = new PolygonHierarchy(
          polygon[0].map(position),
          polygon
            .slice(1)
            .filter((r) => r.length >= 3)
            .map((r) => new PolygonHierarchy(r.map(position))),
        );
        polygonInstances.push(
          new GeometryInstance({
            geometry: new PolygonGeometry({
              polygonHierarchy: hierarchy,
              perPositionHeight: true,
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            id,
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(
                color.withAlpha(0.25),
              ),
            },
          }),
        );
        for (const ring of polygon)
          if (ring.length > 1)
            lines.add({
              positions:
                this.mode === "globe"
                  ? geodesicPositions(
                      ring.map(position),
                      200000,
                      this.geometryArcBudget,
                    )
                  : ring.map(position),
              id,
              width: 2,
              material: Material.fromType("Color", {
                color: color.withAlpha(0.9),
              }),
            });
      }
    }
    if (polygonInstances.length)
      this.shapes.add(
        new Primitive({
          geometryInstances: polygonInstances,
          appearance: new PerInstanceColorAppearance({
            flat: true,
            translucent: true,
            closed: false,
          }),
          asynchronous: false,
          releaseGeometryInstances: true,
        }),
      );
    if (this.geometryArcBudget.coarsened) this.geometryLimited = true;
  }
  setSelection(ids: string[]) {
    this.selected = new Set(ids);
    // Engine refreshes often publish the same selection. Preserve native GPU
    // resources unless their evidence, style or summary representation changed.
    const renderKey = JSON.stringify([
      this.generation,
      ids,
      this.display.show_points,
      this.display.point_scale,
      this.display.show_trails,
      this.display.trail_opacity,
      this.displayLayer.replacesEvents,
      this.theme,
    ]);
    if (renderKey === this.selectionRenderKey) return;
    this.selectionRenderKey = renderKey;
    const geometryKey = this.geometryFeatures
      .filter((f) => this.selected.has(f.id))
      .map((f) => f.id)
      .join("|");
    if (this.shapes && geometryKey !== this.geometrySelectionKey)
      this.buildGeometryFeatures();
    if (!this.selections) return;
    this.selections.removeAll();
    for (const [id, glyph] of this.glyphById) {
      glyph.show =
        this.display.show_points &&
        (this.pointById.get(id)?.inferred ||
          !this.displayLayer.replacesEvents ||
          this.selected.has(id));
      if (this.selected.has(id))
        this.selections.add({
          position: glyph.position,
          id: { kind: "event", id },
          // A one-pixel edge hugs the marker instead of a large halo.
          pixelSize:
            (this.pointById.get(id)?.inferred ? 11 : 8) *
              this.display.point_scale +
            2,
          color: Color.TRANSPARENT,
          outlineColor:
            this.theme === "light"
              ? Color.fromCssColorString("#7c4b00")
              : Color.fromCssColorString("#ffd27a"),
          outlineWidth: 1,
        });
    }
    this.rebuildStems();
    this.requestRender();
  }
  private rebuildStems() {
    if (this.stemsPrimitive) this.scene.primitives.remove(this.stemsPrimitive);
    this.stemsPrimitive = undefined;
    this.stemSegments = 0;
    if (
      (this.mode !== "space-time" &&
        !(this.mode === "globe" && this.globeTime)) ||
      !this.display.show_trails ||
      this.display.trail_opacity <= 0
    )
      return;
    const positions: number[] = [];
    for (const p of this.renderPoints) {
      if (p.inferred) continue;
      const ground = this.groundPosition(p.lat, p.lon),
        event = this.pos(p);
      positions.push(ground.x, ground.y, ground.z, event.x, event.y, event.z);
    }
    if (!positions.length) return;
    const values = new Float64Array(positions);
    const geometry = flatLineGeometry(values);
    const color = (
      this.theme === "light"
        ? Color.fromCssColorString("#627b8f")
        : Color.fromCssColorString("#97b7c7")
    ).withAlpha(
      (this.theme === "light" ? 0.4 : 0.15) * this.display.trail_opacity,
    );
    this.stemsPrimitive = this.scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({
          geometry,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
        appearance: new PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        asynchronous: false,
        allowPicking: false,
      }),
    );
    this.stemSegments = positions.length / 6;
  }
  setFocus(fraction: number) {
    this.focusFraction = Math.max(0, Math.min(1, fraction));
    this.gis?.setTime(this.lo + (this.hi - this.lo) * this.focusFraction);
    if (!this.focusLines) return;
    if (this.mode === "space-time") {
      const b = this.sceneBounds(),
        t = this.lo + (this.hi - this.lo) * this.focusFraction;
      const positions = [
        [b[0], b[3]],
        [b[0] + (b[2] - b[0]) * 0.025, b[3]],
      ];
      const projected = positions.map(([lon, lat]) =>
        this.position(lat, lon, t),
      );
      const color = (
        this.theme === "light"
          ? Color.fromCssColorString("#7c4b00")
          : Color.fromCssColorString("#ffd27a")
      ).withAlpha(0.8);
      // Playback moves one existing line; recreating its material every frame
      // causes unnecessary collection and shader bookkeeping.
      if (this.focusLines.length) {
        const line = this.focusLines.get(0);
        line.positions = projected;
        line.material.uniforms.color = color;
      } else
        this.focusLines.add({
          positions: projected,
          width: 2,
          material: Material.fromType("Color", { color }),
        });
    } else this.focusLines.removeAll();
    this.requestRender();
  }
  async setTerrain(data: Terrain | null, accept = () => true) {
    await this.ready;
    if (!accept() || this.disposed) return false;
    await this.resources.setTerrain(data, this.exaggeration, accept);
    if (!accept() || this.disposed) return false;
    this.terrain = data;
    this.terrainGeneration++;
    this.rebuild(true);
    return true;
  }
  clearRasters() {
    this.lastRaster = undefined;
    this.resources?.clearRasters();
    this.requestRender();
  }
  async setBasemap(mode: "streets" | "none") {
    this.basemap = mode;
    await this.ready;
    await this.resources.setBasemap(mode);
  }
  async setRasters(data: Raster, accept = () => true) {
    await this.ready;
    if (!accept() || this.disposed) return false;
    const installed = await this.resources.setRasters(data, accept);
    if (installed && accept()) this.lastRaster = data;
    return installed;
  }
  setPlayback(active: boolean) {
    this.playback =
      active && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.displayLayer.setPlayback(this.playback);
    if (!this.playback) {
      const consolidate =
        this.arrivingPoints?.length || this.arrivingTriangles?.length;
      this.stopFades();
      // Return opaque glyphs to canonical packet order when playback/scrubbing
      // stops, including depth ties between coincident records in map/globe.
      if (consolidate) this.rebuild(true);
    }
  }
  showCredits() {
    // Activate Cesium’s existing attribution control without a second overlay.
    document
      .querySelector<HTMLElement>("#cesium-credits .cesium-credit-expand-link")
      ?.click();
  }
  private addFadeTrails(points: Point[], started: number) {
    if (
      !this.display.show_trails ||
      this.display.trail_opacity <= 0 ||
      (this.mode !== "space-time" && !(this.mode === "globe" && this.globeTime))
    )
      return;
    const positions: number[] = [],
      ids = new Set<string>();
    for (const p of points) {
      if (p.inferred) continue;
      const ground = this.groundPosition(p.lat, p.lon),
        event = this.pos(p);
      positions.push(ground.x, ground.y, ground.z, event.x, event.y, event.z);
      ids.add(p.id);
    }
    if (!positions.length) return;
    const values = new Float64Array(positions);
    const color = (
      this.theme === "light"
        ? Color.fromCssColorString("#627b8f")
        : Color.fromCssColorString("#97b7c7")
    ).withAlpha(
      (this.theme === "light" ? 0.4 : 0.15) * this.display.trail_opacity,
    );
    const material = Material.fromType("Color", { color });
    const primitive = this.scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: flatLineGeometry(values),
        }),
        appearance: new MaterialAppearance({
          material,
          flat: true,
          translucent: true,
          materialSupport: MaterialAppearance.MaterialSupport.BASIC,
          vertexShaderSource: flatLineVertexShader,
        }),
        asynchronous: false,
        allowPicking: false,
      }),
    );
    // One uniform per departure packet, rather than rebuilding line geometry
    // or updating every stem on every animation frame.
    this.fadeTrails.push({
      primitive,
      material,
      started,
      alpha: color.alpha,
      ids,
      segments: positions.length / 6,
    });
  }
  private pruneFades(now: number, current?: Set<string>) {
    const excess = Math.max(0, this.outgoing.length - 100000);
    this.outgoing = this.outgoing.filter((entry, index) => {
      if (
        index >= excess &&
        now - entry.started < 2400 &&
        !current?.has(entry.id)
      )
        return true;
      if (entry.triangle) this.fadingTriangles.remove(entry.glyph as Billboard);
      else this.fading.remove(entry.glyph as PointPrimitive);
      return false;
    });
    let segments = this.fadeTrails.reduce(
      (n, cohort) => n + cohort.segments,
      0,
    );
    this.fadeTrails = this.fadeTrails.filter((cohort) => {
      const reentered =
        current && [...cohort.ids].some((id) => current.has(id));
      if (now - cohort.started < 2400 && !reentered && segments <= 100000)
        return true;
      segments -= cohort.segments;
      this.scene.primitives.remove(cohort.primitive);
      return false;
    });
  }
  private advanceFades() {
    if (this.fadeFrame) return;
    const frame = (now: number) => {
      this.fadeFrame = 0;
      if (this.disposed) return;
      let active = false;
      for (const glyph of this.incoming) {
        const f = Math.min(1, (now - this.glyphStarted.get(glyph)!) / 550);
        const c = Color.clone(glyph.color);
        c.alpha = f * f * (3 - 2 * f);
        glyph.color = c;
        active ||= f < 1;
      }
      this.pruneFades(now);
      for (const { glyph, alpha, started } of this.outgoing) {
        const f = Math.min(1, (now - started) / 2400);
        const c = Color.clone(glyph.color);
        c.alpha = alpha * (1 - f * f * (3 - 2 * f));
        glyph.color = c;
        if ("outlineColor" in glyph) {
          const outline = Color.clone((glyph as PointPrimitive).outlineColor);
          outline.alpha =
            (this.theme === "light" ? 1 : 0.8) * (1 - f * f * (3 - 2 * f));
          (glyph as PointPrimitive).outlineColor = outline;
        }
      }
      for (const cohort of this.fadeTrails) {
        const f = Math.min(1, (now - cohort.started) / 2400);
        cohort.material.uniforms.color.alpha =
          cohort.alpha * (1 - f * f * (3 - 2 * f));
      }
      this.requestRender();
      if (active || this.outgoing.length || this.fadeTrails.length)
        this.fadeFrame = requestAnimationFrame(frame);
      else {
        this.incoming = [];
        this.incomingAt.clear();
      }
    };
    this.fadeFrame = requestAnimationFrame(frame);
  }
  private stopFades() {
    cancelAnimationFrame(this.fadeFrame);
    this.fadeFrame = 0;
    for (const glyph of this.incoming) {
      const c = Color.clone(glyph.color);
      c.alpha = 1;
      glyph.color = c;
    }
    this.incoming = [];
    this.incomingAt.clear();
    this.outgoing = [];
    this.fading?.removeAll();
    this.fadingTriangles?.removeAll();
    for (const cohort of this.fadeTrails)
      this.scene.primitives.remove(cohort.primitive);
    this.fadeTrails = [];
  }
  private sceneBounds(): Bounds {
    return this.mode === "space-time"
      ? this.spaceTimeFloor || this.bounds
      : this.bounds;
  }
  private updateSpaceTimeFloor() {
    if (
      this.mode !== "space-time" ||
      this.scene.mode !== SceneMode.COLUMBUS_VIEW
    ) {
      this.spaceTimeFloor = null;
      return false;
    }
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    const ray = this.camera.getPickRay(new Cartesian2(width / 2, height / 2));
    const level = this.centerGroundHeight();
    if (!ray || Math.abs(ray.direction.x) < 1e-12) return false;
    const distance = (level - ray.origin.x) / ray.direction.x;
    if (distance <= 0) return false;
    const focus = new Cartesian3(
      level,
      ray.origin.y + ray.direction.y * distance,
      ray.origin.z + ray.direction.z * distance,
    );
    // Size the floor in a fixed north-facing, 48-degree reference view. Using
    // the live view refits its aspect and extent on every orbit frame, making
    // the map and grab handles breathe. Only focus, range and viewport size
    // affect this reference; rotation leaves the geographic rectangle intact.
    const tilt = CesiumMath.toRadians(48);
    const direction = new Cartesian3(-Math.cos(tilt), 0, Math.sin(tilt));
    const right = new Cartesian3(0, 1, 0);
    const up = Cartesian3.cross(right, direction, new Cartesian3());
    const position = Cartesian3.subtract(
      focus,
      Cartesian3.multiplyByScalar(
        direction,
        Cartesian3.distance(this.camera.positionWC, focus),
        new Cartesian3(),
      ),
      new Cartesian3(),
    );
    const view = Matrix4.computeView(
      position,
      direction,
      up,
      right,
      new Matrix4(),
    );
    const projection = this.scene.mapProjection;
    const sw = projection.project(Cartographic.fromDegrees(-180, -90));
    const ne = projection.project(Cartographic.fromDegrees(180, 90));
    const matrix = Matrix4.multiply(
      this.camera.frustum.projectionMatrix,
      view,
      new Matrix4(),
    );
    const padding = spaceTimePadding(width, height);
    // Build the reference ray directly. Inverting the full clip matrix here
    // amplifies near/far-plane roundoff and can rebuild axes while stationary.
    const projectionMatrix = this.camera.frustum.projectionMatrix;
    const x =
      ((padding.left - padding.right) / width + projectionMatrix[8]) /
      projectionMatrix[0];
    const y =
      ((padding.bottom - padding.top) / height + projectionMatrix[9]) /
      projectionMatrix[5];
    const insetDirection = Cartesian3.add(
      direction,
      Cartesian3.add(
        Cartesian3.multiplyByScalar(right, x, new Cartesian3()),
        Cartesian3.multiplyByScalar(up, y, new Cartesian3()),
        new Cartesian3(),
      ),
      new Cartesian3(),
    );
    const t = (level - position.x) / insetDirection.x;
    const center: [number, number] = [
      position.y + insetDirection.y * t,
      position.z + insetDirection.z * t,
    ];
    const floor = groundWindow(
      Matrix4.toArray(matrix),
      center,
      level,
      [width, height],
      [sw.x, sw.y, ne.x, ne.y],
    );
    if (!floor) return false;
    const low = projection.unproject(new Cartesian3(floor[0], floor[1], 0));
    const high = projection.unproject(new Cartesian3(floor[2], floor[3], 0));
    const next: Bounds = [
      CesiumMath.toDegrees(low.longitude),
      CesiumMath.toDegrees(low.latitude),
      CesiumMath.toDegrees(high.longitude),
      CesiumMath.toDegrees(high.latitude),
    ];
    if (this.spaceTimeFloor?.every((v, i) => Math.abs(v - next[i]) < 1e-10))
      return false;
    this.spaceTimeFloor = next;
    this.scene.globe.cartographicLimitRectangle = Rectangle.fromDegrees(
      ...next,
    );
    return true;
  }
  private updateAxes() {
    if (!this.axes) return;
    this.axes.removeAll();
    this.axisLabels.removeAll();
    this.handles.removeAll();
    if (this.mode !== "space-time") {
      this.setFocus(this.focusFraction);
      return;
    }
    const b = this.sceneBounds(),
      [w, s, e, n] = b;
    const color =
      this.theme === "light"
        ? Color.fromCssColorString("#3a5264").withAlpha(0.38)
        : Color.fromCssColorString("#acc8db").withAlpha(0.28);
    const line = (positions: Cartesian3[], width = 1) =>
      this.axes.add({
        positions,
        width,
        material: Material.fromType("Color", { color }),
      });
    // One geographic origin and time axis, without enclosing walls or roof.
    line([this.position(n, w, this.lo), this.position(n, w, this.hi)]);
    line([
      this.position(s, w, this.hi),
      this.position(n, w, this.hi),
      this.position(n, e, this.hi),
    ]);
    const projection = Matrix4.multiply(
      this.camera.frustum.projectionMatrix,
      this.camera.viewMatrix,
      new Matrix4(),
    );
    const clip = (epoch: number): [number, number, number, number] => {
      const p = this.cameraWorldPosition(this.position(n, w, epoch));
      const q = Matrix4.multiplyByVector(
        projection,
        new Cartesian4(p.x, p.y, p.z, 1),
        new Cartesian4(),
      );
      return [q.x, q.y, q.z, q.w];
    };
    const ticks = timeAxisTicks(
      this.lo,
      this.hi,
      clip(this.lo),
      clip(this.hi),
      this.host.clientWidth,
      this.host.clientHeight,
    );
    const visibleTicks =
      ticks.length > 4
        ? Array.from(
            { length: 4 },
            (_, i) => ticks[Math.round((i * (ticks.length - 1)) / 3)],
          )
        : ticks;
    for (const tick of visibleTicks) {
      this.label(tick.text, this.position(n, w, tick.time), "time-label");
      line([
        this.position(n, w, tick.time),
        this.position(n, w + (e - w) * 0.015, tick.time),
      ]);
    }
    const titlePosition = this.position(n, w, this.lo);
    const titlePixel = this.project(titlePosition);
    this.label(
      "TIME / UTC",
      titlePosition,
      "axis-title",
      new Cartesian2(-10, titlePixel ? Math.max(-28, 16 - titlePixel.y) : -28),
    );
    {
      const dx = Math.max(0.000001, Math.min(20, (e - w) * 0.03)),
        dy = Math.max(0.000001, Math.min(15, (n - s) * 0.03));
      for (const [side, lon, lat] of [
        ["north", (w + e) / 2, Math.min(89.5, n + dy)],
        ["south", (w + e) / 2, Math.max(-89.5, s - dy)],
        ["west", Math.max(-179.9, w - dx), (s + n) / 2],
        ["east", Math.min(179.9, e + dx), (s + n) / 2],
      ] as [string, number, number][]) {
        const p = this.groundPosition(lat, lon);
        this.handles.add({
          position: p,
          id: { kind: "orbit", side },
          pixelSize: 13,
          color: Color.fromCssColorString(
            this.theme === "light" ? "#6889a2" : "#b9d9ee",
          ).withAlpha(0.8),
          outlineColor: Color.WHITE,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
    this.setFocus(this.focusFraction);
  }
  label(
    text: string,
    position: Cartesian3,
    kind = "axis-label",
    offset = new Cartesian2(-10, 0),
  ) {
    return this.axisLabels.add({
      text,
      position,
      font: kind === "axis-title" ? "bold 12px system-ui" : "11px system-ui",
      fillColor:
        this.theme === "light"
          ? Color.fromCssColorString("#203545")
          : Color.fromCssColorString("#e4effa"),
      outlineColor:
        this.theme === "light"
          ? Color.WHITE.withAlpha(0.9)
          : Color.BLACK.withAlpha(0.9),
      outlineWidth: 0,
      style: LabelStyle.FILL,
      showBackground: true,
      backgroundColor:
        this.theme === "light"
          ? Color.fromCssColorString("#f8fbfd").withAlpha(0.95)
          : Color.fromCssColorString("#13212d").withAlpha(0.92),
      backgroundPadding: new Cartesian2(5, 3),
      horizontalOrigin: HorizontalOrigin.RIGHT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: offset,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }
  rebuildTrails() {
    if (!this.trails || this.disposed) return;
    // Simplification depends on the actual camera, viewport, selected anchors
    // and data generation. A repeated refresh with identical inputs is a no-op.
    const key = JSON.stringify([
      this.generation,
      Matrix4.toArray(this.camera.frustum.projectionMatrix),
      this.host.clientWidth,
      this.host.clientHeight,
      [...this.selected],
      this.display.show_tracks,
      this.display.show_trails,
      this.display.track_opacity,
      this.display.trail_opacity,
      this.display.trail_pixels,
      this.display.trail_gap_minutes,
      this.theme,
    ]);
    const matrix = Matrix4.toArray(this.camera.viewMatrix);
    // Cesium renormalizes a stationary camera, introducing ~1e-14 rotation and
    // sub-micrometer translation drift. Compare against the last built pose so
    // these roundoff changes do not reproject 100k records on every refresh.
    // Real movement accumulates against that pose; clipping projection stays exact.
    const sameCamera = this.trailViewMatrix?.every(
      (value, i) =>
        Math.abs(value - matrix[i]) <= (i >= 12 && i <= 14 ? 1e-5 : 1e-12),
    );
    if (key === this.trailRenderKey && sameCamera) return;
    this.trailRenderKey = key;
    this.trailViewMatrix = matrix;
    this.trails.removeAll();
    this.trailInputEdges = 0;
    this.trailOutputEdges = 0;
    this.trailArcBudget = createArcBudget(0);
    this.trailsLimited = false;
    if (!this.display.show_tracks && !this.display.show_trails) return;
    const sorted = [...this.renderPoints].sort(
      (a, b) =>
        a.entity - b.entity || a.time - b.time || a.id.localeCompare(b.id),
    );
    if (sorted.length > 100000) {
      sorted.length = 100000;
      this.trailsLimited = true;
    }
    this.trailInputEdges = Math.max(
      0,
      sorted.length - new Set(sorted.map((p) => p.entity)).size,
    );
    const edges = trailEdges(
      sorted,
      (i) => {
        const p = this.project(this.pos(sorted[i]));
        return p ? [p.x, p.y, 0] : [0, 0, 2];
      },
      this.selected,
      this.display.trail_pixels,
      this.display.trail_gap_minutes,
    );
    this.trailOutputEdges = edges.length;
    // One polyline per contiguous entity chain, rather than one draw object per edge.
    const runs: { entity: number; points: Point[] }[] = [];
    let last = -1;
    for (const [a, b] of edges) {
      if (runs.length && last === a)
        runs[runs.length - 1].points.push(sorted[b]);
      else
        runs.push({ entity: sorted[a].entity, points: [sorted[a], sorted[b]] });
      last = b;
    }
    const streams =
      Number(this.display.show_tracks && this.display.track_opacity > 0) +
      Number(this.display.show_trails && this.display.trail_opacity > 0);
    this.trailArcBudget = createArcBudget(
      runs.reduce(
        (n, run) => n + Math.max(0, run.points.length - 1) * streams,
        0,
      ),
      200000,
    );
    for (const run of runs) {
      const color = safeColor(
        this.names[run.entity] || String(run.entity),
        this.theme,
      );
      if (this.display.show_tracks && this.display.track_opacity > 0)
        this.trails.add({
          positions:
            this.mode === "globe"
              ? geodesicPositions(
                  run.points.map((p) => this.pos(p)),
                  200000,
                  this.trailArcBudget,
                )
              : run.points.map((p) => this.pos(p)),
          width: 1.6,
          material: Material.fromType("Color", {
            color: color.withAlpha(0.78 * this.display.track_opacity),
          }),
        });
      if (this.display.show_trails && this.display.trail_opacity > 0)
        this.trails.add({
          positions:
            this.mode === "globe"
              ? geodesicPositions(
                  run.points.map((p) => this.groundPosition(p.lat, p.lon)),
                  200000,
                  this.trailArcBudget,
                )
              : run.points.map((p) => this.groundPosition(p.lat, p.lon)),
          width: 2,
          material: Material.fromType("Color", {
            color: color.withAlpha(0.55 * this.display.trail_opacity),
          }),
        });
    }
    if (this.trailArcBudget.coarsened) this.trailsLimited = true;
    this.requestRender();
  }
  setDisplayOptions(options: DisplayOptions) {
    const previous = this.display;
    if (
      Object.keys(options).every(
        (key) =>
          options[key as keyof DisplayOptions] ===
          previous[key as keyof DisplayOptions],
      )
    )
      return;
    this.display = { ...options };
    if (!this.viewer) return;
    this.stopFades();
    if (
      previous.point_scale !== options.point_scale ||
      previous.show_points !== options.show_points ||
      previous.show_centroids !== options.show_centroids
    )
      this.rebuild(true);
    else {
      if (
        previous.show_tracks !== options.show_tracks ||
        previous.show_trails !== options.show_trails ||
        previous.track_opacity !== options.track_opacity ||
        previous.trail_opacity !== options.trail_opacity ||
        previous.trail_pixels !== options.trail_pixels ||
        previous.trail_gap_minutes !== options.trail_gap_minutes
      )
        this.rebuildTrails();
      if (this.displayLayer.packet)
        void this.displayLayer.set(this.displayLayer.packet, options);
    }
    this.setSelection([...this.selected]);
    this.requestRender();
  }
  private groundAt(pixel: Cartesian2) {
    const ray = this.camera.getPickRay(pixel);
    return (
      (ray && this.scene.globe.pick(ray, this.scene)) ||
      this.camera.pickEllipsoid(pixel, Ellipsoid.WGS84)
    );
  }
  private centerGround() {
    const pixel = new Cartesian2(
      this.host.clientWidth / 2,
      this.host.clientHeight / 2,
    );
    return (
      // Without terrain, use the exact WGS84 surface rather than a coarse
      // rendered globe triangle. Its tiny normal error destabilizes headings
      // when looking straight down, especially near the poles.
      (this.mode === "globe" && !this.terrain
        ? this.camera.pickEllipsoid(pixel, Ellipsoid.WGS84)
        : this.groundAt(pixel)) ||
      Cartesian3.fromDegrees(
        (this.bounds[0] + this.bounds[2]) / 2,
        (this.bounds[1] + this.bounds[3]) / 2,
      )
    );
  }
  private moveWorld(delta: Cartesian3) {
    Cartesian3.add(
      this.camera.position,
      this.camera.worldToCameraCoordinatesVector(delta, new Cartesian3()),
      this.camera.position,
    );
  }
  private constrainCamera() {
    if (!this.resources || this.scene.mode === SceneMode.MORPHING) return;
    if (this.mode === "map") return;
    if (this.mode === "globe") {
      const p = Cartographic.fromCartesian(this.camera.positionWC);
      if (!p) return;
      const floor =
        this.groundHeight(
          CesiumMath.toDegrees(p.latitude),
          CesiumMath.toDegrees(p.longitude),
        ) + 2;
      const height = Math.max(floor, Math.min(8e7, p.height));
      if (height !== p.height) {
        const target = Cartesian3.fromRadians(p.longitude, p.latitude, height);
        this.moveWorld(
          Cartesian3.subtract(target, this.camera.positionWC, new Cartesian3()),
        );
      }
    } else {
      const height = this.camera.positionWC.x;
      const floor = Math.max(2, this.centerGroundHeight() + 2);
      const clamped = Math.max(floor, Math.min(8e7, height));
      if (clamped !== height)
        this.moveWorld(new Cartesian3(clamped - height, 0, 0));
    }
  }
  private centerGroundHeight() {
    return this.groundHeight(
      (this.bounds[1] + this.bounds[3]) / 2,
      (this.bounds[0] + this.bounds[2]) / 2,
    );
  }
  /** Cesium's CV/2D world axes are (height,easting,northing), not ECEF. */
  private cameraWorldPosition(ecef: Cartesian3) {
    if (this.scene.mode === SceneMode.SCENE3D) return ecef;
    const projected = this.scene.mapProjection.project(
      Cartographic.fromCartesian(ecef),
    );
    return new Cartesian3(projected.z, projected.x, projected.y);
  }
  bearing() {
    const degrees =
      this.mode === "globe"
        ? this.globeOrientation().heading
        : this.mode === "map"
          ? 0
          : CesiumMath.toDegrees(this.camera.heading);
    const wrapped = ((degrees % 360) + 360) % 360;
    return Math.min(wrapped, 360 - wrapped) < 1e-8 ? 0 : wrapped;
  }
  tilt() {
    if (this.mode === "globe") return this.globeOrientation().tilt;
    return this.mode === "map"
      ? 0
      : Math.max(
          0,
          Math.min(89.5, 90 + CesiumMath.toDegrees(this.camera.pitch)),
        );
  }
  private globeOrientation() {
    // Orbit controls describe orientation at the ground focus, matching lookAt.
    // Cesium camera.heading/pitch instead use the frame under the camera, which
    // drifts away from that focus at orbital distances and oblique angles.
    const inverse = Matrix4.inverseTransformation(
      Transforms.eastNorthUpToFixedFrame(this.centerGround()),
      new Matrix4(),
    );
    const direction = Matrix4.multiplyByPointAsVector(
      inverse,
      this.camera.directionWC,
      new Cartesian3(),
    );
    const up = Matrix4.multiplyByPointAsVector(
      inverse,
      this.camera.upWC,
      new Cartesian3(),
    );
    const horizontal = Math.hypot(direction.x, direction.y);
    const heading = CesiumMath.toDegrees(
      horizontal < 1e-4
        ? Math.atan2(up.x, up.y)
        : Math.atan2(direction.x, direction.y),
    );
    return {
      heading: ((heading % 360) + 360) % 360,
      tilt: Math.max(
        0,
        Math.min(
          89.5,
          CesiumMath.toDegrees(Math.atan2(horizontal, -direction.z)),
        ),
      ),
    };
  }
  private orient(heading: number, tilt: number) {
    if (this.mode === "map") return;
    const target = this.centerGround(),
      range = Cartesian3.distance(
        this.camera.positionWC,
        this.cameraWorldPosition(target),
      );
    this.camera.lookAt(
      target,
      new HeadingPitchRange(
        CesiumMath.toRadians(heading),
        CesiumMath.toRadians(Math.max(0, Math.min(85, tilt)) - 90),
        range,
      ),
    );
    this.preserveNadirHeading(heading, tilt);
    this.camera.lookAtTransform(Matrix4.IDENTITY);
    this.requestRender();
    this.controls.dispatchEvent(new Event("change"));
    this.onSceneChange();
  }
  setBearing(degrees: number) {
    this.orient(degrees, this.tilt());
  }
  setTilt(degrees: number) {
    this.orient(this.bearing(), degrees);
  }
  /** Grab navigation: the displayed surface follows the pointer. No inertia. */
  orbitPixels(dx: number, dy: number) {
    this.orient(this.bearing() - dx * 0.7, this.tilt() - dy * 0.55);
  }
  private preserveNadirHeading(heading: number, tilt: number) {
    if (Math.max(0, tilt) > 0.001) return;
    // Cesium lookAt uses a fixed east vector when looking straight down,
    // discarding heading at that singularity. Keep the requested ENU heading
    // before leaving the target's local reference frame.
    const h = CesiumMath.toRadians(heading);
    Cartesian3.fromElements(Math.cos(h), -Math.sin(h), 0, this.camera.right);
    Cartesian3.cross(this.camera.right, this.camera.direction, this.camera.up);
    Cartesian3.normalize(this.camera.up, this.camera.up);
  }
  /** Move displayed geography in screen directions: +x right, +y down. */
  panPixels(x: number, y: number) {
    if (this.mode === "globe") {
      const angle = Math.min(
        0.2,
        Math.max(0.000001, this.camera.positionCartographic.height / 6378137),
      );
      // Cesium's rotateLeft/Up follow the constrained geographic axis, which
      // swaps or reverses screen directions when the globe heading changes.
      if (x)
        this.camera.rotate(
          this.camera.up,
          (x / Math.max(1, this.host.clientWidth)) * angle,
        );
      if (y)
        this.camera.rotate(
          this.camera.right,
          (y / Math.max(1, this.host.clientHeight)) * angle,
        );
    } else {
      const f = this.camera.frustum as { right?: number; left?: number };
      const metres =
        this.mode === "map" && f.right !== undefined && f.left !== undefined
          ? (f.right - f.left) / Math.max(1, this.host.clientWidth)
          : Math.max(2, this.camera.positionCartographic.height) /
            Math.max(1, this.host.clientHeight);
      this.camera.moveRight(-x * metres);
      this.camera.moveUp(y * metres);
    }
    this.constrainCamera();
    this.requestRender();
    this.onSceneChange();
  }
  private changeAltitude(direction: number) {
    if (this.mode === "map") return;
    const amount =
      Math.max(10, Math.abs(this.camera.positionCartographic.height) * 0.08) *
      direction;
    const normal =
      this.mode === "globe"
        ? Ellipsoid.WGS84.geodeticSurfaceNormal(
            this.camera.positionWC,
            new Cartesian3(),
          )
        : Cartesian3.UNIT_X;
    this.moveWorld(
      Cartesian3.multiplyByScalar(normal, amount, new Cartesian3()),
    );
    this.constrainCamera();
    this.requestRender();
    this.onSceneChange();
  }
  /** Map keyboard shortcuts never consume keys belonging to another UI surface. */
  navigationKey(event: KeyboardEvent) {
    const target = event.target;
    if (
      !(target instanceof Node) ||
      !this.host.contains(target) ||
      event.ctrlKey ||
      event.metaKey ||
      (target instanceof Element &&
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="slider"]',
        ))
    )
      return false;
    const key = event.key.toLowerCase(),
      step = event.altKey ? 0.25 : 1;
    if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
      if (event.shiftKey) {
        if (this.mode !== "map") {
          if (key === "arrowleft" || key === "arrowright")
            this.setBearing(
              this.bearing() + (key === "arrowleft" ? -10 : 10) * step,
            );
          else this.setTilt(this.tilt() + (key === "arrowup" ? -5 : 5) * step);
        }
      } else
        this.panPixels(
          (key === "arrowleft" ? -60 : key === "arrowright" ? 60 : 0) * step,
          (key === "arrowup" ? -60 : key === "arrowdown" ? 60 : 0) * step,
        );
    } else if (key === "pageup" || key === "pagedown") {
      if (event.shiftKey)
        this.changeAltitude((key === "pageup" ? 1 : -1) * step);
      else this.zoom(Math.exp((key === "pageup" ? 0.25 : -0.25) * step));
    } else if (["+", "=", "-"].includes(key))
      this.zoom(Math.exp((key === "-" ? -0.25 : 0.25) * step));
    else if (!event.altKey && key === "n") this.setBearing(0);
    else if (!event.altKey && key === "u") this.setTilt(0);
    else if (!event.altKey && (key === "r" || key === "f")) this.fit();
    else return false;
    event.preventDefault();
    return true;
  }
  cancelNavigation() {
    this.cancelPendingPick();
    this.camera?.cancelFlight();
    if (!this.drag) return false;
    const drag = this.drag;
    this.drag = undefined;
    this.box.style.display = "none";
    this.inputSuspended = true;
    this.scene.screenSpaceCameraController.enableInputs = false;
    if (this.viewer.canvas.hasPointerCapture(drag.pointer))
      this.viewer.canvas.releasePointerCapture(drag.pointer);
    this.requestRender();
    return true;
  }
  /** Camera range (or 2D view width) for the logarithmic navigation slider. */
  navigationDistance() {
    const f = this.camera.frustum as { left?: number; right?: number };
    if (this.mode === "map" && f.left !== undefined && f.right !== undefined)
      return Math.max(2, f.right - f.left);
    return Math.max(
      2,
      Cartesian3.distance(
        this.camera.positionWC,
        this.cameraWorldPosition(this.centerGround()),
      ),
    );
  }
  zoom(factor: number) {
    this.zoomAt(
      factor,
      new Cartesian2(this.host.clientWidth / 2, this.host.clientHeight / 2),
    );
  }
  private zoomAt(factor: number, pixel: Cartesian2) {
    if (!finite(factor) || factor <= 0) return;
    const anchor = this.groundAt(pixel);
    const frustum = this.camera.frustum as {
      right?: number;
      left?: number;
      top?: number;
      bottom?: number;
    };
    if (
      this.mode === "map" &&
      frustum.right !== undefined &&
      frustum.left !== undefined &&
      frustum.top !== undefined &&
      frustum.bottom !== undefined
    ) {
      const width = frustum.right - frustum.left;
      const scale =
        Math.max(2, Math.min(2 * Math.PI * 6378137, width / factor)) / width;
      frustum.left *= scale;
      frustum.right *= scale;
      frustum.top *= scale;
      frustum.bottom *= scale;
      const after = anchor && this.groundAt(pixel);
      if (anchor && after)
        this.moveWorld(
          Cartesian3.subtract(
            this.cameraWorldPosition(anchor),
            this.cameraWorldPosition(after),
            new Cartesian3(),
          ),
        );
    } else {
      const ground = anchor || this.centerGround();
      const delta = Cartesian3.subtract(
        this.cameraWorldPosition(ground),
        this.camera.positionWC,
        new Cartesian3(),
      );
      const distance = Cartesian3.magnitude(delta);
      if (distance > 0) {
        const target = Math.max(2, Math.min(8e7, distance / factor));
        this.moveWorld(
          Cartesian3.multiplyByScalar(
            delta,
            1 - target / distance,
            new Cartesian3(),
          ),
        );
      }
    }
    this.constrainCamera();
    this.requestRender();
    this.onSceneChange();
  }
  mapZoom() {
    const globeRectangle =
      this.scene.mode === SceneMode.SCENE3D
        ? this.camera.computeViewRectangle(Ellipsoid.WGS84)
        : undefined;
    const bounds =
      this.scene.mode === SceneMode.SCENE3D ? null : this.visibleBounds();
    const frustum = this.camera.frustum as { left?: number; right?: number };
    // 2D's orthographic frustum is authoritative, including a wrapped map at the date line.
    const span =
      this.scene.mode === SceneMode.SCENE2D &&
      frustum.left !== undefined &&
      frustum.right !== undefined
        ? (frustum.right - frustum.left) / Ellipsoid.WGS84.maximumRadius
        : globeRectangle
          ? // Rectangle.width accounts for longitude wrap; the conservative
            // query bounds span the world when a viewport crosses the date line.
            globeRectangle.width
          : bounds
            ? CesiumMath.toRadians(Math.max(1e-9, bounds[2] - bounds[0]))
            : Math.min(
                2 * Math.PI,
                Math.max(1, this.camera.positionCartographic.height) /
                  Ellipsoid.WGS84.maximumRadius,
              );
    return Math.max(
      0,
      Math.min(
        24,
        Math.log2(
          (((2 * Math.PI) / Math.max(1e-12, span)) * this.host.clientWidth) /
            256,
        ),
      ),
    );
  }
  private projectedViewport(includeTime: boolean): Bounds | null {
    const terrain = this.terrain;
    const minHeight = terrain
      ? Math.min(0, terrain.minimum * this.exaggeration - 120)
      : 0;
    const maxHeight =
      (terrain ? Math.max(0, terrain.maximum * this.exaggeration + 120) : 0) +
      2 +
      (includeTime ? this.timeHeightMeters : 0);
    const volume = this.camera.frustum.computeCullingVolume(
      this.camera.positionWC,
      this.camera.directionWC,
      this.camera.upWC,
    );
    const projection = this.scene.mapProjection;
    const sw = projection.project(Cartographic.fromDegrees(-180, -90)),
      ne = projection.project(Cartographic.fromDegrees(180, 90));
    // Cesium's 2D infinite-scroll map can render another longitude copy. Clip around the camera,
    // then normalize a single copy or conservatively retain all longitudes across the date line.
    const flat = this.scene.mode === SceneMode.SCENE2D;
    const extent: [number, number, number, number] = flat
      ? [
          this.camera.positionWC.y -
            2 * Math.PI * Ellipsoid.WGS84.maximumRadius,
          sw.y,
          this.camera.positionWC.y +
            2 * Math.PI * Ellipsoid.WGS84.maximumRadius,
          ne.y,
        ]
      : [sw.x, sw.y, ne.x, ne.y];
    const bounds = projectedFrustumBounds(
      volume.planes,
      extent,
      minHeight,
      maxHeight,
    );
    if (!bounds) return null;
    const southWest = projection.unproject(
        new Cartesian3(bounds[0], bounds[1], 0),
      ),
      northEast = projection.unproject(new Cartesian3(bounds[2], bounds[3], 0));
    const epsilon = 1e-8; // Conservative rounding in degrees, approximately one millimetre at the equator.
    let west = CesiumMath.toDegrees(southWest.longitude),
      east = CesiumMath.toDegrees(northEast.longitude);
    if (flat) {
      const copy = Math.floor((west + 180) / 360) * 360;
      west -= copy;
      east -= copy;
      if (east > 180 + epsilon) {
        west = -180;
        east = 180;
      }
    }
    return [
      Math.max(-180, west - epsilon),
      Math.max(-90, CesiumMath.toDegrees(southWest.latitude) - epsilon),
      Math.min(180, east + epsilon),
      Math.min(90, CesiumMath.toDegrees(northEast.latitude) + epsilon),
    ];
  }

  visibleBounds(): Bounds | null {
    if (!this.viewer) return null;
    if (this.mode === "space-time" && this.spaceTimeFloor)
      return [...this.spaceTimeFloor];
    if (this.scene.mode !== SceneMode.SCENE3D)
      return this.projectedViewport(false);
    const rect = this.camera.computeViewRectangle(Ellipsoid.WGS84);
    if (!rect) return null;
    const west = CesiumMath.toDegrees(rect.west),
      east = CesiumMath.toDegrees(rect.east);
    if (east < west)
      return [
        -180,
        CesiumMath.toDegrees(rect.south),
        180,
        CesiumMath.toDegrees(rect.north),
      ];
    return [
      west,
      CesiumMath.toDegrees(rect.south),
      east,
      CesiumMath.toDegrees(rect.north),
    ];
  }
  visibleDataBounds(): Bounds | null {
    if (this.mode === "globe" && this.globeTime) return null;
    // A ground footprint can exclude elevated events above the horizon. Globe time
    // uses the study bounds and existing bounded representative/cell budgets.
    // Intersect the whole displayed time-height prism: an elevated event can be visible above a ground footprint.
    return this.scene.mode === SceneMode.COLUMBUS_VIEW
      ? this.projectedViewport(true)
      : this.visibleBounds();
  }
  fit(wholeGlobe = false) {
    if (!this.viewer || this.disposed) return;
    if (
      this.mode === "globe" &&
      this.globeTime &&
      !wholeGlobe &&
      this.bounds[2] - this.bounds[0] <= 150 &&
      this.bounds[3] - this.bounds[1] <= 100
    ) {
      // Frame the elevated volume as well as its ground footprint. Fitting only
      // the ellipsoid rectangle clips high-time events at the viewport edges.
      const positions = this.renderPoints.map((p) => this.pos(p));
      for (let row = 0; row <= 4; row++)
        for (let col = 0; col <= 8; col++) {
          const lat =
            this.bounds[1] + ((this.bounds[3] - this.bounds[1]) * row) / 4;
          const lon =
            this.bounds[0] + ((this.bounds[2] - this.bounds[0]) * col) / 8;
          positions.push(
            this.groundPosition(lat, lon),
            this.position(lat, lon, this.lo),
          );
        }
      const sphere = BoundingSphere.fromPoints(positions);
      const vertical =
        (this.camera.frustum as { fovy?: number }).fovy || Math.PI / 3;
      const horizontal =
        2 *
        Math.atan(
          (Math.tan(vertical / 2) * this.host.clientWidth) /
            Math.max(1, this.host.clientHeight),
        );
      const range = Math.max(
        100,
        sphere.radius / Math.sin(Math.min(vertical, horizontal) * 0.42),
      );
      this.camera.viewBoundingSphere(
        sphere,
        new HeadingPitchRange(0, CesiumMath.toRadians(-72), range),
      );
      this.camera.lookAtTransform(Matrix4.IDENTITY);
    } else if (
      this.mode === "globe" &&
      (wholeGlobe ||
        this.bounds[2] - this.bounds[0] > 150 ||
        this.bounds[3] - this.bounds[1] > 100)
    ) {
      // Fit the ellipsoid to the available viewport, never use a flat-map width as an orbital range.
      const aspect =
        this.host.clientWidth / Math.max(1, this.host.clientHeight);
      const vertical =
        (this.camera.frustum as { fovy?: number }).fovy || Math.PI / 3;
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
      const timeHeight = this.globeTime ? this.timeHeightMeters : 0;
      const altitude =
        (Ellipsoid.WGS84.maximumRadius + timeHeight) /
          Math.sin(Math.min(vertical, horizontal) * 0.42) -
        Ellipsoid.WGS84.maximumRadius;
      this.camera.setView({
        destination: Cartesian3.fromDegrees(
          (this.bounds[0] + this.bounds[2]) / 2,
          (this.bounds[1] + this.bounds[3]) / 2,
          altitude,
        ),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
    } else {
      // Fit the study, never the camera-derived map window (which grows on zoom).
      const b = this.bounds,
        lon = (b[0] + b[2]) / 2,
        lat = (b[1] + b[3]) / 2;
      const rectangle = Rectangle.fromDegrees(
        Math.max(-180, b[0] - 0.005),
        Math.max(-90, b[1] - 0.005),
        Math.min(180, b[2] + 0.005),
        Math.min(90, b[3] + 0.005),
      );
      this.camera.setView({
        destination: rectangle,
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      if (this.mode === "globe") {
        const target = Cartesian3.fromDegrees(
          lon,
          lat,
          this.groundHeight(lat, lon),
        );
        const range =
          Cartesian3.distance(
            this.camera.positionWC,
            this.cameraWorldPosition(target),
          ) * 1.12;
        this.camera.lookAt(
          target,
          new HeadingPitchRange(
            0,
            CesiumMath.toRadians(-72),
            Math.max(100, range),
          ),
        );
        this.camera.lookAtTransform(Matrix4.IDENTITY);
      } else if (this.mode !== "map") {
        const base = Cartesian3.fromDegrees(
          lon,
          lat,
          this.groundHeight(lat, lon) + this.timeHeightMeters * 0.35,
        );
        const width = Math.max(
          1000,
          Math.abs(b[2] - b[0]) *
            111319 *
            Math.max(0.05, Math.cos((lat * Math.PI) / 180)),
          Math.abs(b[3] - b[1]) * 111319,
        );
        const range = Math.max(
          width *
            (this.host.clientWidth / Math.max(1, this.host.clientHeight) > 1.8
              ? 1.6
              : 2.2),
          this.timeHeightMeters * 2.6,
        );
        this.camera.lookAt(
          base,
          new HeadingPitchRange(0, CesiumMath.toRadians(-42), range),
        );
        this.camera.lookAtTransform(Matrix4.IDENTITY);
      }
    }
    this.requestRender();
    this.controls.dispatchEvent(new Event("change"));
    this.onSceneChange();
  }
  lookAtGeographic(
    center: number[],
    distance: number,
    heading: number,
    tilt: number,
  ) {
    if (this.mode === "map" && (heading !== 0 || tilt !== 0))
      throw Error("2D Map is north-up; heading and tilt must be zero");
    this.camera.lookAt(
      Cartesian3.fromDegrees(center[0], center[1], center[2]),
      new HeadingPitchRange(
        CesiumMath.toRadians(heading),
        CesiumMath.toRadians(tilt - 90),
        distance,
      ),
    );
    this.preserveNadirHeading(heading, tilt);
    this.camera.lookAtTransform(Matrix4.IDENTITY);
    if (this.mode === "map") {
      const state = this.captureCamera();
      state.cesium_camera.frustum_width = distance;
      this.restoreCamera(state);
    }
    this.requestRender();
    this.controls.dispatchEvent(new Event("change"));
  }
  captureCamera(): { renderer: "cesium"; cesium_camera: CesiumCameraState } {
    const frustum = this.camera.frustum as {
      width?: number;
      left?: number;
      right?: number;
    };
    const width =
      frustum.width ??
      (typeof frustum.left === "number" && typeof frustum.right === "number"
        ? frustum.right - frustum.left
        : undefined);
    return {
      renderer: "cesium",
      cesium_camera: {
        position: [
          this.camera.position.x,
          this.camera.position.y,
          this.camera.position.z,
        ],
        direction: [
          this.camera.direction.x,
          this.camera.direction.y,
          this.camera.direction.z,
        ],
        up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
        ...(typeof width === "number" ? { frustum_width: width } : {}),
      },
    };
  }
  restoreCamera(scene: any) {
    const state = scene?.cesium_camera;
    if (
      scene?.renderer !== "cesium" ||
      !state ||
      ![state.position, state.direction, state.up].every(
        (v) => Array.isArray(v) && v.length === 3 && v.every(finite),
      )
    )
      return false;
    const direction = Cartesian3.unpack(state.direction),
      up = Cartesian3.unpack(state.up);
    if (
      Math.abs(Cartesian3.magnitude(direction) - 1) > 1e-5 ||
      Math.abs(Cartesian3.magnitude(up) - 1) > 1e-5 ||
      Math.abs(Cartesian3.dot(direction, up)) > 1e-5
    )
      return false;
    this.camera.lookAtTransform(Matrix4.IDENTITY);
    Cartesian3.unpack(state.position, 0, this.camera.position);
    Cartesian3.clone(direction, this.camera.direction);
    Cartesian3.clone(up, this.camera.up);
    Cartesian3.cross(direction, up, this.camera.right);
    if (
      this.mode === "map" &&
      finite(state.frustum_width) &&
      state.frustum_width > 0
    ) {
      const f = this.camera.frustum as {
        width?: number;
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
      };
      if (f.width !== undefined) f.width = state.frustum_width;
      else if (
        f.left !== undefined &&
        f.right !== undefined &&
        f.top !== undefined &&
        f.bottom !== undefined
      ) {
        const ratio = (f.top - f.bottom) / (f.right - f.left);
        f.left = -state.frustum_width / 2;
        f.right = state.frustum_width / 2;
        f.top = (state.frustum_width * ratio) / 2;
        f.bottom = (-state.frustum_width * ratio) / 2;
      }
    }
    this.requestRender();
    this.controls.dispatchEvent(new Event("change"));
    return true;
  }
  projectEvent(id: string): { x: number; y: number } | null {
    const p = this.pointById.get(id),
      projected = p && this.project(this.pos(p));
    return projected ? { x: projected.x, y: projected.y } : null;
  }
  diagnostics() {
    const intervals = [...this.frameIntervals].sort((a, b) => a - b),
      cpu = [...this.renderTimes].sort((a, b) => a - b);
    const active = performance.now() - this.lastRendered < 250;
    return {
      engine: "CesiumJS",
      navigation: {
        inertia: false,
        freeLook: false,
        northUpOnly: this.mode === "map",
        gestureMaximumTiltDegrees: 85,
        keyboardFocus: "map",
        active: !!this.drag,
      },
      spaceTimeFloor:
        this.mode === "space-time"
          ? {
              bounds: this.spaceTimeFloor ? [...this.spaceTimeFloor] : null,
              padding: spaceTimePadding(
                this.host.clientWidth,
                this.host.clientHeight,
              ),
            }
          : null,
      globeTime: this.globeTime,
      globeTimeScale: this.globeTimeScale,
      timeHeightMeters: this.timeHeightMeters,
      displayTimeBounds: [this.lo, this.hi],
      contextRecoveries: this.contextRecoveries,
      recovering: this.recovering,
      renderErrorCount: this.renderErrors,
      lastRenderError: this.lastRenderError,
      sceneMode: this.scene.mode,
      pointCount: this.glyphs.length + this.arrivingPoints.length,
      triangleCount: this.triangles.length + this.arrivingTriangles.length,
      fadingPointCount: this.fading.length,
      fadingTriangleCount: this.fadingTriangles.length,
      fadingStemSegments: this.fadeTrails.reduce((n, c) => n + c.segments, 0),
      fadeDurationsMs: { arrival: 550, departure: 2400 },
      arrivingPointCount: this.arrivingPoints.length,
      arrivingTriangleCount: this.arrivingTriangles.length,
      triangleVisibleCount: this.trianglePoints.filter(
        (p) => this.glyphById.get(p.id)?.show,
      ).length,
      selectionCount: this.selections.length,
      geometryFeatures: this.geometryFeatures.length,
      geometryPrimitives: this.shapes.length,
      trackPolylines: this.trails.length,
      stemSegments: this.stemSegments,
      trailInputEdges: this.trailInputEdges,
      trailOutputEdges: this.trailOutputEdges,
      geodesicRendering: {
        geometry: { ...this.geometryArcBudget },
        trails: { ...this.trailArcBudget },
        maximumAddedVertices: 400000,
        sourceEndpointBudget: 400000,
      },
      axisLabels: this.axisLabels.length,
      orbitHandles: this.handles.length,
      requestRenderMode: this.scene.requestRenderMode,
      performance: {
        renderedFrames: this.renderedFrames,
        active,
        sampleFrames: intervals.length,
        // CPU submission time excludes asynchronous GPU execution.
        fps:
          active && intervals.length
            ? (1000 * intervals.length) / intervals.reduce((a, b) => a + b, 0)
            : null,
        frameP95Ms: intervals[Math.floor(intervals.length * 0.95)] ?? null,
        renderCpuP95Ms: cpu[Math.floor(cpu.length * 0.95)] ?? null,
      },
      terrain: this.resources.status,
      effectError: this.effectError,
    };
  }
  setTerrainDatum(datum: "egm96" | "ellipsoid" | "unresolved-msl") {
    this.resources?.setVerticalDatum(datum);
  }
  resize() {
    if (this.viewer && !this.disposed) {
      this.viewer.resize();
      this.updateAxes();
      this.requestRender();
    }
  }
  requestRender() {
    if (this.viewer && !this.disposed) {
      this.renderQueued = true;
      this.scene.requestRender();
    }
  }
  draw() {
    this.requestRender();
  }
  private pickId(x: number, y: number): PickId | undefined {
    try {
      const pixel = new Cartesian2(x, y),
        hit = this.scene.pick(pixel, 7, 7),
        first = hit?.id as PickId | undefined;
      if (first?.kind) return first;
      const gis = this.gis.pick(hit);
      if (gis) return gis;
      // Track/axis strokes can be nearer than their coincident marker. Walk the real GPU pick stack;
      // never invent an event ID for a whole entity's track.
      const stack = this.scene.drillPick(pixel, 16, 7, 7);
      const item = stack.find(
        (hit) =>
          hit.id?.kind === "event" ||
          hit.id?.kind === "geometry" ||
          hit.id?.kind === "cluster" ||
          hit.id?.kind === "orbit",
      );
      if (item) return item.id as PickId;
    } catch {
      /* Context loss does not turn navigation into an unhandled error. */
    }
    const r = this.viewer.canvas.getBoundingClientRect(),
      bin = this.displayLayer.pick(x + r.left, y + r.top);
    return bin ? { kind: "cluster", bin } : undefined;
  }

  private flushPendingPick() {
    clearTimeout(this.pendingPick);
    this.pendingPick = undefined;
    const action = this.pendingPickAction;
    this.pendingPickAction = undefined;
    action?.();
  }
  private hideTooltip() {
    clearTimeout(this.hoverHintTimer);
    this.hoverHintTimer = undefined;
    this.hoverHintKey = "";
    this.tooltip.style.display = "none";
  }
  private cancelPendingPick(restore = false) {
    this.pendingPickAction = undefined;
    clearTimeout(this.pendingPick);
    this.pendingPick = undefined;
    if (restore && this.clickSequence?.applied)
      this.onPick(this.clickSequence.selection, false);
    this.clickSequence = undefined;
  }
  private bindCanvas() {
    const canvas = this.viewer.canvas,
      signal = this.abort.signal;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "Map view. Arrow keys pan; plus and minus zoom; N faces north; U looks down; R fits events.",
    );
    canvas.addEventListener(
      "wheel",
      (event) => {
        this.hideTooltip();
        if (
          this.disposed ||
          this.recovering ||
          !this.scene.screenSpaceCameraController.enableInputs
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = canvas.getBoundingClientRect();
        const delta =
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? this.host.clientHeight
              : 1);
        if (event.shiftKey) {
          if (this.mode !== "map") this.setTilt(this.tilt() + delta * 0.05);
        } else if (event.ctrlKey || event.metaKey) {
          if (this.mode !== "map")
            this.setBearing(this.bearing() + delta * 0.05);
        } else
          this.zoomAt(
            Math.exp(
              Math.max(
                -0.65,
                Math.min(0.65, -delta * 0.002 * (event.altKey ? 0.25 : 1)),
              ),
            ),
            new Cartesian2(event.clientX - rect.left, event.clientY - rect.top),
          );
      },
      { signal, passive: false, capture: true },
    );
    canvas.addEventListener(
      "dblclick",
      (event) => {
        if (
          event.button !== 0 ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          this.boxMode
        )
          return;
        event.preventDefault();
        this.cancelPendingPick(true);
        const r = canvas.getBoundingClientRect();
        this.zoomAt(
          1.8,
          new Cartesian2(event.clientX - r.left, event.clientY - r.top),
        );
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        this.hideTooltip();
        if (e.button > 2 || this.recovering) return;
        const sameClick =
          e.button === 0 &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          this.clickSequence &&
          performance.now() - this.clickSequence.at < 600 &&
          Math.hypot(
            this.clickSequence.x - e.clientX,
            this.clickSequence.y - e.clientY,
          ) <= 5;
        if (!sameClick) this.flushPendingPick();
        if (e.button !== 2) this.rightClick = undefined;
        canvas.focus({ preventScroll: true });
        this.inputSuspended = false;
        this.scene.screenSpaceCameraController.enableInputs = true;
        if (e.button === 1 && this.mode === "map") {
          e.preventDefault();
          return;
        }
        const r = canvas.getBoundingClientRect();
        const id =
          e.button === 0
            ? this.pickId(e.clientX - r.left, e.clientY - r.top)
            : undefined;
        const navigation =
          e.button === 2
            ? "zoom"
            : this.mode !== "map" &&
                (e.button === 1 || (!this.boxMode && (e.ctrlKey || e.shiftKey)))
              ? "orbit"
              : undefined;
        this.drag = {
          x: e.clientX,
          y: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          box: e.button === 0 && this.boxMode,
          add: e.shiftKey || e.ctrlKey || e.metaKey,
          orbit: id?.kind === "orbit",
          pointer: e.pointerId,
          button: e.button,
          navigation,
          anchor: new Cartesian2(e.clientX - r.left, e.clientY - r.top),
        };
        if (this.drag.box || this.drag.orbit || navigation) {
          this.scene.screenSpaceCameraController.enableInputs = false;
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        const r = canvas.getBoundingClientRect(),
          drag = this.drag;
        if (drag && drag.pointer !== e.pointerId) return;
        if (drag?.orbit || drag?.navigation) {
          const dx = e.clientX - drag.lastX,
            dy = e.clientY - drag.lastY;
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 5) return;
          this.cancelPendingPick();
          if (drag.navigation === "zoom")
            this.zoomAt(
              Math.exp(Math.max(-0.65, Math.min(0.65, dy * 0.008))),
              drag.anchor,
            );
          else this.orient(this.bearing() + dx * 0.3, this.tilt() - dy * 0.2);
          return;
        }
        if (drag?.box) {
          this.box.style.display = "block";
          this.box.style.left = `${Math.min(drag.x, e.clientX) - r.left}px`;
          this.box.style.top = `${Math.min(drag.y, e.clientY) - r.top}px`;
          this.box.style.width = `${Math.abs(e.clientX - drag.x)}px`;
          this.box.style.height = `${Math.abs(e.clientY - drag.y)}px`;
          return;
        }
        if (drag) {
          this.hideTooltip();
          return;
        }
        const id = this.pickId(e.clientX - r.left, e.clientY - r.top);
        canvas.style.cursor =
          id?.kind === "orbit"
            ? "grab"
            : id
              ? "pointer"
              : this.boxMode
                ? "crosshair"
                : "";
        const point =
          id && (id.kind === "event" || id.kind === "geometry")
            ? this.pointById.get(id.id)
            : undefined;
        if (id?.kind === "cluster")
          this.tooltip.textContent = `${id.bin.count.toLocaleString()} events · click to zoom; Shift-click selects evidence`;
        else if (point)
          this.tooltip.textContent = `${this.names[point.entity] || "Event"} · ${time(point.time)} UTC${point.inferred ? " · Location unknown · inferred display position" : point.centroid ? " · Polygon centroid (derived surface location)" : ""}`;
        else if (id?.kind === "orbit")
          this.tooltip.textContent = `Drag ${id.side} handle to rotate`;
        else {
          this.hideTooltip();
          return;
        }
        const hoverKey = JSON.stringify(id);
        if (this.hoverHintKey !== hoverKey) {
          this.hideTooltip();
          this.hoverHintKey = hoverKey;
          this.hoverHintTimer = setTimeout(() => {
            if (this.disposed || this.hoverHintKey !== hoverKey) return;
            if (
              JSON.stringify(
                this.pickId(e.clientX - r.left, e.clientY - r.top),
              ) !== hoverKey
            ) {
              this.hideTooltip();
              return;
            }
            this.tooltip.style.display = "block";
          }, TOOLTIP_DELAY_MS);
        }
        this.tooltip.style.left = `${Math.min(this.host.clientWidth - 240, e.clientX - r.left + 14)}px`;
        this.tooltip.style.top = `${e.clientY - r.top + 12}px`;
      },
      { signal },
    );
    const up = (e: PointerEvent) => {
      const drag = this.drag;
      if (!drag) {
        if (this.inputSuspended) {
          this.inputSuspended = false;
          this.scene.screenSpaceCameraController.enableInputs = true;
        }
        return;
      }
      if (drag.pointer !== e.pointerId || drag.button !== e.button) return;
      this.drag = undefined;
      this.scene.screenSpaceCameraController.enableInputs = true;
      this.box.style.display = "none";
      const r = canvas.getBoundingClientRect(),
        distance = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      if (drag.orbit || drag.button === 1) return;
      if (drag.button === 2) {
        if (distance <= 5) {
          const last = this.rightClick,
            now = performance.now();
          if (
            last &&
            now - last.at < 500 &&
            Math.hypot(last.x - e.clientX, last.y - e.clientY) <= 5
          ) {
            this.zoomAt(1 / 1.8, drag.anchor);
            this.rightClick = undefined;
          } else this.rightClick = { at: now, x: e.clientX, y: e.clientY };
        } else this.rightClick = undefined;
        return;
      }
      if (drag.box && distance > 5) {
        const left = Math.min(drag.x, e.clientX) - r.left,
          right = Math.max(drag.x, e.clientX) - r.left,
          top = Math.min(drag.y, e.clientY) - r.top,
          bottom = Math.max(drag.y, e.clientY) - r.top;
        const inside = (p: Cartesian3) => {
          const s = this.project(p);
          return (
            !!s && s.x >= left && s.x <= right && s.y >= top && s.y <= bottom
          );
        };
        const ids = this.renderPoints
          .filter((p) => inside(this.pos(p)))
          .map((p) => p.id);
        const cells = this.displayLayer.active
          ? this.displayLayer.inBox(
              Math.min(drag.x, e.clientX),
              Math.min(drag.y, e.clientY),
              Math.max(drag.x, e.clientX),
              Math.max(drag.y, e.clientY),
            )
          : [];
        for (const feature of this.geometryFeatures) {
          if (ids.includes(feature.id)) continue;
          const projected = ([lon, lat]: [number, number]) =>
            this.project(this.position(lat, lon, feature.time));
          const box = { left, right, top, bottom };
          const intersects =
            feature.shape.points.some((p) => {
              const q = projected(p);
              return (
                q && q.x >= left && q.x <= right && q.y >= top && q.y <= bottom
              );
            }) ||
            feature.shape.lines.some((line) =>
              lineIntersectsBox(line.map(projected), box),
            ) ||
            feature.shape.polygons.some((polygon) =>
              polygonIntersectsBox(
                polygon.map((r) => r.map(projected)),
                box,
              ),
            );
          if (intersects) ids.push(feature.id);
        }
        if (cells.length) this.onClusters(cells, drag.add, ids);
        else this.onPick(ids, drag.add);
        return;
      }
      if (distance > 5) return;
      const now = performance.now();
      if (
        !this.clickSequence ||
        now - this.clickSequence.at > 600 ||
        Math.hypot(
          this.clickSequence.x - e.clientX,
          this.clickSequence.y - e.clientY,
        ) > 5
      )
        this.clickSequence = {
          at: now,
          x: e.clientX,
          y: e.clientY,
          selection: [...this.selected],
          applied: false,
        };
      const id = this.pickId(e.clientX - r.left, e.clientY - r.top);
      clearTimeout(this.pendingPick);
      this.pendingPickAction = () => {
        if (this.disposed) return;
        if (this.clickSequence) this.clickSequence.applied = true;
        if (id?.kind === "cluster") {
          if (drag.add) this.onClusters([id.bin.cell], true, []);
          else this.onCluster(id.bin);
        } else if (id && (id.kind === "event" || id.kind === "geometry"))
          this.onPick([id.id], drag.add);
        else if (id?.kind === "gis") this.onGisPick(id.layer, id.id);
        else if (!drag.add) this.onPick([], false);
      };
      this.pendingPick = setTimeout(() => this.flushPendingPick(), 250);
    };
    canvas.addEventListener("pointerup", up, { signal });
    window.addEventListener("pointerup", up, { signal });
    const resetPointer = () => {
      this.drag = undefined;
      this.rightClick = undefined;
      this.inputSuspended = false;
      this.box.style.display = "none";
      this.scene.screenSpaceCameraController.enableInputs = true;
    };
    canvas.addEventListener("pointercancel", resetPointer, { signal });
    window.addEventListener(
      "blur",
      () => {
        resetPointer();
        this.cancelPendingPick();
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerleave",
      () => {
        this.hideTooltip();
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), {
      signal,
    });
  }
  async screenshot() {
    const deadline = performance.now() + 3000;
    const waitForReady = async (promise: Promise<unknown>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Graphics are initializing or restoring; retry the screenshot after graphics are ready",
                  ),
                ),
              Math.max(1, deadline - performance.now()),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    await waitForReady(this.ready);
    if (this.recoveryPromise) await waitForReady(this.recoveryPromise);
    if (this.disposed) throw new Error("View is closed");
    if (this.recovering)
      throw new Error(
        "Graphics context is unavailable; retry once graphics restoration finishes",
      );
    const pending = () =>
      this.resources.status.basemapPending > 0 ||
      this.displayLayer.diagnostics.pending ||
      (this.scene.globe.show && !this.scene.globe.tilesLoaded);
    // Imagery readiness can precede its native texture upload by several frames.
    // Require consecutive settled frames, restarting if terrain/effects enqueue more work.
    let settledFrames = 0;
    do {
      if (this.recovering)
        throw new Error(
          "Graphics context is unavailable; retry once graphics restoration finishes",
        );
      this.requestRender();
      this.viewer.render();
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
      settledFrames = pending() ? 0 : settledFrames + 1;
      if (settledFrames >= 5) break;
      if (!settledFrames)
        await new Promise((resolve) => setTimeout(resolve, 40));
    } while (performance.now() < deadline && !this.disposed);
    if (this.disposed) throw new Error("View is closed");
    if (pending() || settledFrames < 5)
      throw new Error(
        "Map imagery or display effects are still loading; retry the screenshot after loading finishes",
      );
    const source = this.viewer.canvas,
      result = document.createElement("canvas"),
      credits = [
        ...new Set(["Natural Earth · public domain", ...this.mapCredits]),
      ];
    const footer = credits.length ? Math.max(28, credits.length * 17 + 12) : 0;
    // Provider URLs must stay legible, not clipped on a narrow viewport export.
    const measure = result.getContext("2d")!;
    measure.font = "12px sans-serif";
    result.width = Math.max(
      source.width,
      ...credits.map(
        (credit) => Math.ceil(measure.measureText(credit).width) + 20,
      ),
    );
    result.height = source.height + footer;
    const context = result.getContext("2d")!;
    // Axis and time labels are native Cesium LabelCollection glyphs,
    // already present in the GPU canvas at their visible screen positions.
    // With the normal non-preserved WebGL buffer, copy immediately after a
    // requested render, before yielding to presentation (which can clear it).
    this.requestRender();
    this.viewer.render();
    context.drawImage(source, 0, 0);
    if (footer) {
      context.fillStyle = this.theme === "light" ? "#f1f5f8" : "#13212d";
      context.fillRect(0, source.height, result.width, footer);
      context.fillStyle = this.theme === "light" ? "#253b4b" : "#c8dce9";
      context.font = "12px sans-serif";
      credits.forEach((credit, i) =>
        context.fillText(
          credit,
          10,
          source.height + 18 + i * 17,
          result.width - 20,
        ),
      );
    }
    return result.toDataURL("image/png");
  }
  dispose() {
    this.hideTooltip();
    this.cancelPendingPick();
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.idleTimer);
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.stopFades();
    this.displayLayer?.dispose();
    this.resources?.dispose();
    this.gis?.dispose();
    this.box.remove();
    this.tooltip.remove();
    this.labels.domElement.remove();
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
  }
}
