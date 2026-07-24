import { describe, expect, it } from 'vitest';
import { HandDragSwapController, type HandGridDragFrame } from '../src/game/handcontrol';

const frame = (
  timestampMs: number,
  cell = { row: 3, col: 3 },
  palmX = 0.5,
  palmY = 0.5,
  palmScale = 0.2,
  mirrorX = true,
): HandGridDragFrame => ({ timestampMs, cell, palmX, palmY, palmScale, mirrorX });

describe('measured-palm hand grid swaps', () => {
  it('uses the current cell when the latest two open observations disagree', () => {
    const control = new HandDragSwapController();
    control.observeOpen(frame(0, { row: 3, col: 3 }));
    control.observeOpen(frame(20, { row: 3, col: 3 }));
    control.observeOpen(frame(40, { row: 3, col: 4 }));
    expect(control.latch(frame(60, { row: 3, col: 4 }))).toEqual({ row: 3, col: 4 });
  });

  it('ignores fingertip cell drift when the palm stays still', () => {
    const control = new HandDragSwapController();
    control.observeOpen(frame(0));
    control.observeOpen(frame(20));
    control.observeOpen(frame(40));
    control.latch(frame(60));
    expect(control.updateContact(frame(80, { row: 3, col: 4 }))).toBeNull();
    expect(control.updateContact(frame(100, { row: 3, col: 4 }))).toBeNull();
    expect(control.release()).toBeNull();
  });

  it('requires two fresh dominant-axis palm samples and commits once', () => {
    const control = new HandDragSwapController();
    control.observeOpen(frame(0));
    control.observeOpen(frame(20));
    control.latch(frame(40));
    // Camera x decreases when the mirrored on-screen hand moves right.
    expect(control.updateContact(frame(60, { row: 3, col: 4 }, 0.43))).toBeNull();
    expect(control.updateContact(frame(80, { row: 3, col: 4 }, 0.42))).toEqual({ row: 3, col: 4 });
    expect(control.release()).toEqual({ from: { row: 3, col: 3 }, to: { row: 3, col: 4 } });
    expect(control.release()).toBeNull();
  });

  it('retains a confirmed swipe while the palm relaxes for fingertip release', () => {
    const control = new HandDragSwapController();
    control.observeOpen(frame(0));
    control.observeOpen(frame(20));
    control.latch(frame(40));
    expect(control.updateContact(frame(60, { row: 3, col: 4 }, 0.43))).toBeNull();
    expect(control.updateContact(frame(80, { row: 3, col: 4 }, 0.42))).toEqual({ row: 3, col: 4 });
    expect(control.updateContact(frame(100, { row: 3, col: 3 }, 0.49))).toEqual({ row: 3, col: 4 });
    expect(control.release()).toEqual({ from: { row: 3, col: 3 }, to: { row: 3, col: 4 } });
  });

  it('cancels a confirmed swipe after sustained diagonal or reversed motion', () => {
    const diagonal = new HandDragSwapController();
    diagonal.observeOpen(frame(0));
    diagonal.observeOpen(frame(20));
    diagonal.latch(frame(40));
    diagonal.updateContact(frame(60, { row: 3, col: 4 }, 0.43));
    expect(diagonal.updateContact(frame(80, { row: 3, col: 4 }, 0.42)))
      .toEqual({ row: 3, col: 4 });
    expect(diagonal.updateContact(frame(100, { row: 4, col: 4 }, 0.42, 0.58)))
      .toEqual({ row: 3, col: 4 });
    expect(diagonal.updateContact(frame(120, { row: 4, col: 4 }, 0.41, 0.59))).toBeNull();
    expect(diagonal.release()).toBeNull();

    const reversed = new HandDragSwapController();
    reversed.observeOpen(frame(0));
    reversed.observeOpen(frame(20));
    reversed.latch(frame(40));
    reversed.updateContact(frame(60, { row: 3, col: 4 }, 0.43));
    reversed.updateContact(frame(80, { row: 3, col: 4 }, 0.42));
    expect(reversed.updateContact(frame(100, { row: 3, col: 2 }, 0.58)))
      .toEqual({ row: 3, col: 4 });
    expect(reversed.updateContact(frame(120, { row: 3, col: 2 }, 0.59))).toBeNull();
    expect(reversed.release()).toBeNull();
  });

  it('retains only one uncertain frame after a confirmed swipe', () => {
    const control = new HandDragSwapController();
    control.observeOpen(frame(0));
    control.observeOpen(frame(20));
    control.latch(frame(40));
    control.updateContact(frame(60, { row: 3, col: 4 }, 0.43));
    control.updateContact(frame(80, { row: 3, col: 4 }, 0.42));
    expect(control.updateContact(frame(100, { row: 3, col: 4 }, Number.NaN)))
      .toEqual({ row: 3, col: 4 });
    expect(control.updateContact(frame(120, { row: 3, col: 4 }, Number.NaN))).toBeNull();
    expect(control.release()).toBeNull();
  });

  it('keeps horizontal drag aligned when camera mirroring is disabled', () => {
    const control = new HandDragSwapController();
    control.observeOpen(frame(0, { row: 3, col: 3 }, 0.5, 0.5, 0.2, false));
    control.observeOpen(frame(20, { row: 3, col: 3 }, 0.5, 0.5, 0.2, false));
    control.latch(frame(40, { row: 3, col: 3 }, 0.5, 0.5, 0.2, false));
    expect(control.updateContact(frame(60, { row: 3, col: 4 }, 0.57, 0.5, 0.2, false))).toBeNull();
    expect(control.updateContact(frame(80, { row: 3, col: 4 }, 0.58, 0.5, 0.2, false)))
      .toEqual({ row: 3, col: 4 });
    expect(control.release()).toEqual({ from: { row: 3, col: 3 }, to: { row: 3, col: 4 } });
  });

  it('cancels diagonal ambiguity and out-of-bounds drags', () => {
    const diagonal = new HandDragSwapController();
    diagonal.observeOpen(frame(0));
    diagonal.latch(frame(20));
    expect(diagonal.updateContact(frame(40, { row: 4, col: 4 }, 0.42, 0.58))).toBeNull();
    expect(diagonal.updateContact(frame(60, { row: 4, col: 4 }, 0.41, 0.59))).toBeNull();
    expect(diagonal.release()).toBeNull();

    const edge = new HandDragSwapController();
    edge.observeOpen(frame(0, { row: 0, col: 0 }));
    edge.latch(frame(20, { row: 0, col: 0 }));
    expect(edge.updateContact(frame(40, { row: 0, col: 0 }, 0.58))).toBeNull();
    expect(edge.updateContact(frame(60, { row: 0, col: 0 }, 0.59))).toBeNull();
    expect(edge.release()).toBeNull();
  });
});
