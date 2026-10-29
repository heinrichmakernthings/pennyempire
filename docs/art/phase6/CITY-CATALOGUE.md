# City environment starter catalogue

All three cities inherit Bristol’s orthographic 2:1 grid, warm upper-left light, dark right face and runtime canvas classes. The city composition sheet compares each with the same Bristol warehouse and lorry at native 1×. Roads, pavements, rail/parks/residential filler reuse existing Phase 2 art; no alternate terrain system is introduced.

| City | Module | Pixels | Placement and identity |
|---|---|---|---|
| london | `london-commercial` | 224×265 | 2×2 frontage; stock-brick Victorian shop, blank dynamic sign area |
| london | `london-office` | 224×285 | 2×2 commercial infill; limestone fins and teal office glazing |
| lisbon | `lisbon-tiled-shop` | 224×265 | 2×2 street frontage; blue/white tiles, balcony and terracotta roof |
| lisbon | `lisbon-waterfront-store` | 288×283 | 3×2 merchant storage; ochre facade and loading arches |
| lisbon | `lisbon-retaining-wall` | 64×49 | 1×1 decorative divider; no actual terrain elevation |
| mexico-city | `mexico-city-shop` | 224×265 | 2×2 mixed-use block; coral walls, flat parapet and roof water tank |
| mexico-city | `mexico-city-market-stall` | 64×81 | 1×1 pavement-market prop; red canopy and produce counter |
| mexico-city | `mexico-city-workshop` | 288×283 | 3×2 light-industrial block; rolling doors and sawtooth metal roof |

## Assembly guidance

Use existing world sorting and manifest pivots. Keep building door level at the same ground anchor; vary architecture through modules, not camera angle. Do not stretch or mirror buildings to fit a block. Props occupy reserved neighbouring cells; avoid overlapping transport access. Company names remain runtime text.

These modules establish material and roofline differences, not a complete representation of each city. District names in the reference are illustrative locations; no claim of surveyed layouts or accurate building replicas. Lisbon’s hill identity remains partial until the renderer has an approved elevation system. Mexico City’s inland location requires overland connections from a real port node for future sea freight.

London uses two new buildings plus existing British terraces/warehouses. Lisbon uses two new buildings and a divider prop. Mexico City uses two new buildings and a market stall. Add terrain and district density later under the same grid, not with flattened city paintings.
