export type TerrainKind = 'paving' | 'road' | 'water' | 'grass';
export interface TileConnectivity { roadMask: number; quayMask: number }

/** Adjacency bits shared with docs/design/DESIGN-SYSTEM.md: +column=1, +row=2, -column=4, -row=8. */
export const BIT_PLUS_COLUMN = 1, BIT_PLUS_ROW = 2, BIT_MINUS_COLUMN = 4, BIT_MINUS_ROW = 8;
const DIRS: [number, number, number][] = [[1, 0, BIT_PLUS_COLUMN], [0, 1, BIT_PLUS_ROW], [-1, 0, BIT_MINUS_COLUMN], [0, -1, BIT_MINUS_ROW]];

/**
 * Derives road connections (road→road) and quay edges (non-water tile facing water) from terrain alone,
 * so masks can never disagree with the tile grid. A server may later supply the same masks in Plot.roadMask / quayMask.
 */
export function computeConnectivity(columns: number, rows: number, kindAt: (c: number, r: number) => TerrainKind) {
  const masks = new Map<number, TileConnectivity>();
  const key = (c: number, r: number) => r * columns + c;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const kind = kindAt(c, r);
    let roadMask = 0, quayMask = 0;
    for (const [dc, dr, bit] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const nk = kindAt(nc, nr);
      if (kind === 'road' && nk === 'road') roadMask |= bit;
      if (kind !== 'water' && nk === 'water') quayMask |= bit;
    }
    masks.set(key(c, r), { roadMask, quayMask });
  }
  return { at: (c: number, r: number): TileConnectivity => masks.get(key(c, r)) ?? { roadMask: 0, quayMask: 0 } };
}
