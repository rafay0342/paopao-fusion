import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HandAimFilter,
  PinchDoubleTapControl,
  type PinchControlEvent,
  type PinchGestureFrame,
} from '../src/game/handcontrol';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

const CLOSED = 0.3;
const CONTACT_BROKEN = 0.37;
const NEUTRAL = 0.47;
const SEPARATED = 0.5;
const OPEN = 0.74;

const gestureFrame = (
  pinch: number,
  timestampMs: number,
  patch: Partial<PinchGestureFrame> = {},
): PinchGestureFrame => {
  const scale = patch.palmScale ?? 0.2;
  return {
    timestampMs,
    rawPinch: pinch,
    filteredPinch: pinch,
    palmX: 0.5,
    palmY: 0.5,
    rawPalmScale: patch.rawPalmScale ?? scale,
    palmScale: scale,
    palmPixels: patch.palmPixels ?? scale * 384,
    pinchDepth: 0.08,
    pinch3d: 0.32,
    depthSource: 'world',
    fingertipsVisible: true,
    palmAnchorsVisible: true,
    handedness: 'Right',
    handednessScore: 0.96,
    ...patch,
  };
};

function runValidDoubleTap(fps: number): { events: PinchControlEvent[]; control: PinchDoubleTapControl; releasedAt: number } {
  const control = new PinchDoubleTapControl();
  const events: PinchControlEvent[] = [];
  const period = 1000 / fps;
  let now = -period;
  const send = (pinch: number, patch: Partial<PinchGestureFrame> = {}): PinchControlEvent => {
    now += period;
    const event = control.update(gestureFrame(pinch, now, patch));
    events.push(event);
    return event;
  };

  while (now < 160) send(SEPARATED);
  const aimStartedAt = now + period;
  send(CLOSED);
  expect(send(CLOSED)).toBe('latched');
  while (now - aimStartedAt < 90) send(CLOSED);
  send(SEPARATED);
  expect(send(SEPARATED)).toBe('aim-locked');

  send(CLOSED);
  send(CLOSED);
  send(CONTACT_BROKEN);
  expect(send(CONTACT_BROKEN)).toBe('released');
  return { events, control, releasedAt: now };
}

