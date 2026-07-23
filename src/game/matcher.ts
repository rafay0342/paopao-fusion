/**
 * Pure match logic. Operates on lightweight cells so it stays decoupled from
 * Phaser sprites — the scene maps its bubbles into Cells before calling in.
 */

export interface Cell {
  id: number;
  row: number;
  col: number;
  color: string;
  active: boolean;
  x: number;
  y: number;
}

function isNeighbor(a: Cell, b: Cell, cellW: number): boolean {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return d > 0 && d < cellW * 1.35;
}

/** Connected same-colour cluster containing `start` (flood fill). */
export function clusterOf(start: Cell, all: Cell[], cellW: number): Cell[] {
  const active = all.filter((b) => b.active);
  const stack: Cell[] = [start];
  const seen = new Set<number>();
  const found: Cell[] = [];
  while (stack.length) {
    const cur = stack.pop() as Cell;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    if (cur.color === start.color) {
      found.push(cur);
      for (const b of active) {
        if (!seen.has(b.id) && isNeighbor(cur, b, cellW)) stack.push(b);
      }
    }
  }
  return found;
}

/** Cells no longer connected to the top row — these should fall. */
export function floaters(all: Cell[], cellW: number): Cell[] {
  const active = all.filter((b) => b.active);
  const anchored = new Set<number>();
  const stack: Cell[] = active.filter((b) => b.row === 0);
  stack.forEach((b) => anchored.add(b.id));
  while (stack.length) {
    const cur = stack.pop() as Cell;
    for (const b of active) {
      if (!anchored.has(b.id) && isNeighbor(cur, b, cellW)) {
        anchored.add(b.id);
        stack.push(b);
      }
    }
  }
  return active.filter((b) => !anchored.has(b.id));
}
