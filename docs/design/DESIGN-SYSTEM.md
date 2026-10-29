# Penny Empire design system — Phase 1 v1

This is the final Phase 1 UI contract. It supersedes provisional frame-size advice in ART-DIRECTION.md; the approved image remains the visual target. Asset runtime certification is separately recorded in PRODUCTION-READINESS.md.

## Brand and composition

Warm, slightly gritty Bristol pixel city; restrained charcoal market terminal. Amber for primary actions and selection; mint for positive outcomes; coral for losses/errors. No gradients, glowing panels, card-inside-card layouts or baked-in financial text. The city is a navigable tile scene, never the approved screenshot used as a fake map.

## Type

Use `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` for Phase 1; no font download dependency. Body 16/24, secondary 14/20, compact table 14/20, headings 24/32 and 20/28, HUD value 20/28 semibold. Never reduce essential financial data below 14px. Tabular numbers for money and quantities. 400/600/700 weights. Sentence case labels; all-caps only compact brand/status labels.

## Tokens

Use src/design/tokens.css. Background #141C20; surface #1D282D; raised #26343B; divider #38464C; text #F0E8D7; muted #A9B5B9; amber #FFC45E; mint #62DBAF; coral #F08076. Amber buttons use dark text. Spacing 4/8/12/16/24/32; radii 4px controls, 8px panels; 1px separators. No text on muted dividers. Verify contrast when combining tokens, especially disabled text. Disabled controls retain descriptive labels.

## Layout

Desktop ≥1200px: 184px navigation, 64px HUD, 336px company inspector, remaining space for city/content. Tablet 768–1199px: 72px rail and dismissible 360px inspector overlay. Mobile <768px: 56px bottom nav plus safe-area inset, two-line compact HUD, full-width detail sheet (80dvh maximum). 44×44 minimum controls. Desktop advertising reserves up to 90px below game viewport; hidden below 1200px. It must not resize the scene continuously or overlay controls.

## Pixel and map contract

Logical grid 128×64, 2:1 orthographic. project(c,r) = ((c-r)*64,(c+r)*32). No perspective camera. World uses logical pixels; device pixel ratio changes canvas backing resolution, not world geometry. Camera zoom snaps to 1×/2×/3×; use nearest-neighbour sampling. User can pan on mobile; do not scale the whole city down to unreadable thumbnails.

Manifest logical sizes govern sprites. Existing source pixel density is not certified uniform; see readiness report. Draw measured atlas frames into logical sizes with smoothing off. Buildings reserve 2×2 or 3×2 plots; source silhouette and ground collision are separate. Pivot currently southern visible edge; do not use it as an authoritative footprint until fit checks pass. Human sprites nominal width 24px; normalize height to approved building doorway scale before animation. Render terrain, then depth-sorted buildings/actors, then labels/focus outlines. Labels use HTML/canvas text and remain editable/localizable.

Road adjacency bits: +column=1, +row=2, -column=4, -row=8. All 16 masks supported. Quay uses same edge bits. Exact base geometry is implemented in tools/art-review/renderer.js. It is deliberately simple and tile-safe; final decorative textures can be layered without changing geometry.

## Components and states

Button primary/secondary/destructive; money value with currency; signed delta with icon; labelled input and inline error; select; tabs; modal/sheet; data table/list; skeleton; empty state; stale banner; toast/live-region outcome; sparkline; financial chart. Shared states: default, hover, focus-visible, disabled, pending, error. No optimistic currency or inventory updates. Native input controls before custom sliders; all slider functions must be keyboard accessible.

## Graphs

120×32 compact trend with text summary; 280×120 minimum detailed chart. Label period and currency. Mint profit, amber revenue, dashed slate expenses. Avoid charts on every card. Missing data remains a gap; empty means No history yet. Provide an accessible table and reduced-motion behaviour. Never infer actual economics from fixture values.