function enterSecondTap(control: PinchDoubleTapControl): void {
  [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
  expect(control.update(gestureFrame(CLOSED, 120))).toBe('none');
  expect(control.update(gestureFrame(CLOSED, 160))).toBe('latched');
  expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
  expect(control.update(gestureFrame(CONTACT_BROKEN, 240))).toBe('none');
  expect(control.update(gestureFrame(CONTACT_BROKEN, 280))).toBe('aim-locked');
}

describe('false-positive-resistant pinch and double-tap controls', () => {
  it.each([30, 20, 15])('counts aim touch/release as tap 1 and fires only after tap 2 at %i FPS', (fps) => {
    const { events, control } = runValidDoubleTap(fps);

    expect(events.filter((event) => event === 'latched')).toHaveLength(1);
    expect(events.filter((event) => event === 'aim-locked')).toHaveLength(1);
    expect(events.filter((event) => event === 'released')).toHaveLength(1);
    expect(control.isEngaged()).toBe(false);
    expect(control.getPhase()).toBe('open');
  });

  it('never fires from the old single pinch-release gesture', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => control.update(gestureFrame(OPEN, time)));
    control.update(gestureFrame(CLOSED, 200));
    expect(control.update(gestureFrame(CLOSED, 240))).toBe('latched');
    control.update(gestureFrame(CLOSED, 300));
    control.update(gestureFrame(OPEN, 340));
    expect(control.update(gestureFrame(OPEN, 380))).toBe('aim-locked');
    expect(control.update(gestureFrame(OPEN, 1081))).toBe('cancelled');
    expect(control.isEngaged()).toBe(false);
  });

  it.each([30, 20, 15])('fires gameplay mode once after one confirmed pinch/release at %i FPS', (fps) => {
    const control = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
    const period = 1_000 / fps;
    let now = -period;
    const send = (pinch: number): PinchControlEvent => {
      now += period;
      return control.update(gestureFrame(pinch, now));
    };

    while (now < period * 2) expect(send(SEPARATED)).toBe('none');
    const contactAt = now + period;
    expect(send(CLOSED)).toBe('none');
    expect(send(CLOSED)).toBe('latched');
    while (now - contactAt < 70) expect(send(CLOSED)).toBe('none');
    expect(send(CONTACT_BROKEN)).toBe('none');
    expect(send(CONTACT_BROKEN)).toBe('released');
    expect(control.isEngaged()).toBe(false);
  });

  it('never fires gameplay mode from one contact frame or one release frame', () => {
    const control = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.update(gestureFrame(CLOSED, 120))).toBe('none');
    expect(control.update(gestureFrame(SEPARATED, 160))).toBe('none');
    expect(control.getPhase()).toBe('ready');

    expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 240))).toBe('latched');
    expect(control.update(gestureFrame(CLOSED, 280))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 320))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 360))).toBe('none');
    expect(control.isEngaged()).toBe(true);
  });

  it('preserves one release sample across a single uncertain fingertip frame', () => {
    const control = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.update(gestureFrame(CLOSED, 120))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 160))).toBe('latched');
    expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 240))).toBe('none');
    control.holdForUncertainty(280);
    expect(control.update(gestureFrame(CONTACT_BROKEN, 320))).toBe('released');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 360))).toBe('none');
  });

  it('treats a small real fingertip gap as separated without requiring an open palm', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120].forEach((time) => {
      expect(control.update(gestureFrame(SEPARATED, time))).toBe('none');
    });
    expect(control.getPhase()).toBe('ready');
    expect(control.isContacting()).toBe(false);

    const filterStillOpen = { filteredPinch: 0.68 };
    expect(control.update(gestureFrame(CLOSED, 160, filterStillOpen))).toBe('none');
    expect(control.isContacting()).toBe(true);
    expect(control.update(gestureFrame(CLOSED, 200, filterStillOpen))).toBe('latched');

    const filterStillPinched = { filteredPinch: 0.31, pinchDepth: 0.18, pinch3d: 0.5 };
    expect(control.update(gestureFrame(CONTACT_BROKEN, 240, filterStillPinched))).toBe('none');
    expect(control.isContacting()).toBe(false);
    expect(control.update(gestureFrame(CONTACT_BROKEN, 280, filterStillPinched))).toBe('aim-locked');
    expect(control.getPhase()).toBe('tap-two');

    expect(control.update(gestureFrame(CLOSED, 320))).toBe('none');
    expect(control.isContacting()).toBe(true);
    expect(control.update(gestureFrame(CLOSED, 360))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 400, filterStillPinched))).toBe('none');
    expect(control.isContacting()).toBe(false);
    expect(control.update(gestureFrame(CONTACT_BROKEN, 440, filterStillPinched))).toBe('released');
    expect(control.isEngaged()).toBe(false);
  });

  it('does not turn one noisy contact or separation frame into a tap edge', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120].forEach((time) => control.update(gestureFrame(SEPARATED, time)));

    expect(control.update(gestureFrame(CLOSED, 160))).toBe('none');
    expect(control.update(gestureFrame(SEPARATED, 200))).toBe('none');
    expect(control.getPhase()).toBe('ready');

    expect(control.update(gestureFrame(CLOSED, 240))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 280))).toBe('latched');
    expect(control.update(gestureFrame(CLOSED, 320))).toBe('none');
    expect(control.update(gestureFrame(SEPARATED, 360))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 400))).toBe('none');
    expect(control.getPhase()).toBe('aim');
    expect(control.isContacting()).toBe(true);
  });

  it('does not reinterpret a held release gap as tap two or fire from one strong frame', () => {
    const control = new PinchDoubleTapControl();
    enterSecondTap(control);

    expect(control.update(gestureFrame(CONTACT_BROKEN, 320))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 360))).toBe('none');
    expect(control.getPhase()).toBe('tap-two');
    expect(control.isContacting()).toBe(false);

    expect(control.update(gestureFrame(CLOSED, 400))).toBe('none');
    expect(control.isContacting()).toBe(true);
    expect(control.update(gestureFrame(CONTACT_BROKEN, 440))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 480))).toBe('none');
    expect(control.getPhase()).toBe('tap-two');
    expect(control.isEngaged()).toBe(true);
  });

  it('rearms the next shot at the same small release gap', () => {
    const control = new PinchDoubleTapControl();
    enterSecondTap(control);
    expect(control.update(gestureFrame(CLOSED, 320))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 360))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 400))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 440))).toBe('released');

    control.resetForShot();
    expect(control.update(gestureFrame(CONTACT_BROKEN, 480))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 520))).toBe('none');
    expect(control.getPhase()).toBe('ready');
    expect(control.update(gestureFrame(CLOSED, 560))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 600))).toBe('latched');
  });

  it('does not let one hard pinch narrow the next softer gameplay pinch', () => {
    const control = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.update(gestureFrame(0.05, 120))).toBe('none');
    expect(control.update(gestureFrame(0.05, 160))).toBe('latched');
    expect(control.update(gestureFrame(0.05, 200))).toBe('none');
    expect(control.update(gestureFrame(0.12, 240))).toBe('none');
    expect(control.update(gestureFrame(0.12, 280))).toBe('released');

    expect(control.update(gestureFrame(0.12, 320))).toBe('none');
    expect(control.update(gestureFrame(0.12, 360))).toBe('none');
    expect(control.getPhase()).toBe('ready');
    expect(control.update(gestureFrame(SEPARATED, 400))).toBe('none');
    expect(control.update(gestureFrame(0.32, 440))).toBe('none');
    expect(control.update(gestureFrame(0.32, 480))).toBe('latched');
  });

  it('never turns an unchanged small release gap into an automatic next shot', () => {
    const control = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
    expect(control.update(gestureFrame(0.5, 0))).toBe('none');
    expect(control.update(gestureFrame(0.5, 40))).toBe('none');
    expect(control.update(gestureFrame(0.05, 80))).toBe('none');
    expect(control.update(gestureFrame(0.05, 120))).toBe('latched');
    expect(control.update(gestureFrame(0.12, 160))).toBe('none');
    expect(control.update(gestureFrame(0.12, 200))).toBe('released');
    expect(control.update(gestureFrame(0.12, 240))).toBe('none');
    expect(control.update(gestureFrame(0.12, 280))).toBe('none');
    expect(control.getPhase()).toBe('ready');
    expect(control.update(gestureFrame(0.12, 320))).toBe('none');
    expect(control.update(gestureFrame(0.12, 360))).toBe('none');
    expect(control.isContacting()).toBe(false);
    expect(control.getPhase()).toBe('ready');
  });

  it('keeps the learned small release gap through a brief loss or missed tap two', () => {
    const lost = new PinchDoubleTapControl();
    enterSecondTap(lost);
    expect(lost.cancelForLoss(609, 280)).toBe('none');
    expect(lost.cancelForLoss(610, 280)).toBe('cancelled');
    expect(lost.update(gestureFrame(CONTACT_BROKEN, 580))).toBe('none');
    expect(lost.update(gestureFrame(CONTACT_BROKEN, 620))).toBe('none');
    expect(lost.getPhase()).toBe('ready');

    const timedOut = new PinchDoubleTapControl();
    enterSecondTap(timedOut);
    expect(timedOut.update(gestureFrame(CONTACT_BROKEN, 981))).toBe('cancelled');
    expect(timedOut.update(gestureFrame(CONTACT_BROKEN, 1021))).toBe('none');
    expect(timedOut.update(gestureFrame(CONTACT_BROKEN, 1061))).toBe('none');
    expect(timedOut.getPhase()).toBe('ready');
  });

  it('keeps the learned release gap across a lighting-pipeline continuity reset', () => {
    const control = new PinchDoubleTapControl();
    enterSecondTap(control);
    control.resetForContinuity();
    expect(control.update(gestureFrame(CONTACT_BROKEN, 320))).toBe('none');
    expect(control.update(gestureFrame(CONTACT_BROKEN, 360))).toBe('none');
    expect(control.getPhase()).toBe('ready');
    expect(control.update(gestureFrame(CLOSED, 400))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 440))).toBe('latched');
  });

  it('absorbs an unusually low first contact sample without false release', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.update(gestureFrame(0.27, 120))).toBe('none');
    expect(control.update(gestureFrame(0.32, 160))).toBe('latched');
    expect(control.update(gestureFrame(0.3, 200))).toBe('none');
    expect(control.getPhase()).toBe('aim');
    expect(control.isContacting()).toBe(true);
  });

  it('does not combine contact evidence across a stale confirmation gap', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.update(gestureFrame(CLOSED, 120))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 320))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 360))).toBe('latched');
  });

  it('reports live physical touch even before the gesture is rearmed', () => {
    const control = new PinchDoubleTapControl();
    expect(control.update(gestureFrame(CLOSED, 0))).toBe('none');
    expect(control.getPhase()).toBe('open');
    expect(control.isContacting()).toBe(true);
    expect(control.update(gestureFrame(SEPARATED, 40))).toBe('none');
    expect(control.isContacting()).toBe(false);
  });

  it('recognises a genuine angled world-space touch after two fresh frames', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    const angledTouch = {
      filteredPinch: 0.6,
      pinchDepth: 0.18,
      pinch3d: 0.38,
      depthSource: 'world' as const,
    };
    expect(control.update(gestureFrame(0.6, 120, angledTouch))).toBe('none');
    expect(control.isContacting()).toBe(true);
    expect(control.update(gestureFrame(0.6, 160, angledTouch))).toBe('latched');
  });

  it('has no dead band for a 0.48 angled fingertip touch', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    const angledTouch = {
      filteredPinch: 0.48,
      pinchDepth: 0.18,
      pinch3d: 0.38,
      depthSource: 'world' as const,
    };
    expect(control.update(gestureFrame(0.48, 120, angledTouch))).toBe('none');
    expect(control.update(gestureFrame(0.48, 160, angledTouch))).toBe('latched');
  });

  it('supports the same world-space angled touch for tap two', () => {
    const control = new PinchDoubleTapControl();
    enterSecondTap(control);
    const angledTouch = {
      filteredPinch: 0.6,
      pinchDepth: 0.18,
      pinch3d: 0.38,
      depthSource: 'world' as const,
    };
    expect(control.update(gestureFrame(0.6, 320, angledTouch))).toBe('none');
    expect(control.update(gestureFrame(0.6, 360, angledTouch))).toBe('none');
    const angledRelease = {
      filteredPinch: 0.6,
      pinchDepth: 0.4,
      pinch3d: 0.55,
      depthSource: 'world' as const,
    };
    expect(control.update(gestureFrame(0.6, 400, angledRelease))).toBe('none');
    expect(control.update(gestureFrame(0.6, 440, angledRelease))).toBe('released');
    expect(control.update(gestureFrame(0.6, 480, angledRelease))).toBe('none');
  });

  it('keeps reliable world contact continuous across angled raw ratios', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    const worldContact = {
      filteredPinch: 0.7,
      pinchDepth: 0.18,
      pinch3d: 0.38,
      depthSource: 'world' as const,
    };

    expect(control.update(gestureFrame(0.6, 120, worldContact))).toBe('none');
    expect(control.update(gestureFrame(0.55, 160, worldContact))).toBe('latched');
    for (const [time, rawPinch] of [[200, 0.69], [240, 0.51], [280, 0.73], [320, 0.6]] as const) {
      expect(control.update(gestureFrame(rawPinch, time, worldContact))).toBe('none');
    }
    expect(control.getPhase()).toBe('aim');
    expect(control.isContacting()).toBe(true);
  });

  it('never combines stale or anatomically inconsistent world-angle frames into a latch', () => {
    const worldContact = {
      filteredPinch: 0.7,
      pinchDepth: 0.18,
      pinch3d: 0.38,
      depthSource: 'world' as const,
    };
    const stale = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => stale.update(gestureFrame(SEPARATED, time)));
    expect(stale.update(gestureFrame(0.6, 120, worldContact))).toBe('none');
    expect(stale.update(gestureFrame(0.6, 300, worldContact))).toBe('none');
    expect(stale.getPhase()).toBe('ready');
    expect(stale.update(gestureFrame(0.6, 340, worldContact))).toBe('none');
    expect(stale.update(gestureFrame(0.6, 380, worldContact))).toBe('latched');

    const displaced = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => displaced.update(gestureFrame(SEPARATED, time)));
    expect(displaced.update(gestureFrame(0.6, 120, worldContact))).toBe('none');
    expect(displaced.update(gestureFrame(0.6, 160, { ...worldContact, palmX: 0.7 }))).toBe('none');
    expect(displaced.getPhase()).toBe('ready');
    expect(displaced.update(gestureFrame(0.6, 200, { ...worldContact, palmX: 0.7 }))).toBe('none');
    expect(displaced.update(gestureFrame(0.6, 240, { ...worldContact, palmX: 0.7 }))).toBe('latched');
  });

  it('rearms from cold or full reset using sustained world-only separation, never image-z', () => {
    const worldSeparated = {
      pinchDepth: 0.8,
      pinch3d: 0.95,
      depthSource: 'world' as const,
    };
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => expect(
      control.update(gestureFrame(CLOSED, time, worldSeparated)),
    ).toBe('none'));
    expect(control.getPhase()).toBe('ready');

    control.reset();
    [120, 160, 200].forEach((time) => expect(
      control.update(gestureFrame(CLOSED, time, worldSeparated)),
    ).toBe('none'));
    expect(control.getPhase()).toBe('ready');

    const imageOnly = new PinchDoubleTapControl();
    const imageSeparated = {
      pinchDepth: 0.8,
      pinch3d: 0.95,
      depthSource: 'image' as const,
    };
    [0, 40, 80, 120].forEach((time) => expect(
      imageOnly.update(gestureFrame(CLOSED, time, imageSeparated)),
    ).toBe('none'));
    expect(imageOnly.getPhase()).toBe('open');
    expect(imageOnly.isContacting()).toBe(false);
  });

  it('establishes world release safety across image/world source switches', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    const imageContact = { depthSource: 'image' as const };
    expect(control.update(gestureFrame(CLOSED, 120, imageContact))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 160, imageContact))).toBe('latched');
    // One reliable-world contact establishes conservative release margins;
    // the ordinary state edge then requires two fresh release observations.
    expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
    const sideRelease = { pinchDepth: 0.4, pinch3d: 0.55, depthSource: 'world' as const };
    expect(control.update(gestureFrame(CLOSED, 240, sideRelease))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 280, sideRelease))).toBe('aim-locked');
    expect(control.update(gestureFrame(CLOSED, 320, sideRelease))).toBe('none');

    // Tap two begins on image-z and switches directly to separated world data,
    // exercising the no-baseline fallback without granting image-z release.
    expect(control.update(gestureFrame(CLOSED, 360, imageContact))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 400, imageContact))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 440, sideRelease))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 480, sideRelease))).toBe('released');
    expect(control.update(gestureFrame(CLOSED, 520, sideRelease))).toBe('none');

    const imageRelease = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => imageRelease.update(gestureFrame(SEPARATED, time)));
    imageRelease.update(gestureFrame(CLOSED, 120, imageContact));
    expect(imageRelease.update(gestureFrame(CLOSED, 160, imageContact))).toBe('latched');
    const imageDepthSpike = { pinchDepth: 0.8, pinch3d: 0.95, depthSource: 'image' as const };
    const imageEvents = [200, 240, 280].map((time) => (
      imageRelease.update(gestureFrame(CLOSED, time, imageDepthSpike))
    ));
    expect(imageEvents).not.toContain('aim-locked');
    expect(imageEvents).not.toContain('released');
  });

  it('accepts complete far and close hands but rejects undersampled/extreme scales', () => {
    for (const scale of [0.055, 0.7]) {
      const control = new PinchDoubleTapControl();
      [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time, { palmScale: scale })));
      expect(control.getPhase()).toBe('ready');
      expect(control.update(gestureFrame(CLOSED, 120, { palmScale: scale }))).toBe('none');
      expect(control.update(gestureFrame(CLOSED, 160, { palmScale: scale }))).toBe('latched');
    }
    for (const scale of [0.02, 0.85]) {
      const control = new PinchDoubleTapControl();
      [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
      expect(control.update(gestureFrame(CLOSED, 120, { palmScale: scale }))).toBe('none');
      expect(control.update(gestureFrame(CLOSED, 160, { palmScale: scale }))).toBe('none');
      expect(control.getPhase()).toBe('ready');
    }
    const undersampled = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => undersampled.update(gestureFrame(SEPARATED, time)));
    expect(undersampled.update(gestureFrame(CLOSED, 120, {
      palmScale: 0.04,
      rawPalmScale: 0.04,
      palmPixels: 11.5,
    }))).toBe('none');
    expect(undersampled.isContacting()).toBe(false);
  });

  it('vetoes repeated extreme depth contradiction and needs two side-view release frames', () => {
    const control = new PinchDoubleTapControl();
    const depthSeparated = { pinchDepth: 0.78, pinch3d: 0.94 };
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.getPhase()).toBe('ready');
    expect(control.update(gestureFrame(CLOSED, 120, depthSeparated))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 160, depthSeparated))).toBe('none');
    expect(control.isContacting()).toBe(false);

    expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 240))).toBe('latched');
    expect(control.update(gestureFrame(CLOSED, 280))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 320, depthSeparated))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 360, depthSeparated))).toBe('aim-locked');
    expect(control.update(gestureFrame(CLOSED, 400, depthSeparated))).toBe('none');
    expect(control.getPhase()).toBe('tap-two');
    expect(control.isContacting()).toBe(false);
  });

  it('completes both releases when separation is visible only in reliable world depth', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    expect(control.update(gestureFrame(CLOSED, 120))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 160))).toBe('latched');
    expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
    const sideRelease = { pinchDepth: 0.4, pinch3d: 0.55, depthSource: 'world' as const };
    expect(control.update(gestureFrame(CLOSED, 240, sideRelease))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 280, sideRelease))).toBe('aim-locked');
    expect(control.update(gestureFrame(CLOSED, 320, sideRelease))).toBe('none');

    expect(control.update(gestureFrame(CLOSED, 360))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 400))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 440, sideRelease))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 480, sideRelease))).toBe('released');
    expect(control.update(gestureFrame(CLOSED, 520, sideRelease))).toBe('none');
  });

  it('lets repeated strong 2D contact win over moderate world-depth jitter', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    const projectedOverlap = { pinchDepth: 0.4, pinch3d: 0.55, depthSource: 'world' as const };
    expect(control.update(gestureFrame(CLOSED, 120, projectedOverlap))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 160, projectedOverlap))).toBe('latched');
    expect(control.isContacting()).toBe(true);
    expect(control.getPhase()).toBe('aim');
  });

  it('tolerates one brief neutral frame but ignores duplicate or old frames', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => control.update(gestureFrame(OPEN, time)));

    expect(control.update(gestureFrame(CLOSED, 200))).toBe('none');
    expect(control.update(gestureFrame(NEUTRAL, 240, {
      depthSource: 'image',
      pinchDepth: 0.45,
      pinch3d: 0.62,
    }))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 280))).toBe('latched');
    expect(control.update(gestureFrame(CLOSED, 300, { filteredPinch: OPEN }))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 280))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 260))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 340))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 380))).toBe('none');
  });

  it('requires two observations for an ordinary tap-two contact', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => control.update(gestureFrame(OPEN, time)));
    control.update(gestureFrame(CLOSED, 200));
    control.update(gestureFrame(CLOSED, 240));
    control.update(gestureFrame(CLOSED, 300));
    control.update(gestureFrame(OPEN, 340));
    expect(control.update(gestureFrame(OPEN, 380))).toBe('aim-locked');

    const ordinary = gestureFrame(0.4, 430, { filteredPinch: 0.4, pinch3d: 0.52, pinchDepth: 0.3 });
    expect(control.update(ordinary)).toBe('none');
    expect(control.update(gestureFrame(OPEN, 470))).toBe('none');
    expect(control.update(gestureFrame(OPEN, 510))).toBe('none');
    expect(control.isEngaged()).toBe(true);
  });

  it('rejects an overlong confirmation contact and a switched or displaced hand', () => {
    const tooLong = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => tooLong.update(gestureFrame(OPEN, time)));
    tooLong.update(gestureFrame(CLOSED, 200));
    tooLong.update(gestureFrame(CLOSED, 240));
    tooLong.update(gestureFrame(CLOSED, 300));
    tooLong.update(gestureFrame(OPEN, 340));
    tooLong.update(gestureFrame(OPEN, 380));
    tooLong.update(gestureFrame(CLOSED, 450));
    tooLong.update(gestureFrame(CLOSED, 490));
    expect(tooLong.update(gestureFrame(CLOSED, 941))).toBe('cancelled');

    const switched = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => switched.update(gestureFrame(OPEN, time)));
    switched.update(gestureFrame(CLOSED, 200));
    switched.update(gestureFrame(CLOSED, 240));
    switched.update(gestureFrame(CLOSED, 300));
    switched.update(gestureFrame(OPEN, 340));
    switched.update(gestureFrame(OPEN, 380));
    expect(switched.update(gestureFrame(CLOSED, 450, { palmX: 0.7, handedness: 'Left' }))).toBe('none');
    expect(switched.update(gestureFrame(CLOSED, 490, { palmX: 0.7, handedness: 'Left' }))).toBe('none');
    expect(switched.update(gestureFrame(CLOSED, 530, { palmX: 0.7, handedness: 'Left' }))).toBe('cancelled');
  });

  it('cancels on tracking loss, ignores stale frames and requires a fresh rearm', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => control.update(gestureFrame(OPEN, time)));
    control.update(gestureFrame(CLOSED, 200));
    expect(control.update(gestureFrame(CLOSED, 240))).toBe('latched');
    expect(control.cancelForLoss(569, 240)).toBe('none');
    expect(control.cancelForLoss(570, 240)).toBe('cancelled');
    expect(control.update(gestureFrame(CLOSED, 540))).toBe('none');
    expect(control.update(gestureFrame(SEPARATED, 580))).toBe('none');
    expect(control.update(gestureFrame(SEPARATED, 620))).toBe('none');
    expect(control.getPhase()).toBe('ready');
    expect(control.update(gestureFrame(CLOSED, 660))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 700))).toBe('latched');
  });

  it('never accepts projected fingertip overlap as a second contact when depth is separated', () => {
    const control = new PinchDoubleTapControl();
    [0, 40, 80, 120, 160].forEach((time) => control.update(gestureFrame(OPEN, time)));
    control.update(gestureFrame(CLOSED, 200));
    expect(control.update(gestureFrame(CLOSED, 240))).toBe('latched');
    control.update(gestureFrame(CLOSED, 300));
    control.update(gestureFrame(OPEN, 340));
    expect(control.update(gestureFrame(OPEN, 380))).toBe('aim-locked');

    const separated = { pinchDepth: 0.82, pinch3d: 1.05 };
    expect(control.update(gestureFrame(CLOSED, 430, separated))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 470, separated))).toBe('none');
    expect(control.update(gestureFrame(CLOSED, 510, separated))).toBe('none');
    expect(control.isEngaged()).toBe(true);
  });

  it('moves most of the way to a new aim sample within three 30 FPS results', () => {
    const filter = new HandAimFilter();
    filter.filter({ x: 0.1, y: 0.1 }, 0);
    filter.filter({ x: 0.9, y: 0.9 }, 33.34);
    filter.filter({ x: 0.9, y: 0.9 }, 66.67);
    const result = filter.filter({ x: 0.9, y: 0.9 }, 100);

    expect(result.x).toBeGreaterThan(0.8);
    expect(result.y).toBeGreaterThan(0.79);
  });
});

