# Animation contract

The ten delivered animations are UI-state sprites, not character motion. Each SVG is 96×24 with four contiguous 24×24 frames, ordered left to right. Frame time 200ms; cycle 800ms. Opacity sequence 0.72, 0.86, 1, 0.86. No rapid flashing. Anchor (12,24); no frame-dependent pivot changes.

Persistent loops: production, construction, expansion, low-stock, closed, bankrupt, high-demand. One-shots: delivery, customer-entry, success. Caller removes one-shot after 800ms; sampler clamps final frame rather than restarting. Reduced motion always frame 2. Server state selects the indicator; decorative pulse is local presentation only.

The live fixture interpolates a van along the approved isometric road axis. This is movement of a static directional vehicle, not wheel animation. New idle actors use exact 24×40 frames. The courier source walk study is rejected and is never loaded by the fixture or runtime manifest.

Character target for future authoring: four directions × four walk phases, 24×40 frames, 120ms per frame, stable foot pivot (12,40). These values are a specification, not delivered walk animation. Working/carrying/entry clips remain outstanding and need content-dependent timing.
