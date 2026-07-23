import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrateHand, getHandSettings, minimumContactCalibrationGap, updateHandSettings } from '../src/game/handsettings';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: vi.fn() },
  });
});

describe('fingertip contact settings', () => {
  it('preserves device preferences but rejects the legacy wide-open release calibration', () => {
    values.set('paopao-fusion-hand-settings-v12', JSON.stringify({
      deviceId: 'camera-2',
      mirror: false,
      pinchOn: 0.31,
      pinchOff: 0.82,
      calibrated: true,
    }));

    const settings = getHandSettings();
    expect(settings.deviceId).toBe('camera-2');
    expect(settings.mirror).toBe(false);
    expect(settings.pinchOn).toBe(0.44);
    expect(settings.pinchOff).toBe(0.5);
    expect(settings.calibrated).toBe(false);
  });

  it('bounds contact hysteresis so corrupted settings cannot require an open palm', () => {
    expect(updateHandSettings({ pinchOn: 0.42, pinchOff: 0.9 }).pinchOff).toBeCloseTo(0.52, 8);
    expect(updateHandSettings({ pinchOn: 0.42, pinchOff: 0.43 }).pinchOff).toBeCloseTo(0.45, 8);
  });

  it('calibrates touch and release next to the physical-touch sample', () => {
    const settings = calibrateHand(1, 0.2);
    expect(settings).not.toBeNull();
    if (!settings) throw new Error('Expected valid contact calibration');
    expect(settings.pinchOn).toBeCloseTo(0.22, 8);
    expect(settings.pinchOff).toBeCloseTo(0.255, 8);
    expect(settings.pinchOn).toBeLessThan(0.25);
    expect(settings.pinchOff).toBeLessThan(0.3);
    expect(settings.calibrated).toBe(true);
  });

  it('uses measured landmark noise without moving contact toward the open sample', () => {
    const settings = calibrateHand(0.32, 0.2, 0.006, 0.012);
    expect(settings).not.toBeNull();
    if (!settings) throw new Error('Expected valid contact calibration');
    expect(settings.pinchOn).toBeCloseTo(0.23, 8);
    expect(settings.pinchOff).toBeCloseTo(0.278, 8);
    expect(settings.pinchOff).toBeLessThan(0.32);
  });

  it('rejects a noisy boundary capture instead of saving release beyond that pose', () => {
    expect(minimumContactCalibrationGap(0.012, 0.012)).toBeGreaterThan(0.051);
    expect(calibrateHand(0.251, 0.2, 0.012, 0.012)).toBeNull();
    expect(calibrateHand(0.18, 0.1)).toBeNull();
    expect(getHandSettings().calibrated).toBe(false);
  });
});
