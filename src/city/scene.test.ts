import { city, companies, mapMeta, player } from '@/data/fixtures/bristol';
import { frameById } from '@/assets/artAssets';
import { hitTest } from './draw';
import { project } from './geometry';
import { buildScene } from './scene';
import { clampCamera, screenToWorld, stepZoom, worldToScreen, zoomAt } from './camera';

const scene = buildScene(city, mapMeta, companies, player.id);

describe('scene model', () => {
  it('places all nine buildings, six selectable companies, two owned', () => {
    expect(scene.buildings).toHaveLength(9);
    expect(scene.buildings.filter((b) => b.selectable)).toHaveLength(6);
    expect(scene.buildings.filter((b) => b.owned).map((b) => b.name).sort()).toEqual(['Harbour Bean', 'Mad Slices']);
  });
  it('uses scenery buildings (warehouse, utility, terraces) as non-selectable occluders', () => {
    for (const id of ['warehouse', 'utility', 'terraces']) expect(scene.buildings.find((b) => b.assetId === id)?.selectable).toBe(false);
  });
  it('sorts drawables back-to-front by depth', () => {
    const keys = scene.drawables.map((d) => d.depth2);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });
  it('a building in front is drawn after one behind it', () => {
    const idx = (asset: string) => scene.drawables.findIndex((d) => d.type === 'building' && d.building.assetId === asset);
    expect(idx('pizza')).toBeGreaterThan(idx('mill'));
    expect(idx('cafe')).toBeGreaterThan(idx('timber'));
  });
  it('terrain: water on the east, roads connected, quay edges facing the water', () => {
    expect(scene.tiles.filter((t) => t.kind === 'water').every((t) => t.column >= 13)).toBe(true);
    const quay = scene.tiles.filter((t) => t.quayMask !== 0 && t.kind !== 'water');
    expect(quay.length).toBeGreaterThan(10);
    expect(quay.every((t) => t.column === 12 && (t.quayMask & 1) === 1)).toBe(true);
    expect(scene.tiles.find((t) => t.column === 4 && t.row === 4)?.roadMask).toBe(15); // crossroads
  });
  it('every sprite used by the scene has a manifest frame', () => {
    for (const b of scene.buildings) expect(frameById.has(b.assetId)).toBe(true);
    for (const p of scene.props) expect(frameById.has(p.assetId)).toBe(true);
  });
});

describe('hit testing by plot geometry', () => {
  const pizza = scene.buildings.find((b) => b.assetId === 'pizza')!;
  it('selects the building whose footprint contains the point', () => {
    const [x, y] = project(pizza.column + 1, pizza.row + 1);
    expect(hitTest(scene, null, x, y + 32)?.companyId).toBe('co-mad-slices');
  });
  it('returns null over empty road, water and out-of-map points', () => {
    const [rx, ry] = project(4, 9); expect(hitTest(scene, null, rx, ry + 32)).toBeNull();
    const [wx, wy] = project(14, 4); expect(hitTest(scene, null, wx, wy + 32)).toBeNull();
    expect(hitTest(scene, null, 99_999, 99_999)).toBeNull();
  });
  it('scenery returns a non-selectable hit so it blocks selection behind it', () => {
    const w = scene.buildings.find((b) => b.assetId === 'warehouse')!;
    const [x, y] = project(w.column + 1, w.row + 1);
    const hit = hitTest(scene, null, x, y + 32);
    expect(hit?.selectable).toBe(false);
  });
  it('picks every selectable company at its footprint centre', () => {
    for (const b of scene.buildings.filter((x) => x.selectable)) {
      const [x, y] = project(b.column + b.width / 2 + b.depth / 2 - b.depth / 2, b.row + b.depth / 2);
      const hit = hitTest(scene, null, ((b.column + b.width / 2) - (b.row + b.depth / 2)) * 64, ((b.column + b.width / 2) + (b.row + b.depth / 2)) * 32);
      expect(hit?.plotId, b.assetId).toBe(b.plotId); void x; void y;
    }
  });
});

describe('camera', () => {
  const b = { minX: -1000, minY: 0, maxX: 1000, maxY: 1000 };
  it('zoom snaps to 1×/2×/3×', () => { expect(stepZoom(1, -1)).toBe(1); expect(stepZoom(1, 1)).toBe(2); expect(stepZoom(2, 1)).toBe(3); expect(stepZoom(3, 1)).toBe(3); });
  it('screen/world conversion round-trips', () => {
    const cam = { x: 120, y: 340, zoom: 2 as const };
    const [sx, sy] = worldToScreen(cam, 800, 600, 200, 400);
    expect(screenToWorld(cam, 800, 600, sx, sy)).toEqual([200, 400]);
  });
  it('zooming keeps the point under the cursor fixed', () => {
    const cam = { x: 0, y: 500, zoom: 1 as const };
    const before = screenToWorld(cam, 800, 600, 600, 200);
    const next = zoomAt(cam, 800, 600, 600, 200, 2, b);
    const after = screenToWorld(next, 800, 600, 600, 200);
    expect(after[0]).toBeCloseTo(before[0]); expect(after[1]).toBeCloseTo(before[1]);
  });
  it('clamps panning to the world bounds', () => { expect(clampCamera({ x: 9_999, y: -9_999, zoom: 1 }, b)).toEqual({ x: 1000, y: 0, zoom: 1 }); });
});
