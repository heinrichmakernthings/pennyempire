import { phase5Url } from '@/assets/artAssets';

/** An approved Phase 5 sprite at native resolution (pixel art, never smoothed). Items without finished artwork show an honest placeholder instead of a stand-in picture. */
export function Sprite({ asset, name, max = 96 }: { asset: string | null; name: string; max?: number }) {
  const url = asset ? phase5Url(asset) : undefined;
  if (!url) return <div className="pe-art-missing" role="img" aria-label={`${name}: artwork not yet produced`} style={{ width: max, height: max }}>Artwork pending</div>;
  return <img className="pe-sprite" src={url} alt="" aria-hidden="true" loading="lazy" style={{ maxWidth: max, maxHeight: max, imageRendering: 'pixelated', objectFit: 'contain' }} />;
}
