# Animation specifications

`assets/art/phase3/animations.json` is authoritative. Every sheet is 96×24, four frames left-to-right at [0,0], [24,0], [48,0], [72,0]. Frame size is 24×24, anchor [12,24], duration 200ms per frame / 800ms per cycle. All have transparent backgrounds. Reduced motion uses frame index 2; one-shots still expire after 800ms. Do not freeze expired events indefinitely.

| Industry | Sheet ID | Motion |
|---|---|---|
| Wheat farm | production-farm | Wheat stem rises through four growth poses |
| Flour mill | production-mill | Wheel spokes alternate cardinal/diagonal orientations |
| Dairy | production-dairy | Flow marker descends through processing outlet |
| Pizza | production-pizza | Flame height changes within oven glyph |
| Café | production-cafe | Cup shifts along counter, steam height changes |
| Timber | production-timber | Saw blade translates above timber rack |

These are screen-space production cues, not physical changes to the approved building. Loop only while an authoritative production-active signal is true. Do not interpret the 800ms visual cycle as the economic recipe duration. Show real batch progress separately from completed/total units or authoritative timestamps.

New state strips use the Phase 2 opacity sequence .72, .86, 1, .86. Persistent new strips: missing-inputs, overproduction, loss, profit. New one-shots: startup, new-ownership, major-success, collection, warehouse-arrival, shipment, campaign. Existing production, construction, expansion, low-stock, closed, bankrupt and high-demand strips retain their persistent definitions; existing delivery, customer-entry and success are one-shots. Event playback always overrides a reused persistent strip to one-shot.

Render one 32×32 dark badge containing one 24×24 glyph, in screen pixels above the building's top centre with an 8px gap. Do not scale badges with camera zoom. Show competing states in the inspector and accessible company list. Badge priority is in business-states.json. Company names remain dynamic text.

Use a shared clock and cache decoded sheets. 5Hz frame changes suffice; do not allocate a timer per company. Cull offscreen badges, pause when the page is hidden, and cap transient effects (recommended 32 visible effects). Check reduced-motion preferences. Pair icon meaning with text; colour alone must never encode loss, shortage or ownership.

For world props, use the inherited manifest pivots and normal depth sort. Static customer poses do not constitute walking animation. Route positions, doors, loading bays and cargo attachment points must be provided by map metadata; staging offsets in market-activity.json are demonstration placements only.
