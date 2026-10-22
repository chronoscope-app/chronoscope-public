import { triangularBlur, heatColor } from "./display-math";
self.onmessage = (event: MessageEvent) => {
  const { id, planes, width, height, radius, radiusY, max } = event.data;
  const values = planes.map(
    (points: { x: number; y: number; weight: number }[]) => {
      const image = new Float64Array(width * height);
      for (const p of points) {
        const x = p.x * (width - 1),
          y = p.y * (height - 1),
          a = Math.floor(x),
          b = Math.floor(y),
          fx = x - a,
          fy = y - b;
        for (const [dx, dy, w] of [
          [0, 0, (1 - fx) * (1 - fy)],
          [1, 0, fx * (1 - fy)],
          [0, 1, (1 - fx) * fy],
          [1, 1, fx * fy],
        ])
          if (a + dx >= 0 && a + dx < width && b + dy >= 0 && b + dy < height)
            image[(b + dy) * width + a + dx] += p.weight * w;
      }
      return triangularBlur(image, width, height, radius, radiusY);
    },
  );
  let peak = 0;
  for (const v of values) for (const x of v) peak = Math.max(peak, x);
  const ceiling = max || peak || 1;
  const images = values.map((v: Float64Array) => {
    const image = new Uint8ClampedArray(v.length * 4);
    for (let i = 0; i < v.length; i++)
      image.set(heatColor(v[i], ceiling), i * 4);
    return image;
  });
  self.postMessage(
    { id, images, peak, ceiling },
    { transfer: images.map((x: Uint8ClampedArray) => x.buffer) },
  );
};
