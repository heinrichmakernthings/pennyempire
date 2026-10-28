import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { ArtAtlas } from '@/assets/artAssets';
import { clampCamera, screenToWorld, stepZoom, zoomAt, type Camera, type Zoom } from './camera';
import { createTerrainLayer, hitTest, renderScene } from './draw';
import type { Scene } from './scene';
import { Icon } from '@/ui/Icon';

export interface CityViewportHandle { focusCompany(id: string): void }
interface Props {
  scene: Scene; atlas: ArtAtlas | null; selectedId: string | null; hoverCaption(id: string): { title: string; subtitle: string } | null;
  onSelect(id: string | null): void; registerHandle?(h: CityViewportHandle | null): void;
}
const DRAG_PX = 5;
/** Opens on the player's first business (or the map centre) so the first view is already meaningful. */
function initialCamera(scene: Scene): Camera {
  const home = scene.buildings.find((b) => b.owned);
  if (home) return { x: home.anchor[0], y: home.anchor[1] - 90, zoom: 1 };
  return { x: (scene.bounds.minX + scene.bounds.maxX) / 2, y: (scene.bounds.minY + scene.bounds.maxY) / 2, zoom: 1 };
}

/**
 * Canvas city. Camera, hover and pointer state live in refs so panning/hovering never re-renders React;
 * only zoom level (for the controls) and the hover tooltip are React state.
 */
export const CityViewport = memo(function CityViewport({ scene, atlas, selectedId, hoverCaption, onSelect, registerHandle }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>(initialCamera(scene));
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const hover = useRef<string | null>(null);
  const selected = useRef<string | null>(selectedId);
  const raf = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pinch = useRef<number | null>(null);
  const [zoom, setZoom] = useState<Zoom>(1);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const terrain = useMemo(() => createTerrainLayer(scene), [scene]);

  const draw = useCallback(() => {
    raf.current = 0;
    const c = canvas.current; const ctx = c?.getContext('2d');
    if (!c || !ctx || size.current.w === 0) return;
    renderScene(ctx, scene, atlas, terrain, { cam: cam.current, width: size.current.w, height: size.current.h, dpr: size.current.dpr }, { hoverId: hover.current, selectedId: selected.current });
  }, [scene, atlas, terrain]);
  const invalidate = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(draw); }, [draw]);
  useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  useEffect(() => { selected.current = selectedId; invalidate(); }, [selectedId, invalidate]);

  // resize → backing store follows CSS size × DPR; world geometry is unaffected
  useEffect(() => {
    const el = wrap.current; const c = canvas.current; if (!el || !c) return;
    const apply = () => {
      const r = el.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3);
      size.current = { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)), dpr };
      c.width = Math.round(size.current.w * dpr); c.height = Math.round(size.current.h * dpr);
      invalidate();
    };
    apply();
    const ro = new ResizeObserver(apply); ro.observe(el);
    return () => ro.disconnect();
  }, [invalidate]);

  const setCamera = useCallback((next: Camera) => { cam.current = clampCamera(next, scene.bounds); setZoom(cam.current.zoom); invalidate(); }, [scene.bounds, invalidate]);
  const zoomBy = useCallback((dir: 1 | -1, sx = size.current.w / 2, sy = size.current.h / 2) => {
    setCamera(zoomAt(cam.current, size.current.w, size.current.h, sx, sy, stepZoom(cam.current.zoom, dir), scene.bounds));
  }, [scene.bounds, setCamera]);

  useEffect(() => {
    registerHandle?.({
      focusCompany(id) {
        const b = scene.buildings.find((x) => x.companyId === id); if (!b) return;
        setCamera({ ...cam.current, x: b.anchor[0], y: b.anchor[1] - 80 });
      },
    });
    return () => registerHandle?.(null);
  }, [scene, registerHandle, setCamera]);

  const pick = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wy] = screenToWorld(cam.current, size.current.w, size.current.h, sx, sy);
    return { sx, sy, hit: hitTest(scene, atlas, wx, wy) };
  };

  const onPointerDown = (e: RPointerEvent) => {
    wrap.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { sx: e.clientX, sy: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
    else { drag.current = null; const [a, b] = [...pointers.current.values()]; pinch.current = Math.hypot(a!.x - b!.x, a!.y - b!.y); }
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) { // two-finger pinch: step one zoom level per ±35%
      const [a, b] = [...pointers.current.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > pinch.current * 1.35) { zoomBy(1); pinch.current = d; } else if (d < pinch.current / 1.35) { zoomBy(-1); pinch.current = d; }
      return;
    }
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_PX) d.moved = true;
      if (d.moved) { setCamera({ ...cam.current, x: d.cx - dx / cam.current.zoom, y: d.cy - dy / cam.current.zoom }); setTip(null); return; }
    }
    if (e.pointerType === 'mouse') {
      const { sx, sy, hit } = pick(e); const id = hit?.selectable ? hit.companyId : null;
      if (id !== hover.current) { hover.current = id; invalidate(); }
      setTip((t) => (id ? { id, x: sx, y: sy } : t ? null : t));
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current; pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
    if (d && !d.moved && e.type === 'pointerup') { const { hit } = pick(e); onSelect(hit?.selectable ? hit.companyId : null); }
  };
  const onPointerLeave = () => { if (hover.current) { hover.current = null; invalidate(); } setTip(null); };

  // wheel needs a non-passive listener to preventDefault
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); const now = performance.now(); if (now - last < 160) return; last = now;
      const r = el.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 192 : 64) / cam.current.zoom;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (m) { e.preventDefault(); setCamera({ ...cam.current, x: cam.current.x + m[0], y: cam.current.y + m[1] }); }
    else if (e.key === '+' || e.key === '=') zoomBy(1);
    else if (e.key === '-' || e.key === '_') zoomBy(-1);
    else if (e.key === 'Escape') onSelect(null);
  };

  const tipInfo = tip ? hoverCaption(tip.id) : null;
  return (
    <div className="pe-city-vp">
      <div ref={wrap} className="pe-city-canvas-wrap" tabIndex={0} role="application" aria-roledescription="isometric city map"
        aria-label="Bristol city map. Arrow keys pan, plus and minus zoom, Escape clears selection. The business list offers the same information as text."
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={onPointerLeave}>
        <canvas ref={canvas} className="pe-pixel-art pe-city-canvas" data-testid="city-canvas" aria-hidden="true" />
        {tip && tipInfo && <div className="pe-tooltip" style={{ left: Math.min(tip.x + 14, size.current.w - 200), top: tip.y + 14 }} role="presentation"><strong>{tipInfo.title}</strong><span>{tipInfo.subtitle}</span></div>}
      </div>
      <div className="pe-zoom" role="group" aria-label="Map zoom">
        <button type="button" className="pe-icon-btn" onClick={() => zoomBy(1)} disabled={zoom === 3} aria-label="Zoom in"><Icon name="plus" /></button>
        <output className="pe-zoom-level" aria-live="polite">{zoom}×</output>
        <button type="button" className="pe-icon-btn" onClick={() => zoomBy(-1)} disabled={zoom === 1} aria-label="Zoom out"><Icon name="minus" /></button>
      </div>
    </div>
  );
});
