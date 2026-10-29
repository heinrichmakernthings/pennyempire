// Authored schematic outline for gameplay navigation. Not geographic/cartographic data.
export const landPaths=[
'M70 95L120 48L205 40L252 68L310 72L340 112L295 140L258 155L230 190L207 215L187 188L155 176L135 143L100 135Z',
'M240 213L290 230L320 270L301 316L278 360L260 389L247 351L235 310L217 268Z',
'M360 48L405 34L425 62L405 96L378 91Z',
'M453 92L488 75L515 90L547 70L594 58L650 65L701 49L768 72L850 91L880 126L839 151L795 145L775 178L735 194L702 176L672 203L642 174L606 164L570 139L535 147L503 131L467 138Z',
'M471 155L509 143L551 168L566 215L548 253L524 293L500 277L485 230L461 203Z',
'M737 291L778 268L823 282L852 316L822 345L769 339L744 321Z',
'M868 348L876 336L883 359L874 379L866 371Z'
];
export function worldMap(city,showRoutes=true){return `<svg class="world-map" viewBox="0 0 960 440" role="img" aria-label="Schematic world map: UK, Portugal and Mexico destinations; route geometry is illustrative">${landPaths.map(d=>`<path class="land" d="${d}"/>`).join('')}${showRoutes?'<path class="route" d="M483 103 Q465 110 463 135 M463 135 Q340 50 211 182"/>':''}<circle class="marker" cx="483" cy="103" r="7"/><text class="marker-label" x="500" y="98">UK · 2 cities</text><circle class="marker" cx="463" cy="135" r="7"/><text class="marker-label" x="480" y="155">Lisbon</text><rect class="marker locked" x="204" y="175" width="14" height="14"/><text class="marker-label" x="225" y="199">Mexico City · locked</text></svg>`;}
export function countryMap(country){const uk=country==='uk';return `<svg class="world-map" viewBox="0 0 700 360" role="img" aria-label="${uk?'United Kingdom: Bristol and London':'Selected country: destination overview'}. Schematic positions, not distances."><path class="land" d="M210 35L370 28L450 100L438 220L510 298L380 328L270 276L180 170Z"/>${uk?'<path class="route" d="M270 230L425 255"/><circle class="marker" cx="270" cy="230" r="9"/><text class="marker-label" x="205" y="208">Bristol · owned</text><circle class="marker" cx="425" cy="255" r="9"/><text class="marker-label" x="438" y="280">London · available</text>':`<circle class="marker ${country==='mx'?'locked':''}" cx="350" cy="210" r="10"/><text class="marker-label" x="370" y="215">${country==='pt'?'Lisbon':'Mexico City'}</text>`}</svg>`;}
