# Granular asset inventory

Status: source artwork is created; runtime extraction/normalisation and in-engine acceptance remain separate tasks. Only the visual target is user-approved, not every generated asset.

| Group | Required items | Current status |
|---|---|---|
| Standalone buildings | Pizza shop, flour mill, cafe | Separate transparent source PNGs |
| Industry sheet | Farm barn+silo, dairy, timber yard, warehouse, utility substation, terrace pair | Source sheet; extract six objects |
| Terrain sheet | Cobble, asphalt, grass, water, road NE/SW, road NW/SE, crossroads, corner, quay NE, quay NW, brick plaza, wheat | Source sheet; grid normalization and seam tests required |
| Props sheet | Tree, streetlamp, bench, planter, van SW, van SE, narrowboat, railing, crates, parasol/table, bollard, crane | Source sheet; separate silhouettes and normalize scale |
| Additional roads | T junction, end cap, remaining corner orientations, remaining quay edges and inner/outer corners | Required before arbitrary map layouts |
| Actors | Resident, worker, courier; four directions; idle and four walk frames each | Outstanding; 60 frames total |
| Vehicles | Remaining van directions; boat opposite facing | Outstanding |
| Business progression | Pizza levels 2/3; cafe levels 2/3; mill levels 2/3 | Outstanding; six variants |
| Production FX | Smoke 4 frames, water 4 frames, delivery arrival 4 frames | Outstanding; disable with reduced motion |
| Commodities | Wheat, flour, cheese, milk, pizza, timber, energy | Outstanding; seven consistent inventory icons |
| UI graphics | Navigation icons, selection diamond, hover diamond, ownership marker, warning state | Render as code/SVG, not baked into city sprites |
| Financial graphics | Profit sparkline, revenue/expense chart, portfolio chart, commodity history | Render from data in code; specification in ART-DIRECTION.md |
| Prestige | Car, penthouse overlay, HQ upgrade, yacht | Later art batch after initial district works |

## Integration order

1. Extract and normalize pizza, cafe and mill with ground tiles; compose small district.
2. Add warehouse/state utility and supply-chain buildings.
3. Add selection, DOM labels, inspector and subtle financial graph with explicitly illustrative data.
4. Add actors and deliveries after collision paths and scale are fixed.
5. Test desktop/mobile and accessibility; then add upgrades and prestige.

Do not generate dozens of animation frames until the first static district proves the scale. Keep building names in UI text so custom player names and localization work.