describe('hand-tracking pipeline latency invariants', () => {
  const main = readText('src/main.ts');
  const tracking = readText('src/game/handtracking.ts');
  const settings = readText('src/game/handsettings.ts');
  const setup = readText('src/scenes/HandSetupScene.ts');
  const game = readText('src/scenes/GameScene.ts');
  const endless = readText('src/scenes/EndlessScene.ts');
  const worker = readText('src/game/handtracking.worker.ts');

  it('prewarms the model for an uncalibrated first-time player during app startup', () => {
    const startGame = main.slice(main.indexOf('async function startGame()'));
    const warm = startGame.indexOf('getHandTracker().prepare()');
    const fontWait = startGame.indexOf('await waitForGameFonts()');

    expect(warm).toBeGreaterThan(-1);
    expect(warm).toBeLessThan(fontWait);
    expect(startGame.slice(0, fontWait)).not.toContain('getHandSettings');
  });

  it('keeps prewarm camera-free, idempotent and primes the first inference', () => {
    const prepare = tracking.slice(
      tracking.indexOf('prepare(): Promise<void>'),
      tracking.indexOf('setPreviewVisible', tracking.indexOf('prepare(): Promise<void>')),
    );
    const ensureModel = tracking.slice(
      tracking.indexOf('private ensureModel()'),
      tracking.indexOf('private resetWorker()', tracking.indexOf('private ensureModel()')),
    );

    expect(prepare).toContain('return this.ensureModel()');
    expect(prepare).not.toContain('getUserMedia');
    expect(ensureModel.indexOf('if (this.workerReady)')).toBeLessThan(ensureModel.indexOf('new Worker'));
    expect(ensureModel.indexOf('if (this.workerInitPromise)')).toBeLessThan(ensureModel.indexOf('new Worker'));
    expect(worker).toContain('function primeRecognizer(): void');
    expect(worker).toContain('recognizer.detectForVideo(canvas, 0)');
    expect(tracking).toContain("mediapipe/models/hand_landmarker.task");
    expect(worker.indexOf('primeRecognizer();')).toBeGreaterThan(worker.indexOf("options('CPU')"));
  });

  it('does not let render quality silently throttle recognition cadence', () => {
    expect(tracking).toContain('1000 / settings.targetFps');
    expect(tracking).toContain('requestVideoFrameCallback');
    expect(tracking).toContain('do this.nextCaptureAt += interval');
    expect(tracking).not.toContain('message.inferenceMs * 1.18');
    expect(tracking).not.toContain('getQualityProfile');
  });

  it('starts the model with camera startup and immediately schedules the first frame', () => {
    const modelStart = tracking.indexOf('const modelReady = this.ensureModel()');
    const cameraStart = tracking.indexOf('await this.startCamera()', modelStart);
    const modelAwait = tracking.indexOf('const modelError = await modelReady', cameraStart);
    expect(modelStart).toBeGreaterThan(-1);
    expect(modelStart).toBeLessThan(cameraStart);
    expect(cameraStart).toBeLessThan(modelAwait);
    expect(tracking).toContain('this.scheduleFrame(this.nextCaptureAt)');
  });

  it('uses a fresh non-destructive calibration sample and rejects old-session frames', () => {
    expect(setup).not.toContain('getHandTracker().sample()');
    expect(setup).toContain('getHandTracker().peekSample()');
    expect(setup).toContain('getHandTracker().peekSample(220)');
    expect(setup).toContain('values.length < 9');
    expect(setup).toContain('values.push(sample.rawPinch)');
    expect(setup).toContain("usesWorldDepth ? 0.35 : 0.52");
    expect(setup).toContain('sample.depthSource');
    expect(setup).toContain('this.releaseNoise');
    expect(tracking).toContain('peekSample(maxAgeMs = 150)');
    expect(tracking).toContain('message.generation !== this.captureGeneration');
    expect(worker).toContain('generation: number');
    expect(worker).toContain('frameId: number');
  });

  it('bounds camera frames and keeps only light final cursor interpolation', () => {
    expect(tracking).toContain('handInferenceEdge({');
    expect(tracking).toContain("const resizeQuality: ResizeQuality = 'medium'");
    expect(tracking).toContain('handFarDetailMode(this.farDetailMode, this.lastPalmScale)');
    expect(tracking).toContain('new HandInferenceGovernor()');
    expect(tracking).toContain('this.inferenceGovernor.observe(pipelineMs');
    expect(tracking).toContain('const acquisitionOverride = this.detailAcquisitionSamples < 3');
    expect(tracking).toContain('Math.max(HAND_DETAIL_FALLBACK_EDGE, this.inferenceGovernor.edgeCap())');
    expect(tracking).toContain('Math.min(requestedEdge, adaptiveCap)');
    expect(tracking).toContain('width: { ideal: 640, max: 640 }');
    expect(tracking).toContain('requestDefaultCamera()');
    expect(tracking).toContain('void this.optimiseCameraTrack(track)');
    expect(tracking).toContain("controls.push({ focusMode: 'continuous' })");
    expect(tracking).toContain("controls.push({ exposureMode: 'continuous' })");
    expect(tracking).toContain("controls.push({ whiteBalanceMode: 'continuous' })");
    expect(tracking).toContain('await track.applyConstraints({ advanced: [Object.assign({}, ...controls)] })');
    expect(tracking).toContain('await track.applyConstraints({ advanced: [control] })');
    expect(worker).toContain('handLightingProfile');
    expect(worker).toContain('inferenceSource(bitmap, startedAt)');
    expect(game).toContain('this.pinchControl.isLatched() ? 14 : 12');
    expect(game).toContain('this.updateAimAt(this.handSmooth.x, this.handSmooth.y, true)');
  });

  it('keeps optional lighting fail-open and preserves conservative model gates', () => {
    expect(worker).toContain('canvasInputSupported = false');
    expect(worker).toContain('return { source: bitmap, enhanced: false }');
    expect(worker).toContain('HandEnhancementBudget');
    expect(worker).toContain('enhancementBudget.observe(totalFrameMs, enhanced)');
    expect(worker).toContain('result = recognizer.detectForVideo(bitmap, timestampMs)');
    expect(worker).toContain('enhanced,');
    expect(worker).toContain('minHandDetectionConfidence: 0.35');
    expect(worker).toContain('minHandPresenceConfidence: 0.35');
    expect(worker).toContain('minTrackingConfidence: 0.4');
    const frameHandler = worker.slice(worker.indexOf('const { bitmap, timestampMs'));
    expect(frameHandler).toContain('finally {\n    bitmap.close();');
    expect(tracking).toContain('gestureStable: this.lightingStableFrames >= 1');
    expect(tracking).not.toContain('result.enhanced !== this.gestureEnhanced');
    expect(game).toContain('this.handContinuity.observe(s.gestureStable && s.usableForGesture');
    expect(game).toContain('this.pinchControl.resetForContinuity()');
    expect(game).toContain("continuity === 'cancel'");
    expect(game).toContain("this.handBtn?.setText(s.gestureStable ? 'UNCERTAIN' : 'STABLE')");
  });

  it('feeds capture-time dual pinch evidence into a single physical pinch/release shot', () => {
    expect(tracking).toContain('rawPinch,');
    expect(tracking).toContain('filteredPinch: smoothPinch');
    expect(tracking).toContain('this.identityStabilizer.update({');
    expect(tracking).toContain('handedness: identity.identity');
    expect(tracking).toContain('handednessScore: identity.trusted ? identity.score : 0');
    expect(game).toContain('this.pinchControl.update(s)');
    expect(game).toContain('{ fireOnFirstRelease: true }');
    expect(game).toContain('this.handPinching = this.pinchControl.isContacting()');
    expect(game).toContain('this.pinchControl.resetForShot()');
    const shootAt = game.slice(game.indexOf('private shootAt('), game.indexOf('private startGhostReplay(', game.indexOf('private shootAt(')));
    expect(shootAt).toContain('this.pinchControl.resetForShot()');
    expect(shootAt).not.toContain('this.pinchControl.reset()');
    expect(game).toContain("pinchEvent === 'aim-locked'");
    expect(game).toContain('const predictedRelease = this.handAimPredictor.predict(now)');
    expect(game).toContain('this.handLockedAim ?? predictedAim ?? this.handTarget');
    expect(game).toContain('this.handCursor?.setPosition(aim.x, aim.y)');
    expect(endless).toContain('const predictedRelease = this.handAimPredictor.predict(now)');
    expect(endless).toContain('this.selectedLane = endlessLaneForBoardX(this.grid, releasePoint.x)');
    expect(settings).toContain('MIN_CONTACT_HYSTERESIS');
    expect(tracking).toContain('rawPinch >= settings.pinchOff');
  });

  it('keeps one-frame dropouts from clearing aim or emitting empty samples', () => {
    expect(tracking).toContain('DROPOUT_GRACE_MS = 260');
    const processResult = tracking.slice(
      tracking.indexOf('private processResult('),
      tracking.indexOf('/** Schedule one worker frame', tracking.indexOf('private processResult(')),
    );
    const missingBranch = processResult.slice(
      processResult.indexOf('if (!lm || !validLandmarks)'),
      processResult.indexOf('this.missingSince = 0'),
    );
    expect(processResult.indexOf('this.lightingMode = result.lightingMode')).toBeLessThan(
      processResult.indexOf('if (!lm || !validLandmarks)'),
    );
    expect(missingBranch).toContain('now - this.missingSince >= DROPOUT_GRACE_MS');
    expect(missingBranch).not.toContain('this.sampleSequence++');
    expect(processResult.indexOf('this.sampleSequence++')).toBeGreaterThan(processResult.indexOf('this.latestSample ='));
  });

  it('uses stable palm bones plus world depth and never the middle fingertip for scale', () => {
    const geometry = readText('src/game/handgeometry.ts');
    expect(worker).toContain('result.worldLandmarks');
    expect(tracking).toContain('worldLandmarks: result.worldLandmarks');
    expect(geometry).toContain('pointAt(landmarks, 5), pointAt(landmarks, 17)');
    expect(geometry).toContain('pointAt(landmarks, 0), pointAt(landmarks, 9)');
    const palmFunction = geometry.slice(geometry.indexOf('export function palmScale'), geometry.indexOf('/** Thumb-tip'));
    expect(palmFunction).not.toContain('12');
  });

  it('guards hung frames and automatically rebuilds failed camera/worker layers', () => {
    expect(tracking).toContain("PendingPhase = 'none' | 'bitmap' | 'worker'");
    expect(tracking).toContain('BITMAP_TIMEOUT_MS = 700');
    expect(tracking).toContain("new Error('Gesture inference timed out')");
    expect(tracking).toContain("this.queueCameraRecovery('video frames stopped')");
    expect(tracking).toContain('worker.onmessageerror');
    expect(tracking).toContain('message.frameId !== this.pendingFrameId');
    expect(worker).toContain('frameId,');
  });

  it('invalidates stale camera starts and only resumes an actively used camera', () => {
    expect(tracking).toContain('requestId !== this.cameraRequestId');
    expect(tracking).toContain('candidate.getTracks().forEach((track) => track.stop())');
    expect(tracking).toContain('this.activeDesired = false');
    expect(tracking).toContain('this.resumeAfterVisibility = true');
    expect(tracking).toContain("this.queueCameraRecovery('page resumed')");
  });
});
