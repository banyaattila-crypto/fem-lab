import type { Point } from './geometry';

export interface Viewport {
  width: number;
  height: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 60 };
}

export function worldToScreen(cam: Camera, vp: Viewport, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom + vp.width / 2,
    y: vp.height / 2 - (p.y - cam.y) * cam.zoom,
  };
}

export function screenToWorld(cam: Camera, vp: Viewport, p: Point): Point {
  return {
    x: (p.x - vp.width / 2) / cam.zoom + cam.x,
    y: (vp.height / 2 - p.y) / cam.zoom + cam.y,
  };
}

export function zoomAt(cam: Camera, vp: Viewport, anchorScreen: Point, factor: number): Camera {
  const before = screenToWorld(cam, vp, anchorScreen);
  const zoom = Math.max(8, Math.min(600, cam.zoom * factor));
  const next: Camera = { ...cam, zoom };
  const after = screenToWorld(next, vp, anchorScreen);
  return { x: next.x + (before.x - after.x), y: next.y + (before.y - after.y), zoom };
}

export function fitToPoints(cam: Camera, vp: Viewport, pts: Point[], marginPx = 80): Camera {
  if (pts.length === 0) return cam;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 0.5);
  const h = Math.max(maxY - minY, 0.5);
  const zoom = Math.max(
    8,
    Math.min(600, Math.min((vp.width - 2 * marginPx) / w, (vp.height - 2 * marginPx) / h)),
  );
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom };
}
