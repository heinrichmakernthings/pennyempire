/**
 * Reserved, non-interactive advertising slot. Fixed height so it can never resize the scene, never overlays controls,
 * and is hidden below 1200px. No ad network is wired up; this is layout only (pre-alpha, no tracking).
 */
export function AdSlot() {
  return (
    <aside className="pe-ad" aria-label="Sponsored space (placeholder)">
      <strong>Sponsored space</strong>
      <span>Reserved advertising slot · placeholder, no ads served in pre-alpha.</span>
    </aside>
  );
}
