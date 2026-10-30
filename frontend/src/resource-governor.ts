/** Transient rendering budgets. Never write these into preferences or evidence. */
export interface MemorySample {
  supported: boolean;
  total_bytes: number;
  available_bytes: number;
  swap_used_bytes: number;
  sample_age_ms: number;
}
export interface ResourceLimits {
  name: "full" | "balanced" | "reduced" | "critical";
  maxPoints: number;
  maxPixels: number;
  maxScale: number;
  maxFps: number | undefined;
  tiles: number;
  screenError: number;
  streetCanvases: number;
  afterimages: number;
  fadeSegments: number;
  fadeCohorts: number;
  arcVertices: number;
}
const MiB = 1024 ** 2, GiB = 1024 ** 3;
export const RESOURCE_LIMITS: readonly ResourceLimits[] = [
  { name: "full", maxPoints: 100000, maxPixels: 8e6, maxScale: 1.5, maxFps: undefined,
    tiles: 100, screenError: 1, streetCanvases: 24, afterimages: 100000, fadeSegments: 100000, fadeCohorts: 256, arcVertices: 200000 },
  { name: "balanced", maxPoints: 20000, maxPixels: 2e6, maxScale: 1, maxFps: 30,
    tiles: 64, screenError: 2, streetCanvases: 12, afterimages: 5000, fadeSegments: 20000, fadeCohorts: 32, arcVertices: 80000 },
  { name: "reduced", maxPoints: 5000, maxPixels: 1e6, maxScale: .75, maxFps: 24,
    tiles: 32, screenError: 4, streetCanvases: 6, afterimages: 1250, fadeSegments: 5000, fadeCohorts: 8, arcVertices: 20000 },
  { name: "critical", maxPoints: 2000, maxPixels: 5e5, maxScale: .5, maxFps: 15,
    tiles: 16, screenError: 8, streetCanvases: 2, afterimages: 0, fadeSegments: 0, fadeCohorts: 0, arcVertices: 8000 },
];
export function resolutionFor(width: number, height: number, dpr: number, limits: ResourceLimits) {
  return Math.max(.05, Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    limits.maxScale, Math.sqrt(limits.maxPixels / Math.max(1, width * height))));
}
/** Normalize demanded animation cadence to a 30 ms reference. Idle periods
 * supply no intervals; a genuinely slow 1 FPS loop must still be recognized. */
export function activeCadenceCost(totalMs: number, intervals: number, maxFps: number | undefined) {
  return intervals >= 2 ? totalMs / intervals / (1000 / (maxFps ?? 60)) * 30 : 0;
}
export class ResourceGovernor {
  level = 0;
  reason = "initializing";
  sample: MemorySample | null = null;
  changes = 0;
  private slow = 0;
  private expensiveGeometry = 0;
  private healthySince: number | undefined;
  private swap: number | undefined;
  private sampleAt: number | undefined;
  private graphicsFloor = 0;
  private graphicsRenderer: string | null = null;
  get limits() { return RESOURCE_LIMITS[this.level]; }
  setGraphicsRenderer(renderer: string) {
    this.graphicsRenderer = renderer;
    this.graphicsFloor = /intel.*(?:uhd|\bhd\b|iris)|(?:uhd|iris).*intel|llvmpipe|swiftshader|software.*rasterizer/i.test(renderer) ? 1 : 0;
    if (this.level < this.graphicsFloor) {
      this.level = this.graphicsFloor;
      this.reason = "integrated-or-software-graphics";
      this.changes++;
    }
  }
  update(memory: MemorySample | null, renderMs: number | null, now: number, geometryWorkMs = 0, cadenceCost = 0): boolean {
    const valid = memory?.supported && Number.isFinite(memory.total_bytes) && memory.total_bytes > 0 &&
      Number.isFinite(memory.available_bytes) && memory.available_bytes >= 0 && memory.sample_age_ms < 15000;
    if (valid) { this.sample = memory; this.sampleAt = now; }
    const memoryFloor = valid ? memory.total_bytes <= 4.5 * GiB ? 2 : memory.total_bytes <= 8.5 * GiB ? 1 : 0
      : this.sample ? this.sample.total_bytes <= 4.5 * GiB ? 2 : this.sample.total_bytes <= 8.5 * GiB ? 1 : 0 : 0;
    const floor = Math.max(memoryFloor, this.graphicsFloor);
    let demand = floor, reason = memoryFloor ? "system-memory-capacity" : this.graphicsFloor ? "integrated-or-software-graphics" : "healthy";
    if (valid) {
      const available = memory.available_bytes, ratio = available / memory.total_bytes;
      if (available < 384 * MiB || ratio < .06) { demand = 3; reason = "critical-memory-availability"; }
      else if (available < 768 * MiB || ratio < .12) { demand = Math.max(demand, 2); reason = "low-memory-availability"; }
      else if (available < 1536 * MiB || ratio < .20) { demand = Math.max(demand, 1); reason = "memory-headroom"; }
      if (this.swap !== undefined && memory.swap_used_bytes - this.swap > 128 * MiB && ratio < .25) {
        demand = Math.max(demand, 2); reason = "swap-growth";
      }
      this.swap = memory.swap_used_bytes;
    }
    // Draw CPU time is a pressure proxy, not a GPU-memory measurement. An idle
    // scene supplies null, rather than mistaking intentional 10 Hz updates for lag.
    this.slow = Math.max(renderMs ?? 0, cadenceCost) > 45 ? this.slow + 1 : 0;
    if (this.slow >= 3) {
      const graphicsDemand = Math.min(3, this.level + 1);
      if (graphicsDemand > demand) { demand = graphicsDemand; reason = "sustained-render-cost"; }
      this.slow = 0;
    }
    // A load, seek or quality change can require one expensive rebuild. Require
    // repeated pressure checks before lowering every graphics budget for it.
    this.expensiveGeometry = geometryWorkMs > 250 ? this.expensiveGeometry + 1 : 0;
    if (this.expensiveGeometry >= 3 && Math.min(3, this.level + 1) > demand) {
      demand = Math.min(3, this.level + 1);
      reason = "expensive-geometry-work";
      this.expensiveGeometry = 0;
    }
    const old = this.level;
    if (demand > old) {
      this.level = demand; this.healthySince = undefined;
    } else if (demand < old && valid &&
      memory.available_bytes > Math.max(1.75 * GiB, memory.total_bytes * .25) &&
      (renderMs === null || renderMs < 22) && cadenceCost <= 36 && geometryWorkMs <= 250) {
      this.healthySince ??= now;
      if (now - this.healthySince >= 45000) {
        this.level--; this.healthySince = now;
      }
    } else this.healthySince = undefined;
    this.reason = this.level > demand ? "recovery-hold" : reason;
    if (old !== this.level) {
      this.changes++;
      this.slow = this.expensiveGeometry = 0;
    }
    return old !== this.level;
  }
  diagnostics(now = performance.now()) {
    return { automatic: true, profile: this.limits.name, reason: this.reason,
      changes: this.changes, memory: this.sample, limits: this.limits,
      graphicsRenderer: this.graphicsRenderer,
      memorySampleAgeMs: this.sampleAt === undefined ? null : Math.max(0, now - this.sampleAt) + (this.sample?.sample_age_ms ?? 0),
      recoveryHoldMs: 45000, gpuMemoryMeasured: false };
  }
}
