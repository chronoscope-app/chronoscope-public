/** Latitude sampling for geographic and Web Mercator image rows. */
export function latitudeAt(north: number, south: number, fraction: number, mercatorRows: boolean) {
  if (!mercatorRows) return north + (south - north) * fraction;
  const y = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 360));
  return Math.atan(Math.sinh(y(north) + (y(south) - y(north)) * fraction)) * 180 / Math.PI;
}
