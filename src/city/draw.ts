import type { ArtAtlas } from '@/assets/artAssets';
import { frameById } from '@/assets/artAssets';
import type { Camera } from './camera';
import { screenToWorld, worldToScreen } from './camera';
import { pointInPolygon, project, type Vec } from './geometry';
import type { Scene, SceneBuilding, SceneLot } from './scene';
import { uiIconUrl } from '@/assets/artAssets';
import type { CompanyActivity } from '@/shared/living';
import { activityCounts, activityIsFresh, customerMotion, WORKER_BY_INDUSTRY, type DeliveryReplay } from './activityMotion';

export const PALETTE = { water: '#23606b', waterHi: '#377887', road: '#343c40', grass: '#64724b', paving: '#80796b', seam: 'rgba(20,28,32,.18)', quay: '#b3a48b', dash: '#d6c8a6', amber: '#ffc45e', mint: '#62dbaf', cream: '#f0e8d7', bg: '#17252a' };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

function diamond(ctx: Ctx, x: number, y: number, fill: string) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 64, y + 32); ctx.lineTo(x, y + 64); ctx.lineTo(x - 64, y + 32); ctx.closePath(); ctx.fill();
}
const ROAD_ENDS: Vec[] = [[32, 48], [-32, 48], [-32, 16], [32, 16]]; // bits 1,2,4,8 → edge midpoints
const QUAY_EDGES: [Vec, Vec][] = [[[64, 32], [0, 64]], [[0, 64], [-64, 32]], [[-64, 32], [0, 0]], [[0, 0], [64, 32]]];

/** Procedural base geometry per docs/design/DESIGN-SYSTEM.md: roads connect at edge midpoints, quay follows water edges. */
function drawTile(ctx: Ctx, x: number, y: number, kind: string, roadMask: number, quayMask: number, c: number, r: number) {
  diamond(ctx, x, y, kind === 'water' ? PALETTE.water : kind === 'road' ? PALETTE.road : kind === 'grass' ? PALETTE.grass : PALETTE.paving);
  if (kind === 'paving' || kind === 'grass') { // deterministic speckle: same pixels every frame, cached once
    ctx.fillStyle = 'rgba(20,28,32,.10)';
    for (let i = 0; i < 6; i++) { const px = Math.round(x - 40 + hash(c * 7 + i, r) * 80), py = Math.round(y + 12 + hash(c, r * 5 + i) * 40); if (Math.abs(px - x) / 64 + Math.abs(py - (y + 32)) / 32 < 0.9) ctx.fillRect(px, py, 2, 1); }
  }
  ctx.strokeStyle = PALETTE.seam; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 64, y + 32); ctx.lineTo(x, y); ctx.lineTo(x + 64, y + 32); ctx.stroke();
  if (kind === 'road') {
    ctx.save(); ctx.strokeStyle = PALETTE.dash; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ROAD_ENDS.forEach(([dx, dy], i) => { if (roadMask & (1 << i)) { ctx.beginPath(); ctx.moveTo(x, y + 32); ctx.lineTo(x + dx, y + dy); ctx.stroke(); } });
    ctx.restore();
  }
  if (kind === 'water') {
    ctx.strokeStyle = PALETTE.waterHi; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - 20 + i * 10, y + 16 + i * 8); ctx.lineTo(x - 6 + i * 10, y + 16 + i * 8); ctx.stroke(); }
  }
  if (quayMask) {
    ctx.strokeStyle = PALETTE.quay; ctx.lineWidth = 5;
    QUAY_EDGES.forEach(([a, b], i) => { if (quayMask & (1 << i)) { ctx.beginPath(); ctx.moveTo(x + a[0], y + a[1]); ctx.lineTo(x + b[0], y + b[1]); ctx.stroke(); } });
  }
}

/** Pre-renders the static ground once at 1× logical pixels; per-frame work is a single cropped drawImage. */
export function createTerrainLayer(scene: Scene): { canvas: HTMLCanvasElement; originX: number; originY: number } | null {
  if (typeof document === 'undefined') return null;
  const { minX, minY, maxX, maxY } = scene.bounds;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(maxX - minX); canvas.height = Math.ceil(maxY - minY);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(-minX, -minY);
  // draw back-to-front so quay edges overlap correctly
  for (const t of [...scene.tiles].sort((a, b) => a.column + a.row - (b.column + b.row))) { const [x, y] = project(t.column, t.row); drawTile(ctx, x, y, t.kind, t.roadMask, t.quayMask, t.column, t.row); }
  return { canvas, originX: minX, originY: minY };
}

