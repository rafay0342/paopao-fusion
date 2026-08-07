/**
 * Bounded procedural recovery art, drawn with Canvas 2D and registered as
 * Phaser textures. Production PNG masters are the normal path; these textures
 * keep gameplay legible and fully interactive after a corrupt cache or an
 * interrupted asset download.
 */

function clamp(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}
function shade(hex: number, amt: number): string {
  const r = clamp(((hex >> 16) & 255) + amt);
  const g = clamp(((hex >> 8) & 255) + amt);
  const b = clamp((hex & 255) + amt);
  return `rgb(${r},${g},${b})`;
}
function hexStr(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

/** A glossy candy-style orb: outline, deep body, bottom bounce, top sheen. */
export function makeOrbCanvas(hex: number, size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const R = size / 2;
  const cx = R;
  const cy = R;
  const rad = R * 0.9;

  // crisp dark outline ring (makes candy pop against any background)
  ctx.fillStyle = shade(hex, -110);
  ctx.beginPath();
  ctx.arc(cx, cy, rad + size * 0.03, 0, Math.PI * 2);
  ctx.fill();

  // body — deep, saturated, 4-stop
  const body = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.4, R * 0.1, cx, cy, rad);
  body.addColorStop(0, shade(hex, 95));
  body.addColorStop(0.35, shade(hex, 30));
  body.addColorStop(0.72, hexStr(hex));
  body.addColorStop(1, shade(hex, -85));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();

  // inner rim shadow for roundness
  const rim = ctx.createRadialGradient(cx, cy, rad * 0.58, cx, cy, rad);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();

  // bottom bounce light (colored, opposite the key light — reads premium)
  const bounce = ctx.createRadialGradient(cx + R * 0.18, cy + R * 0.46, 0, cx + R * 0.18, cy + R * 0.46, R * 0.6);
  bounce.addColorStop(0, 'rgba(255,255,255,0.22)');
  bounce.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = bounce;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // broad glossy top sheen
  const spec = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.42, 0, cx - R * 0.3, cy - R * 0.42, R * 0.6);
  spec.addColorStop(0, 'rgba(255,255,255,0.95)');
  spec.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.ellipse(cx - R * 0.26, cy - R * 0.4, R * 0.44, R * 0.3, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // sharp glint
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(cx - R * 0.42, cy - R * 0.48, R * 0.09, 0, Math.PI * 2);
  ctx.fill();

  return c;
}


/** Soft round particle used for pop bursts. */
export function makeSparkCanvas(size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Vertical gradient backdrop. */
export function makeBgCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#141d33');
  g.addColorStop(0.45, '#0c1220');
  g.addColorStop(1, '#070a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // faint glow blobs
  const blob = (bx: number, by: number, r: number, col: string) => {
    const rg = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  };
  blob(w * 0.25, h * 0.2, w * 0.6, 'rgba(70,224,200,0.10)');
  blob(w * 0.8, h * 0.75, w * 0.6, 'rgba(110,168,255,0.10)');
  return c;
}
