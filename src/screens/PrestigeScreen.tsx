import { useEffect, useRef, useState } from 'react';
import type { Plot, PrestigeItem, Quote } from '@/contracts/game-state';
import { frameById } from '@/assets/artAssets';
import { useArtAtlas } from '@/city/useArtAtlas';
import { useDataSource } from '@/data/store';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { formatBps } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { MoneyValue } from '@/ui/MoneyValue';
import { ScreenData } from '@/ui/ScreenData';
import { StatusLabel } from '@/ui/StatusLabel';

export function PrestigeScreen() {
  return <ScreenData screen="prestige" title="Prestige">{(d) => <PrestigeView items={d.items.items} plots={d.eligiblePlots} cityId="city-bristol" />}</ScreenData>;
}

function PrestigeView({ items, plots, cityId }: { items: PrestigeItem[]; plots: Plot[]; cityId: string }) {
  const [id, setId] = useState(items[0]?.id ?? '');
  const item = items.find((i) => i.id === id);
  return (
    <div className="pe-prestige">
      <p className="pe-callout" role="note">Prestige items are cosmetic status goods bought with Empire Coins. Any boost is disclosed below with its exact size and duration. Items without finished artwork are listed but cannot be bought.</p>
      <ItemGrid items={items} selectedId={id} onSelect={setId} />
      {item && <ItemDetails key={item.id} item={item} plots={plots} cityId={cityId} />}
    </div>
  );
}

function AssetPreview({ assetId, name }: { assetId: string | null; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const atlas = useArtAtlas();
  useEffect(() => {
    const c = ref.current; const ctx = c?.getContext('2d'); const f = assetId ? frameById.get(assetId) : null;
    if (!c || !ctx || !f || atlas.status !== 'ready') return;
    const img = atlas.atlas.images.get(f.source); if (!img) return;
    const [w, h] = f.logicalSize; const k = Math.max(1, Math.floor(Math.min(112 / w, 112 / h)));
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, f.frame[0], f.frame[1], f.frame[2], f.frame[3], 0, 0, c.width, c.height);
  }, [assetId, atlas]);
  if (!assetId) return <div className="pe-art-missing" role="img" aria-label={`${name}: artwork not yet produced`}>Artwork pending</div>;
  return <canvas ref={ref} className="pe-pixel-art pe-art-preview" role="img" aria-label={`${name} preview`} />;
}

function ItemGrid({ items, selectedId, onSelect }: { items: PrestigeItem[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ul className="pe-item-grid" aria-label="Prestige items">
      {items.map((i) => (
        <li key={i.id}>
          <button type="button" className="pe-item" aria-pressed={i.id === selectedId} onClick={() => onSelect(i.id)}>
            <AssetPreview assetId={i.assetId} name={i.name} />
            <strong>{i.name}</strong>
            <MoneyValue value={i.price} tone="neutral" />
            {i.owned ? <StatusLabel tone="positive">Owned</StatusLabel> : !i.purchasable ? <StatusLabel tone="warning">Unavailable</StatusLabel> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ItemDetails({ item, plots, cityId }: { item: PrestigeItem; plots: Plot[]; cityId: string }) {
  const source = useDataSource();
  const { send, pending } = useCommand();
  const [plotId, setPlotId] = useState(plots[0]?.id ?? '');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const needsPlot = item.placement === 'plot';
  const getQuote = async () => {
    setError(null);
    const r = await source.requestQuote({ kind: 'prestige', entityId: item.id, companyId: null, side: 'buy', quantity: 1, limitPriceMinor: null, cityId });
    if (r.ok) setQuote(r.quote); else setError(r.error.message);
  };
  return (
    <section className="pe-item-details" aria-labelledby="pid-t">
      <h2 id="pid-t" className="pe-h2">{item.name}</h2>
      <p>{item.description}</p>
      <dl className="pe-stats pe-stats--wide">
        <div><dt>Price</dt><dd><MoneyValue value={item.price} tone="neutral" /></dd></div>
        <div><dt>Stock</dt><dd>{item.stockRemaining === null ? 'Unlimited' : `${item.stockRemaining} remaining`}</dd></div>
        <div><dt>Boost</dt><dd>{item.effect ? `${item.effect.description} (${formatBps(item.effect.modifierBps)}${item.effect.durationSeconds ? `, ${Math.round(item.effect.durationSeconds / 86_400)} days` : ''})` : 'None — cosmetic only'}</dd></div>
      </dl>
      {!item.purchasable ? (
        <p className="pe-callout" role="note"><strong>Unavailable:</strong> {item.unavailableReason ?? 'Not for sale.'}</p>
      ) : (
        <div className="pe-stack">
          {needsPlot && <PlacementPicker plots={plots} value={plotId} onChange={setPlotId} />}
          <Button onClick={() => void getQuote()} disabled={needsPlot && !plotId}>Get quote in EC</Button>
          {error && <p className="pe-field-error" role="alert">{error}</p>}
          {quote && (
            <div className="pe-quote"><dl><div><dt>Subtotal</dt><dd><MoneyValue value={quote.subtotal} tone="neutral" /></dd></div><div><dt>Fee</dt><dd><MoneyValue value={quote.fee} tone="neutral" /></dd></div><div className="pe-quote-total"><dt>Total</dt><dd><MoneyValue value={quote.total} tone="neutral" /></dd></div></dl>
              <Button variant="primary" block pending={pending} onClick={() => void send({ type: 'prestige.buy', itemId: item.id, plotId: needsPlot ? plotId : null, quoteId: quote.id }, { idempotencyKey: key.current, expectedRevision: quote.revision }, { success: 'Item purchased', failure: 'Item not purchased' })}>Confirm purchase</Button></div>
          )}
        </div>
      )}
    </section>
  );
}

function PlacementPicker({ plots, value, onChange }: { plots: Plot[]; value: string; onChange: (id: string) => void }) {
  if (plots.length === 0) return <p className="pe-callout" role="note">You have no plot this item can be placed on.</p>;
  return <Field label="Place on plot"><select value={value} onChange={(e) => onChange(e.target.value)}>{plots.map((p) => <option key={p.id} value={p.id}>{p.assetId ?? p.id} ({p.column}, {p.row})</option>)}</select></Field>;
}
