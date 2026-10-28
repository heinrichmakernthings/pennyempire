import { useMemo, useState } from 'react';
import type { ContractOptions, Holding } from '@/data/exchangeClient';
import { newIdempotencyKey, useCommand } from '@/data/useCommand';
import { formatMoney, formatUnits, parseDecimalToMinor } from '@/domain/money';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';

const ec = (minor: number) => formatMoney({ currency: 'EC', minor });

/** Propose a recurring supply contract. The counterparty answers by its published rules; the reason is shown either way. */
export function ContractForm({ commodityId, unit, options, holdings, presetSupplierId, onDone }: { commodityId: string; unit: string; options: ContractOptions; holdings: Holding[]; presetSupplierId?: string; onDone: () => void }) {
  const { send, pending } = useCommand();
  const [role, setRole] = useState<'buyer' | 'supplier'>('buyer');
  const [companyId, setCompanyId] = useState(holdings[0]?.companyId ?? '');
  const parties = role === 'buyer' ? options.suppliers.map((s) => ({ id: s.companyId, name: s.name, hint: `makes ${formatUnits(s.dailyOutput)}/day · asks ${ec(s.askMinor)} · contracts up to ${formatUnits(s.maxPerDay)}/day`, ref: s.askMinor })) : options.buyers.map((b) => ({ id: b.companyId, name: b.name, hint: `needs ${formatUnits(b.dailyNeed)}/day · contracts up to ${formatUnits(b.maxPerDay)}/day`, ref: options.referencePriceMinor }));
  const [other, setOther] = useState(presetSupplierId ?? '');
  const chosen = parties.find((p) => p.id === other) ?? parties[0];
  const [qty, setQty] = useState('40'); const [price, setPrice] = useState(((chosen?.ref ?? options.referencePriceMinor) / 100).toFixed(2));
  const [every, setEvery] = useState('2'); const [dur, setDur] = useState('20');
  const [key, setKey] = useState(newIdempotencyKey);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const q = Number(qty), p = parseDecimalToMinor(price), e = Number(every), d = Number(dur);
  const deliveries = Number.isInteger(e) && e > 0 && Number.isInteger(d) ? Math.floor(d / e) : 0;
  const per = p !== null && Number.isInteger(q) ? q * p : 0;
  const errs = useMemo(() => {
    const o: Record<string, string> = {};
    if (!Number.isInteger(q) || q <= 0) o.qty = 'Whole units, at least 1.';
    if (p === null || p <= 0) o.price = 'Enter a price such as 0.65.';
    if (!Number.isInteger(e) || e < 1 || e > 30) o.every = 'Every 1–30 days.';
    if (!Number.isInteger(d) || d < e || d > options.limits.maxTicks) o.dur = `Between the interval and ${options.limits.maxTicks} days.`;
    return o;
  }, [q, p, e, d, options.limits.maxTicks]);
  const submit = async () => {
    if (Object.keys(errs).length || !chosen) return;
    setMsg(null);
    const res = await send({ type: 'contract.propose', companyId, counterpartyId: chosen.id, role, commodityId, qtyPerDelivery: q, priceMinor: p!, everyTicks: e, durationTicks: d }, { idempotencyKey: key, expectedRevision: 0 }, { success: 'Contract agreed', failure: 'Contract not agreed' });
    setKey(newIdempotencyKey());
    if (res?.ok) { setMsg({ tone: 'ok', text: (res as unknown as { data?: { reason: string } }).data?.reason ?? 'Contract agreed.' }); onDone(); }
    else if (res && !res.ok) setMsg({ tone: 'bad', text: res.error.message });
  };
  if (holdings.length === 0) return <p className="pe-callout" role="note">You need a company before you can sign a supply contract.</p>;
  return (
    <form className="pe-stack" onSubmit={(ev) => { ev.preventDefault(); void submit(); }} aria-label="Propose supply contract" data-testid="contract-form">
      <div className="pe-seg" role="group" aria-label="Your role"><button type="button" aria-pressed={role === 'buyer'} onClick={() => { setRole('buyer'); setOther(''); }}>I buy</button><button type="button" aria-pressed={role === 'supplier'} onClick={() => { setRole('supplier'); setOther(''); }}>I supply</button></div>
      <Field label="Your company"><select value={companyId} onChange={(ev) => { setCompanyId(ev.target.value); setKey(newIdempotencyKey()); }}>{holdings.map((h) => <option key={h.companyId} value={h.companyId}>{h.companyName}</option>)}</select></Field>
      <Field label={role === 'buyer' ? 'Supplier' : 'Buyer'} hint={chosen?.hint}><select value={chosen?.id ?? ''} onChange={(ev) => { setOther(ev.target.value); const c = parties.find((x) => x.id === ev.target.value); if (c) setPrice((c.ref / 100).toFixed(2)); setKey(newIdempotencyKey()); }} data-testid="contract-party">{parties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      {parties.length === 0 && <p className="pe-callout" role="note">Nobody can {role === 'buyer' ? 'supply' : 'use'} this commodity under contract right now.</p>}
      <div className="pe-row">
        <Field label={`${unit}s per delivery`} error={errs.qty}><input inputMode="numeric" value={qty} onChange={(ev) => { setQty(ev.target.value); setKey(newIdempotencyKey()); }} data-testid="contract-qty" /></Field>
        <Field label="Price per unit (EC)" error={errs.price}><input inputMode="decimal" value={price} onChange={(ev) => { setPrice(ev.target.value); setKey(newIdempotencyKey()); }} data-testid="contract-price" /></Field>
      </div>
      <div className="pe-row">
        <Field label="Deliver every (days)" error={errs.every}><input inputMode="numeric" value={every} onChange={(ev) => { setEvery(ev.target.value); setKey(newIdempotencyKey()); }} /></Field>
        <Field label="Contract lasts (days)" error={errs.dur}><input inputMode="numeric" value={dur} onChange={(ev) => { setDur(ev.target.value); setKey(newIdempotencyKey()); }} /></Field>
      </div>
      <dl className="pe-review">
        <dt>Value of each delivery</dt><dd>{ec(per)}</dd>
        <dt>Deliveries over the contract</dt><dd>{deliveries}</dd>
        <dt className="pe-total">Total commitment</dt><dd className="pe-total">{ec(per * deliveries)}</dd>
      </dl>
      <p className="pe-hint">Each delivery settles on its day: goods and coins move together, the supplier pays the exchange fee. If the supplier lacks stock, or the buyer lacks cash or storage, the delivery is missed and recorded; nothing is charged. After {options.limits.maxMisses} misses in a row the contract ends with no penalty. Either side can cancel with {options.limits.noticeTicks} days' notice.</p>
      {msg && <p className={msg.tone === 'ok' ? 'pe-callout' : 'pe-field-error'} role={msg.tone === 'ok' ? 'status' : 'alert'} data-testid="contract-msg">{msg.text}</p>}
      <Button type="submit" variant="primary" pending={pending} disabled={Object.keys(errs).length > 0 || parties.length === 0} data-testid="contract-submit">Propose contract</Button>
    </form>
  );
}
