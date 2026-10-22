export interface DisplayOptions {
  mode: "auto" | "points" | "clusters" | "density" | "heatmap";
  cluster_pixels: number;
  time_bin_minutes: number;
  partition: "all" | "entity" | "source";
  spatial_culling: boolean;
  show_points: boolean;
  show_centroids: boolean;
  point_scale: number;
  track_opacity: number;
  trail_opacity: number;
  show_tracks: boolean;
  show_trails: boolean;
  trail_pixels: number;
  trail_gap_minutes: number;
  heat_radius: number;
  heat_weight: "count" | "value";
  heat_max: number | null;
  heat_reference_zoom: number | null;
  bloom: boolean;
  bloom_strength: number;
  bloom_radius: number;
  bloom_threshold: number;
}
export const defaultDisplay: DisplayOptions = {
  mode: "auto",
  cluster_pixels: 48,
  time_bin_minutes: 0,
  partition: "all",
  spatial_culling: true,
  show_points: true,
  show_centroids: true,
  point_scale: 1,
  track_opacity: 0.25,
  trail_opacity: 0.25,
  show_tracks: true,
  show_trails: true,
  trail_pixels: 2,
  trail_gap_minutes: 180,
  heat_radius: 32,
  heat_weight: "count",
  heat_max: null,
  heat_reference_zoom: null,
  bloom: false,
  bloom_strength: 1.3,
  bloom_radius: 0.1,
  bloom_threshold: 0.1,
};
export interface DisplayCell {
  level: number;
  x: number;
  y: number;
  slab: number;
  time_bin_minutes: number;
  partition: "all" | "entity" | "source";
  key: string;
  viewport: [number, number, number, number] | null;
}
export interface DisplayBin {
  cell: DisplayCell;
  count: number;
  selected_count: number;
  weight: number;
  first_time: number;
  last_time: number;
  sample_id: string;
  longitude: number;
  latitude: number;
  bounds: number[];
  event_bounds: number[];
}
export interface DisplayPacket {
  bins: DisplayBin[];
  count: number;
  aggregated: boolean;
  level: number;
  time_bin_minutes: number;
  cache_hit: boolean;
  revision: number;
  bounds: number[] | null;
  semantics: string;
}
