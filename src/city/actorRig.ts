/** A small, deterministic cut-out rig. Coordinates are logical pixels, never CSS pixels.
 * Animation transforms independent limbs; it does not translate a static pose and call it walking.
 * The four illustrated directions remain separate: lighting is never mirrored.
 */
export type ActorPose = 'idle' | 'walk' | 'carry' | 'enter' | 'exit' | 'celebrate' | 'upset' | 'load';
export type Direction = 'sw' | 'se' | 'ne' | 'nw';
export const DIRECTIONS: Direction[] = ['sw', 'se', 'ne', 'nw'];
export const POSES: ActorPose[] = ['idle', 'walk', 'carry', 'enter', 'exit', 'celebrate', 'upset', 'load'];
export const FRAME_MS = 160;
export const ACTOR_FRAME = [32, 48] as const;

export function rigPose(pose: ActorPose, frame: number, reduced = false) {
  const p = reduced ? 0 : ((Math.floor(frame) % 4) + 4) % 4;
  const moving = !reduced && ['walk', 'carry', 'enter', 'exit'].includes(pose);
  const step = moving ? [1, 0, -1, 0][p]! : 0;
  return { step, lift: moving && p % 2 === 1 ? 1 : 0,
    bounce: !reduced && pose === 'celebrate' ? [0, -2, -4, -2][p]! : 0,
    head: !reduced && pose === 'upset' ? [0, 1, 2, 1][p]! : 0,
    arms: pose === 'celebrate' ? 1 : pose === 'upset' ? -0.2 : 0,
    cargo: pose === 'carry' || pose === 'load', load: !reduced && pose === 'load' ? [0, 2, 4, 2][p]! : 0 };
}

/** Image is a 24×40 directional idle. x/y are the feet; zoom is an integer renderer scale. */
export function drawActorRig(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, zoom: number, pose: ActorPose, frame: number, direction: Direction, reduced = false) {
  const q = rigPose(pose, frame, reduced), facing = direction === 'sw' || direction === 'nw' ? -1 : 1;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(zoom, zoom); ctx.imageSmoothingEnabled = false;
  if(pose === 'idle' || reduced) { ctx.drawImage(image,-12,-40,24,40); ctx.restore(); return; }
  ctx.translate(0,q.bounce);
  // Hips stay fixed; the two legs swap contact and passing positions every half cycle.
  const limb = (sx: number, sy: number, w: number, h: number, px: number, py: number, angle: number, lift = 0) => {
    ctx.save(); ctx.translate(px - 12, py - 40 - lift); ctx.rotate(angle);
    ctx.drawImage(image, sx, sy, w, h, sx - px, sy - py, w, h); ctx.restore();
  };
  const swing = q.step * 0.32;
  limb(0, 25, 12, 15, 10, 25, swing * facing, frame % 4 === 1 ? q.lift : 0);
  limb(12, 25, 12, 15, 14, 25, -swing * facing, frame % 4 === 3 ? q.lift : 0);
  // Core is isolated from swinging arm pixels. Draw head separately for the bad-news reaction.
  ctx.drawImage(image, 7, 11, 10, 15, -5, -29, 10, 15);
  ctx.drawImage(image, 0, 0, 24, 12, -12, -40 + q.head, 24, 12);
  const arm = q.cargo ? 0 : q.arms ? q.arms * 1.5 : -swing;
  limb(0, 12, 7, 13, 7, 13, arm);
  limb(17, 12, 7, 13, 17, 13, -arm);
  if (q.cargo) {
    // A deliberately simple reusable crate geometry; no money or stock changes occur here.
    ctx.fillStyle = '#593d25'; ctx.fillRect(-6, -20 + q.load, 12, 9);
    ctx.fillStyle = '#bc8b4c'; ctx.fillRect(-5, -19 + q.load, 10, 7);
    ctx.fillStyle = '#e1b575'; ctx.fillRect(-5, -19 + q.load, 10, 1);
    ctx.fillStyle = '#79522e'; ctx.fillRect(-1, -19 + q.load, 2, 7);
  }
  ctx.restore();
}
