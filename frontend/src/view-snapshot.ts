import type { EngineContracts } from "./contracts";
import type { Bounds, GeometryFeature, Point } from "./types";
import type { DisplayOptions, DisplayPacket } from "./display-options";
import type { MeasurementStyle } from "./measurement-style";

/** Renderer-neutral envelope; the original Engine model is never rewritten. */
export type SnapshotArgs = EngineContracts["view_snapshot_v1"]["args"];
export type SnapshotModel = EngineContracts["view_snapshot_v1"]["result"];
export interface SnapshotRequestIntent {
  readonly ui_request_id: string;
  readonly lane: "refresh" | "viewport" | "metadata-reconcile";
  readonly refresh_generation: number;
  readonly viewport_generation: number;
  readonly mode: string;
  readonly expected_workspace?: string;
  readonly expected_revision?: number;
}
export interface SnapshotData {
  readonly points: readonly Point[];
  readonly names: readonly string[];
  readonly studyBounds: Readonly<Bounds>;
  readonly timeBounds: readonly [number, number];
  readonly geometries: readonly GeometryFeature[];
}
/** Complete candidate-owned renderer input. Native implementations stage these
 * plain values together, without ordinary source/style setters publishing early. */
export interface SnapshotApplication {
  readonly data: SnapshotData | null;
  readonly measurement: MeasurementStyle | null;
  readonly display: DisplayOptions;
  readonly displayPacket: DisplayPacket | null;
  readonly globeTime: boolean;
  readonly globeAltitude?: boolean;
  readonly globeTimeScale: number;
  readonly timeHeight: number;
  readonly theme: string;
  readonly selection: readonly string[];
  readonly rebuild: boolean;
  readonly focus: number;
  readonly awaitEffects: boolean;
}
export type SnapshotPublication =
  | { readonly kind: "accepted"; readonly dataChanged: boolean }
  | { readonly kind: "stale" }
  | { readonly kind: "needs-representation" };
