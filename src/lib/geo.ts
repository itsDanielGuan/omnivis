import type { GeoPoint, MapPreset, Point } from "@/lib/types";

export function localMetersToLatLon(
  baseLat: number,
  baseLon: number,
  p: Point,
): GeoPoint {
  const metersPerDegLat = 111_320;
  const metersPerDegLon =
    111_320 * Math.cos((baseLat * Math.PI) / 180);

  return {
    lat: baseLat + p.y / metersPerDegLat,
    lon: baseLon + p.x / metersPerDegLon,
  };
}

export function latLonToLocalMeters(
  baseLat: number,
  baseLon: number,
  p: GeoPoint,
): Point {
  const metersPerDegLat = 111_320;
  const metersPerDegLon =
    111_320 * Math.cos((baseLat * Math.PI) / 180);

  return {
    x: (p.lon - baseLon) * metersPerDegLon,
    y: (p.lat - baseLat) * metersPerDegLat,
  };
}

export function toLngLat(preset: MapPreset, p: Point): [number, number] {
  const geo = localMetersToLatLon(preset.baseLat, preset.baseLon, p);
  return [geo.lon, geo.lat];
}

export function pointsToLngLat(
  preset: MapPreset,
  points: Point[],
): [number, number][] {
  return points.map((point) => toLngLat(preset, point));
}

export function closeRing(coords: [number, number][]): [number, number][] {
  if (coords.length === 0) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, first];
}

export function localCircleToLngLat(
  preset: MapPreset,
  center: Point,
  radiusM: number,
  steps = 56,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    ring.push(
      toLngLat(preset, {
        x: center.x + Math.cos(a) * radiusM,
        y: center.y + Math.sin(a) * radiusM,
      }),
    );
  }
  return closeRing(ring);
}