export interface ViewState { cam: Camera; width: number; height: number; dpr: number }
export interface UiState { hoverId: string | null; selectedId: string | null; selectedLotId?: string | null; activity?: Map<string, CompanyActivity>; activityReceivedAt?: number; now?: number; reducedMotion?: boolean; deliveries?: DeliveryReplay; redraw?: () => void }

/** Approved Phase 2/3 state icons, loaded once. Missing icons simply don't draw. */
const BADGE: Record<string, string> = { closed: 'state-closed', construction: 'state-construction', 'missing-inputs': 'state-missing-inputs', 'high-demand': 'state-high-demand', delivery: 'state-delivery', customers: 'state-customer-entry', production: 'state-production' };
const badgeImgs = new Map<string, HTMLImageElement | null>();
function badgeImg(state: string, redraw?: () => void): HTMLImageElement | null {
  const name = BADGE[state]; if (!name) return null;
  if (badgeImgs.has(name)) return badgeImgs.get(name)!;
  const url = uiIconUrl(name); if (!url || typeof Image === 'undefined') { badgeImgs.set(name, null); return null; }
  const img = new Image(); badgeImgs.set(name, null); img.onload = () => { badgeImgs.set(name, img); redraw?.(); }; img.src = url; return null;
}
/** Residents, vans and workers around a building; positions are a fixed function of the company and the count, so nothing jitters between frames. */
function drawActivity(ctx: CanvasRenderingContext2D, atlas: ArtAtlas | null, b: SceneBuilding, a: CompanyActivity, ox: number, oy: number, k: number, dpr: number, ui: UiState) {
  void dpr;
  const f = frameById.get(b.assetId); if (!f) return;
  const seed = [...b.plotId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const foot = (i: number, spread: number): [number, number] => [b.anchor[0] + ((hash(seed, i) - 0.5) * spread), b.anchor[1] + 6 + hash(i, seed) * 14];
  const now=ui.now??0, reduced=ui.reducedMotion??true;
  const counts=activityCounts(a,activityIsFresh(ui.activityReceivedAt,now));
  const industry=b.assetId.split('-')[0]!,worker=WORKER_BY_INDUSTRY[industry]??'warehouse-worker';
  for (let i=0;i<counts.customers;i++) {
    const p=customerMotion(i,now+seed%9600,reduced);
    drawFrame(ctx,atlas,`courier-${p.pose}-${p.direction}-${p.frame}`,ox+(b.anchor[0]+p.dx)*k,oy+(b.anchor[1]+p.dy)*k,k);
  }
  for (let i=0;i<counts.workers;i++) {
    const [x,y]=foot(10+i,40), phase=counts.working&&!reduced?(Math.floor(now/240+i)%2?'work-a':'work-b'):'idle';
    drawFrame(ctx,atlas,`${worker}-${phase}`,ox+(x-20)*k,oy+(y-8)*k,k);
  }
  const delivery=counts.vans&&!reduced?ui.deliveries?.sample(a.companyId,now):null;
  for (let i=0;i<counts.vans;i++) {
    const vehicle=industry==='farm'?'farm-pickup-sw':industry==='mill'||industry==='timber'?'lorry-sw':'delivery-van-sw';
    drawFrame(ctx,atlas,vehicle,ox+(b.anchor[0]+62+i*30+(delivery?.dx??0))*k,oy+(b.anchor[1]+30+i*6)*k,k);
  }
  if(delivery?.stage==='unload') drawFrame(ctx,atlas,`delivery-driver-load-sw-${Math.floor(now/160)%4}`,ox+(b.anchor[0]+30)*k,oy+(b.anchor[1]+27)*k,k);
  const img = badgeImg(a.state, ui.redraw);
  if (img) { const sz = 30 * k; const sx = ox + b.anchor[0] * k, sy = oy + (b.anchor[1] - f.pivot[1] - 6) * k; ctx.save(); ctx.imageSmoothingEnabled = true; if (a.state === 'closed') ctx.globalAlpha = .95; ctx.drawImage(img, Math.round(sx - sz / 2), Math.round(sy - sz), sz, sz); ctx.restore(); }
}

function drawFrame(ctx: CanvasRenderingContext2D, atlas: ArtAtlas | null, id: string, ax: number, ay: number, zoom: number): boolean {
  const f = frameById.get(id); const img = f && atlas?.images.get(f.source);
  if (!f) return false;
  const [w, h] = f.logicalSize;
  const dx = Math.round(ax - f.pivot[0] * zoom), dy = Math.round(ay - f.pivot[1] * zoom);
  if(dx+w*zoom<0||dy+h*zoom<0||dx>ctx.canvas.width||dy>ctx.canvas.height)return true;
  if (!img) { // missing asset: visible, non-crashing placeholder
    ctx.save(); ctx.strokeStyle = '#f08076'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeRect(dx, dy, w * zoom, h * zoom);
    ctx.fillStyle = '#f08076'; ctx.font = `${12 * zoom}px system-ui`; ctx.fillText(`missing: ${id}`, dx + 4, dy + 16 * zoom); ctx.restore(); return false;
  }
  ctx.drawImage(img, f.frame[0], f.frame[1], f.frame[2], f.frame[3], dx, dy, Math.round(w * zoom), Math.round(h * zoom));
  return true;
}

function strokePolygon(ctx: CanvasRenderingContext2D, poly: Vec[], view: ViewState, style: { stroke: string; fill?: string; width: number; dash?: number[] }) {
  ctx.save(); ctx.beginPath();
  poly.forEach(([x, y], i) => { const [sx, sy] = worldToScreen(view.cam, view.width, view.height, x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
  ctx.closePath();
  if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(); }
  ctx.strokeStyle = style.stroke; ctx.lineWidth = style.width; ctx.setLineDash(style.dash ?? []); ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, sx: number, sy: number, tone: 'owned' | 'selected' | 'hover', dpr: number) {
  ctx.save(); ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const padX = 8 * dpr, h = 22 * dpr, w = ctx.measureText(text).width + padX * 2;
  const x = Math.round(sx - w / 2), y = Math.round(sy - h);
  ctx.fillStyle = 'rgba(20,28,32,.92)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = tone === 'selected' ? PALETTE.amber : tone === 'owned' ? PALETTE.mint : PALETTE.cream; ctx.lineWidth = dpr; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.fillStyle = PALETTE.cream; ctx.fillText(text, Math.round(sx), y + h / 2 + dpr * .5); ctx.restore();
}

export function renderScene(ctx: CanvasRenderingContext2D, scene: Scene, atlas: ArtAtlas | null, terrain: ReturnType<typeof createTerrainLayer>, view: ViewState, ui: UiState) {
  const { cam, width, height, dpr } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PALETTE.bg; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = false;
  const k = cam.zoom * dpr;
  // Everything below is in device pixels; camera offsets are rounded so pixel art never shimmers.
  const ox = Math.round((width / 2 - cam.x * cam.zoom) * dpr), oy = Math.round((height / 2 - cam.y * cam.zoom) * dpr);

  if (terrain) {
    const { canvas, originX, originY } = terrain;
    // crop to the visible region of the cached ground layer
    const sx0 = Math.max(0, Math.floor((-ox / k) - originX)), sy0 = Math.max(0, Math.floor((-oy / k) - originY));
    const sx1 = Math.min(canvas.width, Math.ceil(((ctx.canvas.width - ox) / k) - originX)), sy1 = Math.min(canvas.height, Math.ceil(((ctx.canvas.height - oy) / k) - originY));
    if (sx1 > sx0 && sy1 > sy0) ctx.drawImage(canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, Math.round(ox + (sx0 + originX) * k), Math.round(oy + (sy0 + originY) * k), Math.round((sx1 - sx0) * k), Math.round((sy1 - sy0) * k));
  }

  // vacant lots: dashed outline so a player can see where a new company could go
  ctx.save(); ctx.scale(dpr, dpr);
  for (const l of scene.lots) {
    const on = l.plotId === ui.selectedLotId;
    strokePolygon(ctx, l.polygon, view, { stroke: on ? PALETTE.amber : PALETTE.mint, width: on ? 3 : 2, dash: [10, 6], fill: on ? 'rgba(255,196,94,.20)' : 'rgba(98,219,175,.08)' });
  }
  ctx.restore();

  // ground-level overlays under sprites
  ctx.save(); ctx.scale(dpr, dpr);
  for (const b of scene.buildings) {
    if (!b.selectable) continue;
    if (b.owned) strokePolygon(ctx, b.polygon, view, { stroke: PALETTE.mint, width: 2, dash: [8, 5] });
    if (b.companyId === ui.hoverId && b.companyId !== ui.selectedId) strokePolygon(ctx, b.polygon, view, { stroke: PALETTE.cream, width: 2, dash: [6, 4], fill: 'rgba(240,232,215,.10)' });
    if (b.companyId === ui.selectedId) strokePolygon(ctx, b.polygon, view, { stroke: PALETTE.amber, width: 3, fill: 'rgba(255,196,94,.18)' });
  }
  ctx.restore();

  for (const d of scene.drawables) {
    const [wx, wy] = d.type === 'building' ? d.building.anchor : d.prop.anchor;
    const id = d.type === 'building' ? d.building.assetId : d.prop.assetId;
    const isClosed=d.type==='building'&&d.building.companyId&&ui.activity?.get(d.building.companyId)?.state==='closed';
    ctx.save();if(isClosed)ctx.filter='brightness(0.45) saturate(0.35)';
    drawFrame(ctx, atlas, id, ox + wx * k, oy + wy * k, k);ctx.restore();
    if (d.type === 'building' && d.building.companyId) {
      const a = ui.activity?.get(d.building.companyId);
      if (a) {
        if (a.state === 'closed') { ctx.save(); ctx.scale(dpr, dpr); strokePolygon(ctx, d.building.polygon, view, { stroke: '#8a8f93', width: 2, fill: 'rgba(30,34,38,.45)', dash: [4, 4] }); ctx.restore(); }
        drawActivity(ctx, atlas, d.building, a, ox, oy, k, dpr, ui);
      }
    }
  }

  // selection ring above sprites so the selected plot is unmistakable even behind tall roofs
  const sel = scene.buildings.find((b) => b.selectable && b.companyId === ui.selectedId);
  if (sel) { ctx.save(); ctx.scale(dpr, dpr); strokePolygon(ctx, sel.polygon, view, { stroke: PALETTE.amber, width: 2, dash: [10, 6] }); ctx.restore(); }

  for (const l of scene.lots) {
    const [sx, sy] = worldToScreen(cam, width, height, l.anchor[0], l.anchor[1] - 28);
    label(ctx, l.plotId === ui.selectedLotId ? 'For lease · selected' : 'For lease', sx * dpr, sy * dpr, l.plotId === ui.selectedLotId ? 'selected' : 'hover', dpr);
  }
  // labels last, screen space
  const nameplates = scene.buildings.filter((b) => b.selectable && (b.owned || b.companyId === ui.hoverId || b.companyId === ui.selectedId));
  for (const b of nameplates) {
    const f = frameById.get(b.assetId); if (!f || !b.name) continue;
    const [sx, sy] = worldToScreen(cam, width, height, b.anchor[0], b.anchor[1] - f.pivot[1] + 24);
    const sel = b.companyId === ui.selectedId;
    label(ctx, b.owned ? `${b.name} · yours` : b.name, sx * dpr, sy * dpr, sel ? 'selected' : b.owned ? 'owned' : 'hover', dpr);
  }
}

/** Plot-geometry hit test (footprint diamond) plus opaque sprite pixels, front-to-back so nearer buildings win. */
export function hitTest(scene: Scene, atlas: ArtAtlas | null, wx: number, wy: number): SceneBuilding | null {
  for (let i = scene.drawables.length - 1; i >= 0; i--) {
    const d = scene.drawables[i]!;
    if (d.type !== 'building') continue;
    const b = d.building;
    if (pointInPolygon([wx, wy], b.polygon)) return b;
    const f = frameById.get(b.assetId); const a = atlas?.alpha(b.assetId);
    if (f && a) {
      const lx = Math.floor(wx - (b.anchor[0] - f.pivot[0])), ly = Math.floor(wy - (b.anchor[1] - f.pivot[1]));
      if (lx >= 0 && ly >= 0 && lx < a.width && ly < a.height && (a.data[(ly * a.width + lx) * 4 + 3] ?? 0) > 24) return b;
    }
  }
  return null;
}

export const viewToWorld = (view: ViewState, sx: number, sy: number) => screenToWorld(view.cam, view.width, view.height, sx, sy);

/** Vacant-lot hit test: the footprint diamond only (there is no sprite). Buildings are tested first by the caller. */
export function hitLot(scene: Scene, wx: number, wy: number): SceneLot | null {
  for (const l of scene.lots) if (pointInPolygon([wx, wy], l.polygon)) return l;
  return null;
}
