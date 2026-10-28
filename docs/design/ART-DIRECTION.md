# Bristol art foundation — approved direction

Approved 28 October 2026: warm amber/charcoal terminal combined with colourful detailed Bristol pixel art. Reference: `assets/art/reference/approved-bristol.png`. Add subtle, data-driven graphs. The approved image is a mood/layout target, not a background to disguise as a playable city.

## Geometry and export contract

- Logical tile: 128×64 px, orthographic 2:1. Grid projection: x=(column-row)*64, y=(column+row)*32.
- Single light from upper left; warmer left facade, darker right facade. No perspective convergence.
- Buildings are independent RGBA sprites. Ground, selection rings, labels, shadows, pedestrians and effects are separate layers.
- Building pivot: bottom centre of footprint, NOT bottom of image bounding box. Define footprint and pivot explicitly in the final manifest after extraction.
- Proposed runtime frames: 1×1 props 128×192; 2×2 shops 256×320; 3×2 industry 320×384. Frame includes transparent padding; large buildings may use taller frames.
- Source images are retained untouched. Generated sheets are source art, NOT validated texture atlases. Their dimensions and alignment must be measured; never infer exact pixel geometry from a prompt.
- Export nearest-neighbour at integer zoom 1×/2×/3×. Do not silently rescale mixed-resolution sprites. Align roof edges and base diamonds before approval.
- Sort ground by layer, buildings by footprint's southern corner, and moving actors by foot position. Multi-tile occlusion may need split roof/foreground layers.
- Runtime filenames: `{category}-{name}-{level}-{facing}-{frame}.png`. Keep source artwork in `assets/art/source`; extracted approved assets go into `assets/art/buildings`, `city`, `props`, `actors`.

## Visual progression

Pizza level 1: small red awning and modest windows. Level 2: refurbished facade and larger sign. Level 3: expanded premises and roof terrace. Preserve occupied footprint within a tier; expansion requires an explicit land upgrade. Variants remain outstanding, not implied by the base sprite.

## UI tokens

Background #141C20; surface #1D282D; raised #26343B; divider #38464C; text #F0E8D7; muted #A9B5B9; amber #FFC45E; positive #62DBAF; negative #F08076. Colour must never be the only status indicator. Use a clean sans-serif and tabular numerals, 16px body, 14px secondary. Spacing 4/8/12/16/24/32. Controls at least 44px touch height.

Desktop ≥1200: 184px navigation, flexible city, 336px inspector. Tablet 768–1199: 72px rail, inspector overlay with explicit close. Mobile <768: city full width, bottom navigation City/Companies/Market/Portfolio/More, business bottom sheet. Wallet, prestige and stocks remain reachable through More. Never simply shrink desktop controls.

## Subtle graph system

Company overview: one 7-day profit sparkline (120×32), current value, signed change and accessible trend text. Full financial tab: 280×120 minimum revenue/expense line chart, unobtrusive grid, labelled currency and period, focusable data points and table alternative. Portfolio: one value history chart. Marketplace: optional price history on commodity selection. Do not put charts on buildings or every navigation tile.

Use real values only when backend exists. Mock charts carry Illustrative data. Empty history shows No history yet, never an invented trend. Preserve negative values and zero baseline for profit; no misleading truncation. Amber revenue, muted slate expenses, mint positive net; legend and line styles supplement colour. No decorative animation or glow; respect reduced motion.

## Interaction and advertising

Hover: thin pale amber footprint. Selected: amber outline plus ownership label. Keyboard focus must match selection visibility. NPC companies have textual NPC marker. Labels are DOM/canvas text, not baked into sprites. City pan/zoom and inspector must work independently. Sponsored area never covers canvas controls; collapse it on small screens. Rewards remain explicitly optional.

## Acceptance gate before calling assets game-ready

1. Verify RGBA transparency (including clean edge pixels).
2. Extract sheet cells into individual files; inspect no clipped or neighbouring pixels.
3. Normalize pixel scale and align each base on the 128×64 grid.
4. Record exact width, height, pivot, footprint and collision polygon.
5. Compose a real test district; inspect seams, scale and occlusion at 1× and 2×.
6. Check mobile silhouette readability and image decode/memory budgets.
7. Validate atlas padding/extrusion before texture packing.

These generated sources are not yet through all seven gates. No economic backend or playable UI is implemented by this art handoff.
