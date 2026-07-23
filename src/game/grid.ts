import { GRID } from '../config';

export interface HexGeom {
  radius: number;
  cellW: number;
  rowH: number;
  xOff: number;
  topPad: number;
  cols: number;
}

export interface HexCellAddress {
  row: number;
  col: number;
}

export interface AimVector {
  x: number;
  y: number;
}

/** Fit GRID.cols columns across `width` and derive the hex metrics. */
export function computeGeom(width: number): HexGeom {
  const cols = GRID.cols;
  const cellW = width / (cols + 0.5);
  const radius = cellW / 2 - GRID.gap / 2;
  const rowH = cellW * (Math.sqrt(3) / 2);
  const xOff = (width - cols * cellW) / 2 + cellW / 2;
  const topPad = radius + 24;
  return { radius, cellW, rowH, xOff, topPad, cols };
}

/** Pixel centre of a hex cell (odd rows are offset half a cell). */
export function cellPos(g: HexGeom, row: number, col: number, offsetY = 0) {
  const odd = row % 2 !== 0;
  return {
    x: g.xOff + col * g.cellW + (odd ? g.cellW / 2 : 0),
    y: g.topPad + row * g.rowH + offsetY,
  };
}

/** Number of columns present in a given row. */
export function colsInRow(g: HexGeom, row: number): number {
  return row % 2 !== 0 ? g.cols - 1 : g.cols;
}

/**
 * Convert a target point into the exact vector used by both the launcher art
 * and projectile physics. The result is always upward and clamped to the
 * launcher's visible cone, so a horizontal click cannot secretly fire a much
 * wider shot than the barrel displays.
 */
export function clampedUpwardAimVector(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  maxAngleDegrees = 30,
  minimumUpwardDelta = 12,
): AimVector {
  const dx = Number.isFinite(targetX) ? targetX - originX : 0;
  const rawDy = Number.isFinite(targetY) ? targetY - originY : -minimumUpwardDelta;
  const dy = Math.min(rawDy, -Math.max(0.001, minimumUpwardDelta));
  const maxAngle = Math.max(0, Math.min(89.9, Math.abs(maxAngleDegrees)));
  const launcherAngle = Math.max(-maxAngle, Math.min(maxAngle, Math.atan2(dx, -dy) * (180 / Math.PI)));
  const radians = launcherAngle * (Math.PI / 180);
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

/**
 * Find the globally nearest unoccupied playable cell with deterministic tie
 * breaking. The search covers every occupied row, the impact row and two
 * guaranteed spare rows, so a full local neighbourhood can never fall back to
 * an already occupied `{0,0}` cell.
 */
export function nearestFreeHexCell(
  g: HexGeom,
  x: number,
  y: number,
  occupiedCells: readonly HexCellAddress[],
  offsetY = 0,
): HexCellAddress {
  const occupied = new Set(occupiedCells.map(({ row, col }) => `${row}:${col}`));
  const highestOccupiedRow = occupiedCells.reduce((highest, cell) => (
    Number.isInteger(cell.row) ? Math.max(highest, cell.row) : highest
  ), -1);
  const approximateRow = Math.max(0, Math.round((y - g.topPad - offsetY) / Math.max(0.001, g.rowH)));
  const lastRow = Math.max(2, highestOccupiedRow + 2, approximateRow + 2);
  let best: HexCellAddress | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let row = 0; row <= lastRow; row++) {
    const count = colsInRow(g, row);
    for (let col = 0; col < count; col++) {
      if (occupied.has(`${row}:${col}`)) continue;
      const position = cellPos(g, row, col, offsetY);
      const dx = position.x - x;
      const dy = position.y - y;
      const distanceSquared = dx * dx + dy * dy;
      const tieTolerance = best == null
        ? 0
        : Number.EPSILON * 32 * Math.max(1, distanceSquared, bestDistanceSquared);
      if (best == null || distanceSquared < bestDistanceSquared - tieTolerance) {
        bestDistanceSquared = distanceSquared;
        best = { row, col };
      }
    }
  }

  // A valid geometry always has at least one cell in the two spare rows. Keep
  // a total return type so callers cannot reintroduce an occupied fallback.
  return best ?? { row: Math.max(0, lastRow), col: 0 };
}
