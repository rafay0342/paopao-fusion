import { describe, expect, it } from 'vitest';
import { HandAimFilter, HandLandmarkFilter } from '../src/game/handcontrol';

describe('adaptive hand motion filters', () => {
  it.each([30, 20, 15])('responds within one recognition frame at %i FPS', (fps) => {
    const filter = new HandAimFilter();
    filter.filter({ x: 0.1, y: 0.1 }, 0);
    const result = filter.filter({ x: 0.9, y: 0.9 }, 1_000 / fps);

    expect(result.x).toBeGreaterThan(0.75);
    expect(result.y).toBeGreaterThan(0.74);
  });

  it('removes most stationary fingertip shimmer without introducing drift', () => {
    const filter = new HandAimFilter();
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let index = 0; index < 300; index++) {
      const value = 0.5 + Math.sin(index * 1.71) * 0.006 + Math.sin(index * 0.31) * 0.002;
      raw.push(value);
      smooth.push(filter.filter({ x: value, y: value }, index * (1_000 / 30)).x);
    }
    const rms = (values: number[]): number => Math.sqrt(
      values.reduce((sum, value) => sum + (value - 0.5) ** 2, 0) / values.length,
    );

    expect(rms(smooth.slice(20))).toBeLessThan(rms(raw.slice(20)) * 0.7);
    expect(Math.abs(smooth.at(-1)! - 0.5)).toBeLessThan(0.008);
  });

  it('stays finite and bounded through a long variable-FPS session', () => {
    const filter = new HandAimFilter();
    let time = 0;
    let allFinite = true;
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (let index = 0; index < 100_000; index++) {
      const fps = index % 3 === 0 ? 15 : index % 3 === 1 ? 20 : 30;
      if (index % 127 !== 0) time += 1_000 / fps;
      const point = filter.filter({
        x: 0.5 + Math.sin(index * 0.013) * 0.46,
        y: 0.5 + Math.cos(index * 0.017) * 0.46,
      }, time);
      allFinite &&= Number.isFinite(point.x) && Number.isFinite(point.y);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      if (index % 2_000 === 0) filter.reset();
    }
    expect(allFinite).toBe(true);
    expect(minX).toBeGreaterThanOrEqual(0);
    expect(maxX).toBeLessThanOrEqual(1);
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(maxY).toBeLessThanOrEqual(1);
  });

  it('stabilises every landmark and resets cleanly after sustained loss', () => {
    const filter = new HandLandmarkFilter();
    const base = Array.from({ length: 21 }, (_, index) => ({ x: 0.2 + index * 0.01, y: 0.4, z: 0 }));
    filter.filter(base, 0);
    const shifted = base.map((point) => ({ ...point, x: point.x + 0.2 }));
    const filtered = filter.filter(shifted, 33.34);
    expect(filtered).toHaveLength(21);
    expect(filtered.every((point) => Object.values(point).every(Number.isFinite))).toBe(true);

    filter.reset();
    expect(filter.filter(shifted, 500)).toEqual(shifted);
  });
});
