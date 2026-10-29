import type { SpaceTimeView } from "./view";
import type { Snapshot } from "./types";
import type { EngineContracts } from "./contracts";
type Scene = EngineContracts["scene_sync"]["args"]["scene"];
interface ViewHost {
  view: SpaceTimeView;
  snapshot: () => Snapshot;
  mode: () => string;
  captureScene: () => Scene;
  syncScene: (
    scene: Scene,
    expectedRevision?: number,
    expectedWorkspace?: string,
  ) => Promise<
    Exclude<EngineContracts["scene_sync"]["result"], { dry_run: true }>
  >;
  fitGisLayer: (id: string) => Promise<void>;
}
/** One native live-view adapter, shared by CLI/MCP requests and browser QA. */
export function createAgentView(host: ViewHost) {
  return async (kind: string, args: Record<string, any> = {}) => {
    const view = host.view;
    const originWorkspace = ["view_navigate", "view_reset"].includes(kind)
      ? host.snapshot().workspace_id
      : undefined;
    await view.ready;
    if (kind === "view_reset") {
      if (args.confirm !== true)
        throw Error("INVALID_ARGUMENT: map reset requires confirm:true");
      if (host.snapshot().workspace_id !== originWorkspace)
        throw Error("CONFLICT: workspace changed before map reset");
      if (view.diagnostics().recovering)
        throw Error(
          "UNAVAILABLE: graphics are already restoring; inspect view_status before retrying",
        );
      await view.recoverRenderer();
      if (host.snapshot().workspace_id !== originWorkspace)
        throw Error(
          "CONFLICT: workspace changed during map reset; inspect view_status",
        );
      const diagnostics = view.diagnostics();
      if (diagnostics.recovering || diagnostics.effectError)
        throw Error(
          `UNAVAILABLE: map reset failed: ${diagnostics.effectError || "graphics are still restoring"}`,
        );
      view.viewer.render();
    }
    if (kind === "view_navigate") {
      if (host.snapshot().workspace_id !== originWorkspace)
        throw Error("CONFLICT: workspace changed before navigation");
      if (view.diagnostics().recovering)
        throw Error(
          "UNAVAILABLE: graphics are restoring; inspect view_status before navigating",
        );
      // Commit a zero-duration mode transition before Cesium computes camera transforms.
      view.requestRender();
      view.viewer.render();
      if (args.action === "fit") {
        if (args.whole_globe && host.mode() !== "globe")
          throw Error("Whole-globe fit requires Globe mode");
        view.fit(args.whole_globe === true);
      } else if (args.action === "fit_layer") {
        const layer = view.gis.descriptors.find((l) => l.id === args.layer_id);
        if (!layer?.enabled)
          throw Error("Enable the GIS layer before fitting it");
        await view.gis.sync(host.snapshot().gis_layers || []);
        if (!view.gis.loaded.has(layer.id))
          throw Error(
            view.gis.errors.get(layer.id) || "GIS layer is still loading",
          );
        await host.fitGisLayer(layer.id);
      } else if (args.action === "look_at") {
        view.lookAtGeographic(
          args.center,
          args.distance_m,
          args.heading_degrees ?? 0,
          args.tilt_degrees ?? 0,
        );
      } else if (args.action === "zoom") view.zoom(args.factor);
      else if (args.action === "north_up") {
        view.setBearing(0);
      } else throw Error("Unsupported navigation action");
      view.requestRender();
      view.viewer.render();
      // Publish the completed camera immediately instead of relying on the idle timer.
      const scene = host.captureScene();
      const synced = await host.syncScene(
        scene,
        host.snapshot().revision,
        originWorkspace,
      );
      const current = host.snapshot();
      if (synced.revision >= current.revision) {
        current.scene = scene;
        current.revision = synced.revision;
      }
    }
    const gis_layers = view.gis.descriptors.map((l) => {
      const entry = view.gis.loaded.get(l.id),
        object = entry?.object as any;
      return {
        id: l.id,
        format: l.format,
        enabled: l.enabled,
        loaded: !!entry,
        ready:
          !!entry &&
          !object.isLoading &&
          (typeof object.ready === "boolean"
            ? object.ready
            : typeof object.tilesLoaded === "boolean"
              ? object.tilesLoaded
              : true),
        error: view.gis.errors.get(l.id)?.slice(0, 1024) || null,
      };
    });
    return {
      ...(kind === "view_reset" ? { reset: true } : {}),
      revision: host.snapshot().revision,
      renderer: "cesium",
      backend: "WebGL2",
      webgpu_api_available: !!(navigator as Navigator & { gpu?: unknown }).gpu,
      hardware_acceleration: "unknown",
      mode: host.mode(),
      scene: host.captureScene(),
      viewport: {
        width: Math.round(view.host.clientWidth),
        height: Math.round(view.host.clientHeight),
      },
      loading: {
        imagery: view.scene.globe.show && !view.scene.globe.tilesLoaded,
        effects: !!view.displayLayer.diagnostics.pending,
        gis: gis_layers.filter((l) => l.enabled && !l.ready && !l.error).length,
      },
      gis_layers,
      diagnostics: view.diagnostics(),
    };
  };
}
