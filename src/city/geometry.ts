/** 2:1 orthographic grid. project(c,r) = ((c-r)*64, (c+r)*32) — the TOP vertex of tile (c,r). World units are logical pixels. */
export const TILE_W = 128;
export const TILE_H = 64;
export type Vec = [number, number];

export const project = (c: number, r: number): Vec => [(c - r) * (TILE_W / 2), (c + r) * (TILE_H / 2)];

/** Inverse of project for a world point; returns fractional tile coordinates measured from the tile's top vertex. */
export const unproject = (x: number, y: number): Vec => {
  const a = x / (TILE_W / 2), b = y / (TILE_H / 2); // a = c-r, b = c+r
  return [(a + b) / 2, (b - a) / 2];
};

/** Tile (integer c,r) under a world point, using the tile's diamond (so a point is in exactly one tile). */
export const tileAt = (x: number, y: number): Vec => {
  const [fc, fr] = unproject(x, y); // a point inside tile (c,r) has fractional coords in [c,c+1) × [r,r+1)
  return [Math.floor(fc), Math.floor(fr)];
};

export interface Footprint { column: number; row: number; width: number; depth: number }

/** Diamond covering a w×d footprint: top, right, bottom, left vertices. */
export function footprintPolygon(f: Footprint): [Vec, Vec, Vec, Vec] {
  return [project(f.column, f.row), project(f.column + f.width, f.row), project(f.column + f.width, f.row + f.depth), project(f.column, f.row + f.depth)];
}

export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Building bases are ~87–90% of their footprint diamond (224/256 for 2×2, 288/320 for 3×2), i.e. inset ~8px from the south vertex. */
export const SPRITE_BASE_INSET = 8;
/**
 * Sprite anchor for a footprint: horizontally centred on the footprint, bottom of the sprite's visible base sitting
 * SPRITE_BASE_INSET px above the footprint's south vertex. Pivots are 'southern visible edge' per the manifest.
 */
export function spriteAnchor(f: Footprint): Vec {
  const x = (f.column + f.width / 2 - (f.row + f.depth / 2)) * (TILE_W / 2);
  const y = (f.column + f.width + f.row + f.depth) * (TILE_H / 2) - SPRITE_BASE_INSET;
  return [x, y];
}

/** Painter's-order key: sprites whose front tile is further south-east are drawn later. */
export const depthKey = (f: Footprint): number => f.column + f.width - 1 + (f.row + f.depth - 1);
