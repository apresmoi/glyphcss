type Point = readonly [number, number];

/** Weak source-vertex identity avoids retaining camera-generated coordinates. */
export function createGlyphMapGroundReadCache<T>() {
  let samples = new WeakMap<Point, { lon: number; lat: number; value: T }>();
  let key: readonly unknown[] = [];
  return (read: (point: Point) => T, nextKey: readonly unknown[]) => {
    if (key.length !== nextKey.length || key.some((v, i) => v !== nextKey[i])) samples = new WeakMap();
    key = nextKey;
    const retained = samples;
    return (point: Point): T => {
      let sample = retained.get(point);
      if (!sample || sample.lon !== point[0] || sample.lat !== point[1]) {
        sample = { lon: point[0], lat: point[1], value: read(point) };
        retained.set(point, sample);
      }
      return sample.value;
    };
  };
}
