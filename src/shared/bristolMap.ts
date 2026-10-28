import { computeConnectivity, type TerrainKind } from '@/city/connectivity';

/** Shared (client + server) Bristol district layout: 16×20, river on the east, roads on c = 4, 9 and r = 4, 9, 15. */
export const MAP_COLUMNS = 16;
export const MAP_ROWS = 20;

export interface MapBlock { plotId: string; assetId: string; column: number; row: number; width: number; depth: number; companyId: string | null; district: string }
export const MAP_BLOCKS: MapBlock[] = [
  { plotId: 'plot-farm', assetId: 'farm', column: 0, row: 1, width: 3, depth: 2, companyId: 'co-severn-farm', district: 'dist-clifton' },
  { plotId: 'plot-mill', assetId: 'mill', column: 5, row: 1, width: 3, depth: 2, companyId: 'co-brunel-mill', district: 'dist-redcliffe' },
  { plotId: 'plot-dairy', assetId: 'dairy', column: 10, row: 1, width: 3, depth: 2, companyId: 'co-clifton-dairy', district: 'dist-harbourside' },
  { plotId: 'plot-timber', assetId: 'timber', column: 0, row: 6, width: 3, depth: 2, companyId: 'co-avon-timber', district: 'dist-clifton' },
  { plotId: 'plot-warehouse', assetId: 'warehouse', column: 5, row: 6, width: 3, depth: 2, companyId: 'co-bristol-provisions', district: 'dist-redcliffe' },
  { plotId: 'plot-pizza', assetId: 'pizza', column: 10, row: 6, width: 2, depth: 2, companyId: 'co-mad-slices', district: 'dist-harbourside' },
  { plotId: 'plot-cafe', assetId: 'cafe', column: 0, row: 11, width: 2, depth: 2, companyId: 'co-harbour-bean', district: 'dist-clifton' },
  { plotId: 'plot-pizza-2', assetId: 'pizza', column: 2, row: 11, width: 2, depth: 2, companyId: 'co-clifton-slice', district: 'dist-clifton' },
  { plotId: 'plot-utility', assetId: 'utility', column: 5, row: 11, width: 2, depth: 2, companyId: 'co-bristol-energy', district: 'dist-redcliffe' },
  { plotId: 'plot-terraces', assetId: 'terraces', column: 7, row: 11, width: 2, depth: 2, companyId: null, district: 'dist-redcliffe' },
  { plotId: 'plot-cafe-2', assetId: 'cafe', column: 10, row: 11, width: 2, depth: 2, companyId: 'co-bean-there', district: 'dist-harbourside' },
];

const isRoad = (c: number, r: number) => ((c === 4 || c === 9) && r < 18) || ((r === 4 || r === 9 || r === 15) && c < 13);
const isWater = (c: number) => c >= 13;

/** Vacant building lots a player can lease to start a company. 2×2 lots fit pizza/café; 3×2 lots fit farm, mill, dairy and timber yard. */
export interface MapLot { id: string; column: number; row: number; width: number; depth: number; district: string }
export const VACANT_LOTS: MapLot[] = [
  { id: 'lot-1', column: 0, row: 13, width: 2, depth: 2, district: 'dist-clifton' }, { id: 'lot-2', column: 2, row: 13, width: 2, depth: 2, district: 'dist-clifton' },
  { id: 'lot-3', column: 5, row: 13, width: 3, depth: 2, district: 'dist-redcliffe' }, { id: 'lot-4', column: 10, row: 13, width: 3, depth: 2, district: 'dist-harbourside' },
  { id: 'lot-5', column: 0, row: 16, width: 2, depth: 2, district: 'dist-clifton' }, { id: 'lot-6', column: 2, row: 16, width: 2, depth: 2, district: 'dist-clifton' },
  { id: 'lot-7', column: 5, row: 16, width: 3, depth: 2, district: 'dist-redcliffe' }, { id: 'lot-8', column: 10, row: 16, width: 3, depth: 2, district: 'dist-harbourside' },
];
export const terrainAt = (c: number, r: number): TerrainKind => (isWater(c) ? 'water' : isRoad(c, r) ? 'road' : 'paving');

export interface MapTile { column: number; row: number; terrain: TerrainKind; roadMask: number; quayMask: number }
/** Tiles that carry information beyond default paving: roads, water and quay edges. */
export function mapTiles(): MapTile[] {
  const conn = computeConnectivity(MAP_COLUMNS, MAP_ROWS, terrainAt);
  const out: MapTile[] = [];
  for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLUMNS; c++) {
    const k = conn.at(c, r); const terrain = terrainAt(c, r);
    if (terrain === 'paving' && k.quayMask === 0) continue;
    out.push({ column: c, row: r, terrain, roadMask: k.roadMask, quayMask: k.quayMask });
  }
  return out;
}
