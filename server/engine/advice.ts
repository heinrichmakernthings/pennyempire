import type { Sql } from '../db/sql';

/**
 * Plain-language warnings about settings that lose money on every unit, shown after a change is saved (they are advice, not rules):
 * a selling price at or below what the ingredients for one unit cost at the chosen quality, valued at today's reference prices.
 */
export function settingWarnings(db: Sql, cfg: { qualityInputBps: Record<string, number> }, companyId: string): string[] {
  const c = db.get<{ price_minor: number; quality: string; retail_commodity_id: string | null }>('SELECT price_minor, quality, retail_commodity_id FROM companies WHERE id = ?', companyId);
  if (!c) return [];
  const out: string[] = [];
  for (const l of db.all<{ recipe_id: string; output_units: number; ask: number | null }>('SELECT l.recipe_id, r.output_units, l.ask_price_minor ask FROM production_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.company_id = ?', companyId)) {
    const inputs = db.get<{ v: number }>('SELECT COALESCE(SUM(i.units * m.reference_price_minor),0) v FROM recipe_inputs i JOIN commodities m ON m.id = i.commodity_id WHERE i.recipe_id = ?', l.recipe_id)!.v;
    if (inputs === 0 || l.output_units <= 0) continue;
    const qBps = cfg.qualityInputBps[c.quality] ?? 10_000;
    const unitCost = Math.ceil((inputs * qBps) / 10_000 / l.output_units);
    const price = c.retail_commodity_id === null ? (l.ask ?? c.price_minor) : c.price_minor;
    if (price <= unitCost) out.push(`At ${(price / 100).toFixed(2)} EC each you lose money on every unit: the ingredients alone cost about ${(unitCost / 100).toFixed(2)} EC${c.quality === 'premium' ? ' at premium quality, which uses 25% more of them' : ''}, before wages and rent. Raise the price${c.quality === 'premium' ? ' or go back to standard quality' : ''}.`);
    else if (price * 10 < unitCost * 13) out.push(`Thin margin: ingredients cost about ${(unitCost / 100).toFixed(2)} EC of your ${(price / 100).toFixed(2)} EC price${c.quality === 'premium' ? ' at premium quality' : ''}, leaving little for wages and rent.`);
  }
  return out;
}
