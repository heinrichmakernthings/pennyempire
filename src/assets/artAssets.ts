import manifestJson from '@art/runtime/manifest.json';
import phase2Json from '@art/phase2/manifest.json';

/** Typed view of assets/art/runtime/manifest.json — the single source of truth for atlas frames. No hard-coded offsets elsewhere. */
export interface AtlasFrame {
  id: string;
  source: string;
  sourceSize: [number, number];
  frame: [number, number, number, number];
  logicalSize: [number, number];
  pivot: [number, number];
  footprint: [number, number];
  usage: 'building' | 'prop' | 'inventory' | 'actor';
  status: string;
  productionCertified: boolean;
}
interface Manifest { version: number; tile: [number, number]; assets: AtlasFrame[]; missing: string[]; excluded: string[] }
const base = manifestJson as unknown as Manifest;
/** Phase 2 adds the tier-2/3 building frames (pizza-t2 …) used by premises upgrades. Base frames always win on an id clash. */
const phase2 = (phase2Json as unknown as Manifest).assets.filter((a) => a.usage === 'building' && !base.assets.some((b) => b.id === a.id));
export const manifest: Manifest = { ...base, assets: [...base.assets, ...phase2] };
export const frameById = new Map(manifest.assets.map((a) => [a.id, a]));
export const hasFrame = (id: string) => frameById.has(id);

/** Only atlas sources the manifest references are bundled; the excluded study/terrain sheets are never emitted. */
const sourceUrls = import.meta.glob(
  ['/assets/art/source/*.png', '!/assets/art/source/connections-study.png', '!/assets/art/source/terrain-sheet.png', '/assets/art/phase2/runtime/building-atlas.png'],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

const iconUrls = import.meta.glob(['/assets/art/ui/*.svg', '/assets/art/phase3/ui/*.svg', '/assets/art/phase2/ui/*.svg', '/assets/art/phase4/ui/*.svg', '/assets/art/phase6/ui/*.svg'], { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** UI icons: the base terminal set first, then the Phase 3 economy icons, then the Phase 2 state icons. */
export const uiIconUrl = (name: string): string | undefined => iconUrls[`/assets/art/ui/${name}.svg`] ?? iconUrls[`/assets/art/phase3/ui/${name}.svg`] ?? iconUrls[`/assets/art/phase2/ui/${name}.svg`] ?? iconUrls[`/assets/art/phase4/ui/${name}.svg`] ?? iconUrls[`/assets/art/phase6/ui/${name}.svg`];

export interface ArtAtlas {
  images: Map<string, HTMLImageElement>;
  /** Source files that failed to load; frames from them render as a visible placeholder instead of crashing. */
  failedSources: string[];
  alpha(id: string): { data: Uint8ClampedArray; width: number; height: number } | null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

export async function loadArtAtlas(frameIds?: string[]): Promise<ArtAtlas> {
  const wanted = frameIds ? manifest.assets.filter((a) => frameIds.includes(a.id)) : manifest.assets;
  const sources = [...new Set(wanted.map((a) => a.source))];
  const images = new Map<string, HTMLImageElement>();
  const failedSources: string[] = [];
  await Promise.all(sources.map(async (src) => {
    const url = sourceUrls[`/${src}`];
    try {
      if (!url) throw new Error('not bundled');
      images.set(src, await loadImage(url));
    } catch { failedSources.push(src); }
  }));
  const alphaCache = new Map<string, { data: Uint8ClampedArray; width: number; height: number } | null>();
  return {
    images, failedSources,
    alpha(id) {
      if (alphaCache.has(id)) return alphaCache.get(id) ?? null;
      const f = frameById.get(id); const img = f && images.get(f.source);
      let result: { data: Uint8ClampedArray; width: number; height: number } | null = null;
      if (f && img && typeof document !== 'undefined') {
        try {
          const [w, h] = f.logicalSize;
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, f.frame[0], f.frame[1], f.frame[2], f.frame[3], 0, 0, w, h);
            result = { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
          }
        } catch { result = null; }
      }
      alphaCache.set(id, result);
      return result;
    },
  };
}

const commodityPngs = import.meta.glob('/assets/art/phase3/runtime/commodities/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** Engine commodity id → Phase 3 icon file (the art uses `coffee-drinks` for the engine's `cafe-drink`). */
const COMMODITY_ICON_FILE: Record<string, string> = { 'cafe-drink': 'coffee-drinks' };
export const commodityIconUrl = (id: string): string | undefined => commodityPngs[`/assets/art/phase3/runtime/commodities/${COMMODITY_ICON_FILE[id] ?? id}.png`];

/** Approved Phase 5 institution sprites (static, native size). Only the ones the exchange screens use are bundled. */
const phase5Pngs = import.meta.glob('/assets/art/phase5/runtime/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
export const phase5Url = (id: string): string | undefined => phase5Pngs[`/assets/art/phase5/runtime/${id}.png`];
/** Which approved institution sprite represents a state-owned company on the exchange. */
export const STATE_SPRITE: Record<string, string> = { 'co-bristol-energy': 'penny-energy', 'co-bristol-estates': 'central-property', 'co-bristol-media': 'penny-ads', 'co-national-bank': 'national-bank', 'co-penny-exchange': 'penny-exchange', 'co-penny-logistics': 'penny-logistics' };

/** Approved Phase 6 economy-event icons, by event type; Penny Post kinds map to the same set. */
export const EVENT_ICON: Record<string, string> = { energy_shortage: 'energy-crisis', inflation_shock: 'inflation', recession: 'market-crash', government_stimulus: 'stimulus', consumer_boom: 'spending', tourism_surge: 'spending', supply_chain_disruption: 'route-broken', construction_boom: 'construction', credit_crunch: 'bankruptcy', corporate_scandal: 'bankruptcy', agricultural_disruption: 'route-broken', advertising_boom: 'spending' };
