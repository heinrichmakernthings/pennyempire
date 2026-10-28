import type { City, Company, Owner, Plot } from '@/contracts/game-state';
import type { MapMeta } from '@/data/types';
import { frameById } from '@/assets/artAssets';
import { computeConnectivity, type TerrainKind } from './connectivity';
import { depthKey, footprintPolygon, project, spriteAnchor, type Footprint, type Vec } from './geometry';

export interface SceneTile { column: number; row: number; kind: TerrainKind; roadMask: number; quayMask: number }
export interface SceneBuilding extends Footprint {
  plotId: string; assetId: string; companyId: string | null; name: string | null; ownerKind: Owner['kind'] | null;
  owned: boolean; selectable: boolean; anchor: Vec; polygon: Vec[]; depth2: number;
}
/** A vacant, leasable lot: no building yet, so a player can start a company here. */
export interface SceneLot extends Footprint { plotId: string; anchor: Vec; polygon: Vec[]; depth2: number }
export interface SceneProp { assetId: string; column: number; row: number; anchor: Vec; depth2: number }
export type Drawable = { type: 'building'; building: SceneBuilding; depth2: number } | { type: 'prop'; prop: SceneProp; depth2: number };

export interface Scene {
  columns: number; rows: number;
  tiles: SceneTile[];
  buildings: SceneBuilding[];
  lots: SceneLot[];
  props: SceneProp[];
  /** Back-to-front. Hit-testing walks this in reverse. */
  drawables: Drawable[];
  /** World-space bounds in logical pixels, padded for tall sprites. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Builds renderable scene data from contract DTOs (+ cosmetic MapMeta). Pure: no canvas, no React. */
export function buildScene(city: City, meta: MapMeta, companies: Pick<Company, 'id' | 'name' | 'plotId'>[], playerId: string): Scene {
  const byPlot = new Map(companies.map((c) => [c.plotId, c]));
  const termPlots = new Map<string, Plot>();
  const buildingPlots: Plot[] = [];
  for (const p of city.plots) (p.assetId ? buildingPlots : []).push(p);
  for (const p of city.plots) if (!p.assetId && p.width === 1 && p.depth === 1) termPlots.set(`${p.column},${p.row}`, p);

  const kindAt = (c: number, r: number): TerrainKind => termPlots.get(`${c},${r}`)?.terrain ?? 'paving';
  const conn = computeConnectivity(meta.columns, meta.rows, kindAt);
  const tiles: SceneTile[] = [];
  for (let r = 0; r < meta.rows; r++) for (let c = 0; c < meta.columns; c++) {
    const plot = termPlots.get(`${c},${r}`);
    // Server-supplied masks win; derived masks are the fallback so tiles and masks can never disagree silently.
    const d = conn.at(c, r);
    tiles.push({ column: c, row: r, kind: kindAt(c, r), roadMask: plot ? plot.roadMask : d.roadMask, quayMask: plot ? plot.quayMask : d.quayMask });
  }

  const buildings: SceneBuilding[] = buildingPlots.map((p) => {
    const company = p.companyId ? byPlot.get(p.id) : undefined;
    const fp: Footprint = { column: p.column, row: p.row, width: p.width, depth: p.depth };
    return {
      ...fp, plotId: p.id, assetId: p.assetId!, companyId: company?.id ?? null, name: company?.name ?? null, ownerKind: p.owner?.kind ?? null,
      owned: p.owner?.id === playerId && !!company, selectable: !!company, anchor: spriteAnchor(fp), polygon: footprintPolygon(fp), depth2: depthKey(fp) + 0.5,
    };
  });
  const lots: SceneLot[] = city.plots.filter((p) => !p.assetId && !p.companyId && (p.width > 1 || p.depth > 1)).map((p) => {
    const fp: Footprint = { column: p.column, row: p.row, width: p.width, depth: p.depth };
    return { ...fp, plotId: p.id, anchor: spriteAnchor(fp), polygon: footprintPolygon(fp), depth2: depthKey(fp) };
  });
  const props: SceneProp[] = meta.decor.map((d) => {
    const base = project(d.column, d.row);
    return { assetId: d.assetId, column: d.column, row: d.row, anchor: [base[0] + (d.offsetX ?? 0), base[1] + 32 + 8 + (d.offsetY ?? 0)] as Vec, depth2: d.column + d.row };
  });

  const drawables: Drawable[] = [
    ...buildings.map((b): Drawable => ({ type: 'building', building: b, depth2: b.depth2 })),
    ...props.map((p): Drawable => ({ type: 'prop', prop: p, depth2: p.depth2 })),
  ].sort((a, b) => a.depth2 - b.depth2 || (a.type === 'building' ? 1 : 0) - (b.type === 'building' ? 1 : 0));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const [x, y] = project(t.column, t.row);
    minX = Math.min(minX, x - 64); maxX = Math.max(maxX, x + 64); minY = Math.min(minY, y); maxY = Math.max(maxY, y + 64);
  }
  for (const b of buildings) { const f = frameById.get(b.assetId); if (f) minY = Math.min(minY, b.anchor[1] - f.pivot[1]); }
  return { columns: meta.columns, rows: meta.rows, tiles, buildings, lots, props, drawables, bounds: { minX, minY, maxX, maxY } };
}
