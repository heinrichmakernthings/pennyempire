import { depthKey, footprintPolygon, pointInPolygon, project, spriteAnchor, tileAt, unproject } from './geometry';
import { computeConnectivity, BIT_MINUS_COLUMN, BIT_MINUS_ROW, BIT_PLUS_COLUMN, BIT_PLUS_ROW } from './connectivity';

describe('isometric geometry (2:1, 128×64)', () => {
  it('projects per the design system', () => {
    expect(project(0, 0)).toEqual([0, 0]);
    expect(project(1, 0)).toEqual([64, 32]);
    expect(project(0, 1)).toEqual([-64, 32]);
    expect(project(3, 2)).toEqual([64, 160]);
  });
  it('unproject inverts project', () => {
    for (const [c, r] of [[0, 0], [5, 2], [2, 9], [13, 13]] as const) { const [x, y] = project(c, r); expect(unproject(x, y)).toEqual([c, r]); }
  });
  it('tileAt picks the tile whose diamond contains the point', () => {
    const [x, y] = project(4, 6);
    expect(tileAt(x, y + 32)).toEqual([4, 6]); // diamond centre
    expect(tileAt(x + 30, y + 32)).toEqual([4, 6]);
    expect(tileAt(x, y + 70)).toEqual([5, 7]);
  });
  it('footprint polygons contain their centre and exclude neighbours', () => {
    const poly = footprintPolygon({ column: 10, row: 6, width: 2, depth: 2 });
    const [cx, cy] = project(11, 7);
    expect(pointInPolygon([cx, cy + 32], poly)).toBe(true);
    expect(pointInPolygon([cx + 400, cy], poly)).toBe(false);
  });
  it('sprites are centred on the footprint with their base 8px above the south vertex', () => {
    const f = { column: 3, row: 3, width: 2, depth: 2 };
    const [x, y] = spriteAnchor(f);
    expect(x).toBe(project(4, 4)[0]);
    expect(y).toBe(project(5, 5)[1] - 8); // south vertex of the 2×2 block, minus SPRITE_BASE_INSET
    expect(spriteAnchor({ column: 0, row: 0, width: 3, depth: 2 })[0]).toBe(32); // 3×2 centre is half a tile right of the origin
  });
  it('depth key orders front buildings later', () => {
    expect(depthKey({ column: 10, row: 6, width: 2, depth: 2 })).toBeGreaterThan(depthKey({ column: 5, row: 1, width: 3, depth: 2 }));
  });
});

describe('road and quay connectivity masks', () => {
  const kinds = (c: number, r: number) => (c === 2 ? 'road' : r === 2 && c <= 2 ? 'road' : c === 4 ? 'water' : 'paving') as 'road' | 'water' | 'paving';
  const conn = computeConnectivity(5, 5, kinds);
  it('connects road tiles at edge midpoints using the documented bits', () => {
    expect(conn.at(2, 1).roadMask).toBe(BIT_PLUS_ROW | BIT_MINUS_ROW); // vertical run
  });
  it('junction has all expected bits', () => { expect(conn.at(2, 2).roadMask).toBe(BIT_PLUS_ROW | BIT_MINUS_ROW | BIT_MINUS_COLUMN); });
  it('quay edges appear only on land tiles facing water', () => {
    expect(conn.at(3, 0).quayMask).toBe(BIT_PLUS_COLUMN);
    expect(conn.at(4, 0).quayMask).toBe(0); // water itself
    expect(conn.at(0, 0).quayMask).toBe(0);
  });
  it('is symmetric for roads: if A links to B, B links back', () => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      if (kinds(c, r) === 'road' && kinds(c + 1, r) === 'road') { expect(conn.at(c, r).roadMask & BIT_PLUS_COLUMN).toBeTruthy(); expect(conn.at(c + 1, r).roadMask & BIT_MINUS_COLUMN).toBeTruthy(); }
    }
  });
});
