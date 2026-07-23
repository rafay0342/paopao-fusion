import { describe, expect, it } from 'vitest';
import {
  cellPos,
  clampedUpwardAimVector,
  colsInRow,
  computeGeom,
  nearestFreeHexCell,
} from '../src/game/grid';

describe('projectile aim cone', () => {
  it('uses the visible launcher cone for the actual projectile vector', () => {
    const straight = clampedUpwardAimVector(100, 200, 100, 0);
    const right = clampedUpwardAimVector(100, 200, 10_000, 200);
    const left = clampedUpwardAimVector(100, 200, -10_000, 500);

    expect(straight.x).toBeCloseTo(0, 8);
    expect(straight.y).toBeCloseTo(-1, 8);
    expect(right.x).toBeCloseTo(0.5, 8);
    expect(right.y).toBeCloseTo(-Math.sqrt(3) / 2, 8);
    expect(left.x).toBeCloseTo(-0.5, 8);
    expect(left.y).toBeCloseTo(-Math.sqrt(3) / 2, 8);
    expect(Math.hypot(right.x, right.y)).toBeCloseTo(1, 8);
  });
});

describe('global hex snapping', () => {
  it('finds a free cell outside a completely occupied local neighbourhood', () => {
    const geom = computeGeom(768);
    geom.topPad = 154;
    const occupied = Array.from({ length: 5 }, (_, row) => (
      Array.from({ length: colsInRow(geom, row) }, (_unused, col) => ({ row, col }))
    )).flat();
    const impact = cellPos(geom, 0, 0);
    const snapped = nearestFreeHexCell(geom, impact.x, impact.y, occupied);
    const occupiedKeys = new Set(occupied.map(({ row, col }) => `${row}:${col}`));

    expect(occupiedKeys.has(`${snapped.row}:${snapped.col}`)).toBe(false);
    expect(snapped.row).toBeGreaterThanOrEqual(5);
  });

  it('breaks equal-distance ties by stable row and column order', () => {
    const geom = computeGeom(768);
    geom.topPad = 154;
    const first = cellPos(geom, 0, 0);
    const second = cellPos(geom, 0, 1);
    const midpoint = { x: (first.x + second.x) / 2, y: first.y };

    expect(nearestFreeHexCell(geom, midpoint.x, midpoint.y, [])).toEqual({ row: 0, col: 0 });
    expect(nearestFreeHexCell(geom, midpoint.x, midpoint.y, [])).toEqual({ row: 0, col: 0 });
  });
});
