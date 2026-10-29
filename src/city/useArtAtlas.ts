import { useCallback, useEffect, useState } from 'react';
import { loadArtAtlas, type ArtAtlas } from '@/assets/artAssets';

let cached: Promise<ArtAtlas> | null = null;
/** Decodes the atlas sources once per page load and shares the result. Partial failures are reported, not thrown. */
export function useArtAtlas() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; atlas: ArtAtlas } | { status: 'error'; message: string }>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    cached ??= loadArtAtlas();
    cached.then((atlas) => {
      if (!live) return;
      if (atlas.images.size === 0) { cached = null; setState({ status: 'error', message: 'None of the city artwork could be loaded.' }); } else setState({ status: 'ready', atlas });
    }).catch((e: unknown) => { cached = null; if (live) setState({ status: 'error', message: e instanceof Error ? e.message : 'Artwork failed to load.' }); });
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => { cached = null; setAttempt((n) => n + 1); }, []);
  return { ...state, retry };
}
