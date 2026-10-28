# Animation and placement contract

World grid remains 128×64, 2:1 orthographic, warm upper-left lighting. New world actors occupy 24×40 frames at foot pivot [12,40]. Use integer 1×/2×/3× zoom and disable image smoothing. Do not mirror northeast/southwest faces or stretch canvas CSS to fit mobile; pan the native scene.

| Class | Sheet / frames | Sequence | Timing | Status |
|---|---|---|---|---|
| Owner world | 72×40 / 24×40 | neutral 0, positive 1, negative 2 | hold selected reaction 750ms, return to neutral | SW held poses; not multi-frame celebration |
| Worker | 72×40 / 24×40 | idle 0, work 1→2→1 | 240ms per work pose, 480ms loop | Eight SW strips |
| Portrait | 288×96 / 96×96 | neutral, positive, negative | event-selected, no loop | Twelve strips + individual exports |
| Avatar | individual 48×48 | same expressions | event-selected | Thirty-six exports |
| Walking | planned 24×40 | four phases per direction | prior target 120ms/frame | Not delivered; two studies rejected |
| Delivery replay | reuse vehicle sprites | arrive, unload, complete, depart | 1400 / 1200 / 800 / 1400ms | Presentation path, no economic transit state |

`animations.json` is authoritative for cell rectangles. Atlas row/column ordering is explicit in `manifest.json`. Frame size includes deliberate room for pose movement; preserve it rather than trimming each frame independently. Alpha bounds vary with pose; pivot does not.

Workers loop only on confirmed active work. Pizza/flour/etc. require current `productionActive`, operating company, fresh snapshot. Driver/warehouse cues require confirmed transfer handling, not a fictional production recipe. Reduced motion selects idle. Pause clears presentation replay; it does not pause the economy. Offscreen animation should not render or allocate actors; a shared clock avoids per-character timers.

Consumer visiting/queueing/leaving/waiting are placement states using shared sprites. Four-direction idle art is reused unchanged. Path translation does not become a walk cycle. Door entry uses renderer-owned depth sorting and occlusion; a dedicated door-opening sequence is outstanding. Carrying purchases can reuse courier art, but walking with carried goods is outstanding.

Replay requires a unique settled event ID. The reference remembers 256 IDs for a bounded preview session; production must persist a stream cursor / deduplication window so old events cannot recur after reload. Replay never changes cash, stock or supplier contracts. On reconnect do not backfill an entire historic traffic queue. Use a bounded recent-events window; coalesce bursts.

The shutter uses a facade-space clipping quad and two placements in `branding.json` / `scene.js`. This is a verified profile for `shop-module`, not a universal replacement for all buildings. The agricultural pickup is SW only, transparent 128×91, pivot [64,91]. Other directions are outstanding.
