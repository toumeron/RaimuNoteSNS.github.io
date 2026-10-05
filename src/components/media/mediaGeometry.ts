export type Point = { x: number; y: number };
export function containSize(width: number, height: number, naturalWidth: number, naturalHeight: number) {
  const ratio = Math.min(width / (naturalWidth || width), height / (naturalHeight || height));
  return { width: (naturalWidth || width) * ratio, height: (naturalHeight || height) * ratio };
}
export function clampPan(point: Point, image: { width: number; height: number }, viewport: { width: number; height: number }, zoom: number): Point {
  const x = Math.max(0, (image.width * zoom - viewport.width) / 2);
  const y = Math.max(0, (image.height * zoom - viewport.height) / 2);
  return { x: Math.max(-x, Math.min(x, point.x)), y: Math.max(-y, Math.min(y, point.y)) };
}
export function focalPan(pan: Point, oldZoom: number, newZoom: number, focal: Point): Point {
  const ratio = newZoom / oldZoom;
  return { x: focal.x - (focal.x - pan.x) * ratio, y: focal.y - (focal.y - pan.y) * ratio };
}

// Ignore finger jitter and soften scaling while retaining the full zoom range.
export function pinchZoom(startZoom: number, startDistance: number, distance: number) {
  if (startDistance < 40 || Math.abs(distance - startDistance) < 6) return startZoom;
  return Math.min(12, Math.max(1, startZoom * Math.pow(distance / startDistance, .7)));
}
