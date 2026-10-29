# Finished, partial and outstanding

## Finished for static renderer integration

Five transparent PNG runtime atlases: building, state, environment, vehicle, actor. 61 new exported sprites; six inherited tier-one references complete the 67-entry package. Exact frames and pivots are specified and tested. Ten SVG state strips, dynamic labels and level markers are usable code/native assets.

## Partial

- Building progression: all eighteen tier slots have artwork. Tier-two mill/dairy changes are subtle and must retain visible level labels. Existing tier-one art is the approved Phase 1 premise, not newly redesigned as tiny startups. More dramatic land-expansion variants require separate approved footprints.
- Characters: all requested roles now have idle representation (three inherited, four new). Working, entering and reliable walking cycles are not complete. Static sprites moving along a path must not be advertised as walk animation.
- Logistics: van, small lorry and car have four views. Bicycle has two; forklift and service van one each. Large cargo truck and remaining directions are absent.
- Environment: alternate shop, warehouse and terrace came out as whole building sprites, not detachable wall-only modules. Railway has one decorative track segment, not a connectable network.
- Ownership: names, colour accents, level and selection are dynamic UI. Actual awning/shopfront recolour masks and detachable brand panels are outstanding. Prestige is represented by premium tier trim, not a complete luxury asset collection.
- Activity: all ten requested states have exact-frame indicator pulses. Smoke, machinery motion, door opening and character work are not authored animations. Delivery movement is implemented in the fixture, not a logistics simulation.

## Rejected and excluded

`source/courier-walk-study.png`: row-one/row-two final frames change facing; stride phases are inconsistent. Not usable as a direction-stable walk loop. Do not select a few frames and call the whole animation finished.

Second railway source segment: duplicates the first direction instead of producing the requested perpendicular orientation. Not included as rail-b.

## Inherited risks / release gates

Phase 1 arbitrary footprint/occlusion and source pixel-density certification are still open. Same frame dimensions are not proof that every brick or doorway aligns geometrically across tiers. Browser/device testing is still required. Check all close building adjacencies, human doorway scale and two-times rendering before a production release.

## Priority remaining work

1. Author a reliable four-phase courier cycle in one direction, then expand consistently; repeat for other roles.
2. Add work/carry/entry poses and door occlusion masks.
3. Add remaining service/industrial vehicle directions and large cargo truck.
4. Make exact railway turns/junctions and terrain textures using the approved grid.
5. Produce recolour masks and detached shopfront components.
6. Complete browser and free-placement art QA before declaring all Phase 2 success criteria met.
