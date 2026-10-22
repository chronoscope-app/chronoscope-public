import { heatColor, triangularBlur } from "./display-math";

export interface GroundContribution {
  x: number;
  y: number;
  count: number;
  weight: number;
}
export interface GroundEffectRequest {
  width: number;
  height: number;
  points: GroundContribution[];
  heat: boolean;
  heatRadius: number;
  heatRadiusY: number;
  heatMaximum: number | null;
  bloom: boolean;
  bloomRadius: number;
  bloomRadiusY: number;
  bloomStrength: number;
  bloomThreshold: number;
  bloomExposure?: number;
}

/** Rasterize count-conserving bilinear splats before the compact kernel. */
export function splatGround(
  points: GroundContribution[],
  width: number,
  height: number,
  field: "count" | "weight",
) {
  const raster = new Float64Array(width * height);
  for (const point of points) {
    if (!Number.isFinite(point.x + point.y + point[field])) continue;
    const px = point.x * (width - 1),
      py = point.y * (height - 1);
    const x = Math.floor(px),
      y = Math.floor(py),
      fx = px - x,
      fy = py - y;
    for (const [dx, dy, weight] of [
      [0, 0, (1 - fx) * (1 - fy)],
      [1, 0, fx * (1 - fy)],
      [0, 1, (1 - fx) * fy],
      [1, 1, fx * fy],
    ]) {
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
        raster[(y + dy) * width + x + dx] += Math.max(0, point[field]) * weight;
    }
  }
  return raster;
}

/** Exact positive 90th percentile; scratch selection leaves emission untouched. */
export function bloomExposure(emission: Float64Array) {
  const values = new Float64Array(emission.length);
  let count = 0;
  for (const value of emission) if (value > 0) values[count++] = value;
  if (!count) return 1;
  const rank = Math.floor(count * 0.9);
  let left = 0,
    right = count - 1;
  // Bound pathological pivot sequences; the fallback still selects the exact rank.
  let attempts = 2 * Math.ceil(Math.log2(count + 1));
  while (left < right) {
    if (--attempts < 0) {
      values.subarray(left, right + 1).sort();
      return values[rank];
    }
    const a = values[left],
      b = values[(left + right) >>> 1],
      c = values[right];
    const pivot =
      a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let low = left,
      cursor = left,
      high = right;
    while (cursor <= high) {
      const value = values[cursor];
      if (value < pivot) {
        values[cursor++] = values[low];
        values[low++] = value;
      } else if (value > pivot) {
        values[cursor] = values[high];
        values[high--] = value;
      } else cursor++;
    }
    if (rank < low) right = low - 1;
    else if (rank > high) left = high + 1;
    else return values[rank];
  }
  return values[rank];
}

/** Layer-isolated bloom: bright-pass event emission, then blur. Never samples imagery. */
export function renderGroundEffects(request: GroundEffectRequest) {
  const { width, height } = request;
  const heat = request.heat
    ? triangularBlur(
        splatGround(request.points, width, height, "weight"),
        width,
        height,
        request.heatRadius,
        request.heatRadiusY,
      )
    : null;
  let peak = 0;
  if (heat) for (const value of heat) peak = Math.max(peak, value);
  const ceiling =
    request.heatMaximum && request.heatMaximum > 0
      ? request.heatMaximum
      : peak || 1;
  let emission: Float64Array | null = null,
    glow: Float64Array | null = null;
  let exposure = 1;
  if (request.bloom) {
    // A narrow event footprint gives intersections more luminance than isolated
    // tracks. Count and selected time windows are retained by the Rust bins.
    emission = triangularBlur(
      splatGround(request.points, width, height, "count"),
      width,
      height,
      Math.max(1, request.bloomRadius / 4),
      Math.max(1, request.bloomRadiusY / 4),
    );
    exposure = request.bloomExposure ?? bloomExposure(emission);
    const bright = new Float64Array(emission.length);
    const threshold = Math.max(0, Math.min(1, request.bloomThreshold));
    for (let i = 0; i < bright.length; i++) {
      emission[i] = emission[i] / exposure;
      bright[i] = Math.max(0, emission[i] - threshold);
    }
    glow = triangularBlur(
      bright,
      width,
      height,
      request.bloomRadius,
      request.bloomRadiusY,
    );
    // Normalize the triangular kernel so radius changes spread energy rather
    // than explosively multiplying it. Linear/HDR values are tone mapped once.
    const kernelMass =
      (Math.floor(request.bloomRadius) + 1) *
      (Math.floor(request.bloomRadiusY) + 1);
    for (let i = 0; i < glow.length; i++) glow[i] /= kernelMass;
  }
  const image = new Uint8ClampedArray(width * height * 4);
  const emissionColor = [1, 0.23, 0.1];
  for (let i = 0; i < width * height; i++) {
    const color = heat ? heatColor(heat[i], ceiling) : [0, 0, 0, 0];
    const baseAlpha = color[3] / 255;
    const light =
      glow && emission
        ? (0.12 * emission[i] + glow[i] * request.bloomStrength) * 0.85
        : 0;
    const alpha = Math.max(baseAlpha, 1 - Math.exp(-light * 1.3));
    if (alpha < 0.002) continue;
    for (let channel = 0; channel < 3; channel++) {
      const linearBase = (color[channel] / 255) ** 2.2 * baseAlpha;
      // Hot overlap tends toward white while isolated footprints stay warm.
      const linearGlow =
        light * emissionColor[channel] + Math.max(0, light - 1) * 0.7;
      const mapped = 1 - Math.exp(-(linearBase + linearGlow));
      image[i * 4 + channel] = Math.round(
        255 * Math.min(1, mapped / alpha) ** (1 / 2.2),
      );
    }
    image[i * 4 + 3] = Math.round(alpha * 255);
  }
  return { image, peak, ceiling, exposure };
}
