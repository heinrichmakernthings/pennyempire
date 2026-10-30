export const ZOOM_LEVELS = [1, 2, 3] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export interface Camera { x: number; y: number; zoom: Zoom }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export const stepZoom = (z: Zoom, dir: 1 | -1): Zoom => {
  const i = ZOOM_LEVELS.indexOf(z) + dir;
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i))] as Zoom;
};

/** World → screen (CSS px). The camera centre sits at the viewport centre. */
export const worldToScreen = (cam: Camera, vw: number, vh: number, wx: number, wy: number): [number, number] => [(wx - cam.x) * cam.zoom + vw / 2, (wy - cam.y) * cam.zoom + vh / 2];
export const screenToWorld = (cam: Camera, vw: number, vh: number, sx: number, sy: number): [number, number] => [(sx - vw / 2) / cam.zoom + cam.x, (sy - vh / 2) / cam.zoom + cam.y];

/** Keeps the camera centre inside the world bounds so the city can never be dragged fully off screen. */
export function clampCamera(cam: Camera, b: Bounds): Camera {
  return { ...cam, x: Math.min(b.maxX, Math.max(b.minX, cam.x)), y: Math.min(b.maxY, Math.max(b.minY, cam.y)) };
}

/** Zoom while keeping the world point under (sx,sy) fixed on screen. */
export function zoomAt(cam: Camera, vw: number, vh: number, sx: number, sy: number, next: Zoom, b: Bounds): Camera {
  if (next === cam.zoom) return cam;
  const [wx, wy] = screenToWorld(cam, vw, vh, sx, sy);
  return clampCamera({ zoom: next, x: wx - (sx - vw / 2) / next, y: wy - (sy - vh / 2) / next }, b);
}
