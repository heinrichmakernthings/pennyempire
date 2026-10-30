/**
 * Migration 0010 — Owner cover. Additive only.
 * - companies.owner_cover: when on (the default), a player company that cannot pay a day's wages, energy, rent or advertising draws the
 *   shortfall from its owner's wallet as a recorded capital injection, instead of building arrears towards insolvency.
 */
export default `
ALTER TABLE companies ADD COLUMN owner_cover INTEGER NOT NULL DEFAULT 1 CHECK (owner_cover IN (0,1));
`;
