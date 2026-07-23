import { describe, expect, it } from 'vitest';
import {
  LEVEL_ZERO_TUTORIAL_FIXTURE,
  LEVEL_ZERO_TUTORIAL_VERSION,
  TUTORIAL_PROGRESS_CORRUPT_STORAGE_KEY,
  TUTORIAL_PROGRESS_STORAGE_KEY,
  LevelZeroTutorialMachine,
  TutorialProgressStore,
  decideLevelZeroTutorialLaunch,
  levelZeroTutorialSteps,
  parseTutorialProgress,
  tutorialGate,
  tutorialSignalCompletesStep,
  type TutorialSignal,
  type TutorialStorage,
} from '../src/game/tutorial';

class MemoryStorage implements TutorialStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const objectiveViewed: TutorialSignal = {
  type: 'objective-viewed',
  visible: true,
  kind: 'clear-grid',
  current: 0,
  target: 1,
};

const dangerLineViewed: TutorialSignal = {
  type: 'danger-line-viewed',
  visible: true,
  row: LEVEL_ZERO_TUTORIAL_FIXTURE.dangerLineRow,
};

const nextOrbViewed: TutorialSignal = {
  type: 'next-orb-viewed',
  visible: true,
  currentColor: 'blue',
  nextColor: 'red',
};

const orbSwapped: TutorialSignal = {
  type: 'orb-swapped',
  beforeCurrent: 'blue',
  beforeNext: 'red',
  afterCurrent: 'red',
  afterNext: 'blue',
};

const aimTargeted: TutorialSignal = {
  type: 'aim-targeted',
  target: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target,
  angularErrorDegrees: 1.25,
};

const shotFired: TutorialSignal = {
  type: 'shot-fired',
  fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
  color: 'red',
  target: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target,
};

const shotResolved: TutorialSignal = {
  type: 'shot-resolved',
  fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
  matched: 3,
  dropped: 2,
};

function advanceToAim(machine: LevelZeroTutorialMachine): void {
  expect(machine.dispatch(objectiveViewed).accepted).toBe(true);
  expect(machine.dispatch(dangerLineViewed).accepted).toBe(true);
  expect(machine.dispatch(nextOrbViewed).accepted).toBe(true);
  expect(machine.dispatch(orbSwapped).accepted).toBe(true);
  expect(machine.snapshot().currentStep).toBe('aim');
}

describe('Level-0 playable tutorial state machine', () => {
  it('requires the authored HUD interactions, real swap, aim, shot, match and drop in exact order', () => {
    let nowMs = 1_800_000_000_000;
    const storage = new MemoryStorage();
    const progressStore = new TutorialProgressStore({ storage, now: () => nowMs });
    const machine = new LevelZeroTutorialMachine({
      inputMode: 'mouse',
      progressStore,
    });

    const start = machine.start();
    expect(start.accepted).toBe(true);
    expect(start.actions).toEqual([
      { type: 'load-fixture', fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id },
      expect.objectContaining({ type: 'show-step', step: 'objective' }),
    ]);
    expect(start.snapshot).toMatchObject({
      currentStep: 'objective',
      canAim: false,
      canShoot: false,
      canSkip: true,
      stepCount: 8,
    });
    expect(start.snapshot.currentPrompt?.title).toBe('Know the mission');
    expect(machine.canPerform('inspect-objective')).toBe(true);
    expect(machine.canPerform('fire')).toBe(false);

    // A generic click or a future-step gameplay event cannot bypass the gate.
    expect(machine.dispatch(shotFired).accepted).toBe(false);
    expect(machine.snapshot().currentStep).toBe('objective');

    advanceToAim(machine);
    expect(machine.snapshot()).toMatchObject({
      currentStep: 'aim',
      canAim: true,
      canShoot: false,
    });
    expect(machine.dispatch({
      ...aimTargeted,
      angularErrorDegrees: 2.51,
    }).accepted).toBe(false);
    expect(machine.dispatch(aimTargeted).accepted).toBe(true);
    expect(machine.snapshot()).toMatchObject({
      currentStep: 'fire',
      canAim: true,
      canShoot: true,
    });

    expect(machine.dispatch({ ...shotFired, color: 'green' }).accepted).toBe(false);
    expect(machine.dispatch(shotFired).accepted).toBe(true);
    expect(machine.snapshot()).toMatchObject({
      currentStep: 'match-three',
      canAim: false,
      canShoot: false,
    });

    // One physical shot result can truthfully prove both sequential outcomes.
    nowMs += 5_000;
    const resolution = machine.dispatch(shotResolved);
    expect(resolution.accepted).toBe(true);
    expect(resolution.completedSteps).toEqual(['match-three', 'drop-cluster']);
    expect(resolution.actions).toEqual([
      { type: 'step-completed', step: 'match-three' },
      { type: 'step-completed', step: 'drop-cluster' },
      {
        type: 'tutorial-completed',
        tutorialVersion: LEVEL_ZERO_TUTORIAL_VERSION,
        runMode: 'first-run',
      },
    ]);
    expect(resolution.snapshot).toMatchObject({
      status: 'completed',
      currentStep: null,
      canAim: true,
      canShoot: true,
      canSkip: false,
    });
    expect(progressStore.read()).toMatchObject({
      completedVersion: LEVEL_ZERO_TUTORIAL_VERSION,
      skippedVersion: 0,
      playCount: 1,
      replayCount: 0,
      completedAtMs: nowMs,
    });
    expect(parseTutorialProgress(JSON.parse(
      storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY) ?? '{}',
    ))).toEqual(progressStore.read());
  });

  it('inserts two fail-closed touch/release gates only for hand input', () => {
    expect(levelZeroTutorialSteps('touch')).not.toContain('hand-touch-one');
    expect(levelZeroTutorialSteps('hand')).toEqual([
      'objective',
      'danger-line',
      'next-orb',
      'swap',
      'aim',
      'hand-touch-one',
      'hand-touch-two',
      'fire',
      'match-three',
      'drop-cluster',
    ]);

    const machine = new LevelZeroTutorialMachine({ inputMode: 'hand' });
    machine.start();
    advanceToAim(machine);
    expect(machine.dispatch(aimTargeted).accepted).toBe(true);
    expect(machine.snapshot()).toMatchObject({
      currentStep: 'hand-touch-one',
      canAim: true,
      canShoot: false,
    });
    expect(machine.canPerform('hand-touch')).toBe(true);

    expect(machine.dispatch({
      type: 'hand-touch-one',
      reliable: false,
      releaseConfirmed: true,
    }).accepted).toBe(false);
    expect(machine.dispatch({
      type: 'hand-touch-one',
      reliable: true,
      releaseConfirmed: false,
    }).accepted).toBe(false);
    expect(machine.dispatch({
      type: 'hand-touch-one',
      reliable: true,
      releaseConfirmed: true,
    }).accepted).toBe(true);
    expect(machine.snapshot().currentStep).toBe('hand-touch-two');

    // Repeating touch one cannot count as touch two.
    expect(machine.dispatch({
      type: 'hand-touch-one',
      reliable: true,
      releaseConfirmed: true,
    }).accepted).toBe(false);
    expect(machine.dispatch({
      type: 'hand-touch-two',
      reliable: true,
      releaseConfirmed: true,
    }).accepted).toBe(true);
    expect(machine.snapshot()).toMatchObject({
      currentStep: 'fire',
      canAim: true,
      canShoot: true,
    });
  });

  it('falls back from hand-only gates without restarting or trapping the player', () => {
    const machine = new LevelZeroTutorialMachine({ inputMode: 'hand' });
    machine.start();
    advanceToAim(machine);
    expect(machine.dispatch(aimTargeted).accepted).toBe(true);
    expect(machine.dispatch({
      type: 'hand-touch-one',
      reliable: true,
      releaseConfirmed: true,
    }).accepted).toBe(true);
    expect(machine.snapshot().currentStep).toBe('hand-touch-two');

    const fallback = machine.fallbackToPointer('mouse');
    expect(fallback.accepted).toBe(true);
    expect(fallback.actions).toEqual([
      expect.objectContaining({ type: 'show-step', step: 'fire' }),
    ]);
    expect(fallback.snapshot).toMatchObject({
      inputMode: 'mouse',
      currentStep: 'fire',
      stepCount: 8,
      canShoot: true,
    });
    expect(fallback.snapshot.completedSteps).not.toContain('hand-touch-one');
    expect(machine.fallbackToPointer('touch').accepted).toBe(false);
    expect(machine.dispatch(shotFired).accepted).toBe(true);
  });

  it('exposes deterministic fixture, prompt and gate contracts', () => {
    const first = new LevelZeroTutorialMachine({ inputMode: 'keyboard' });
    const second = new LevelZeroTutorialMachine({ inputMode: 'keyboard' });
    expect(first.start()).toEqual(second.start());
    expect(LEVEL_ZERO_TUTORIAL_FIXTURE).toMatchObject({
      initialQueue: ['blue', 'red', 'green'],
      guaranteedShot: {
        color: 'red',
        target: { row: 1, col: 1 },
        minimumMatched: 3,
        minimumDropped: 2,
      },
      objective: { kind: 'clear-grid', current: 0, target: 1 },
    });
    expect(tutorialGate('fire')).toMatchObject({
      allowedActions: ['aim', 'fire', 'pause', 'skip'],
      canAim: true,
      canShoot: true,
    });
    expect(tutorialSignalCompletesStep('drop-cluster', {
      ...shotResolved,
      dropped: 1,
    })).toBe(false);
    expect(tutorialSignalCompletesStep('drop-cluster', shotResolved)).toBe(true);
  });

  it('persists skip, never auto-blocks returning players, and replays only when forced', () => {
    let nowMs = 1_800_000_010_000;
    const progressStore = new TutorialProgressStore({ now: () => nowMs });
    expect(decideLevelZeroTutorialLaunch(progressStore.read(), {
      isReturningPlayer: true,
    })).toEqual({
      shouldStart: false,
      runMode: null,
      reason: 'returning-player',
      blocksNormalPlay: false,
    });
    expect(decideLevelZeroTutorialLaunch(progressStore.read(), {
      isReturningPlayer: false,
    })).toEqual({
      shouldStart: true,
      runMode: 'first-run',
      reason: 'first-run',
      blocksNormalPlay: false,
    });

    const machine = new LevelZeroTutorialMachine({ inputMode: 'touch', progressStore });
    machine.start();
    nowMs += 1_000;
    expect(machine.skip().snapshot.status).toBe('skipped');
    expect(progressStore.read()).toMatchObject({
      skippedVersion: LEVEL_ZERO_TUTORIAL_VERSION,
      playCount: 1,
      replayCount: 0,
    });
    expect(machine.canPerform('fire')).toBe(true);
    expect(machine.canPerform('swap')).toBe(true);
    expect(machine.start().accepted).toBe(false);
    expect(decideLevelZeroTutorialLaunch(progressStore.read(), {
      isReturningPlayer: false,
    }).reason).toBe('skipped');

    const replayDecision = decideLevelZeroTutorialLaunch(progressStore.read(), {
      isReturningPlayer: true,
      forceReplay: true,
    });
    expect(replayDecision).toEqual({
      shouldStart: true,
      runMode: 'replay',
      reason: 'force-replay',
      blocksNormalPlay: false,
    });
    nowMs += 1_000;
    const replay = machine.forceReplay('hand');
    expect(replay.snapshot).toMatchObject({
      status: 'active',
      runMode: 'replay',
      inputMode: 'hand',
      currentStep: 'objective',
      stepCount: 10,
    });
    expect(progressStore.read()).toMatchObject({
      playCount: 2,
      replayCount: 1,
    });
  });

  it('quarantines corrupt records and rejects unknown or unbounded fields', () => {
    const storage = new MemoryStorage();
    storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, `${JSON.stringify({
      schemaVersion: 1,
      completedVersion: 999_999_999,
      skippedVersion: 0,
      playCount: 0,
      replayCount: 0,
      updatedAtMs: 0,
      completedAtMs: 0,
      skippedAtMs: 0,
      cameraLandmarks: [{ x: 0.5, y: 0.5 }],
    })}${'x'.repeat(40_000)}`);
    const store = new TutorialProgressStore({
      storage,
      now: () => 1_800_000_020_000,
    });
    expect(store.read()).toEqual({
      schemaVersion: 1,
      completedVersion: 0,
      skippedVersion: 0,
      playCount: 0,
      replayCount: 0,
      updatedAtMs: 0,
      completedAtMs: 0,
      skippedAtMs: 0,
    });
    expect(storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY)).toBeNull();
    const evidence = JSON.parse(
      storage.getItem(TUTORIAL_PROGRESS_CORRUPT_STORAGE_KEY) ?? '{}',
    ) as { capturedAtMs?: number; raw?: string };
    expect(evidence.capturedAtMs).toBe(1_800_000_020_000);
    expect(evidence.raw).toHaveLength(32_768);
    expect(parseTutorialProgress({
      schemaVersion: 1,
      completedVersion: 0,
      skippedVersion: 0,
      playCount: 1,
      replayCount: 2,
      updatedAtMs: 0,
      completedAtMs: 0,
      skippedAtMs: 0,
    })).toBeNull();
  });

  it('keeps completion and skip versions monotonic even if the device clock moves backward', () => {
    let nowMs = 2_000;
    const store = new TutorialProgressStore({ now: () => nowMs });
    store.markStarted(3, false);
    store.markCompleted(3);
    nowMs = 1_000;
    store.markCompleted(1);
    store.markSkipped(4);
    store.markSkipped(2);
    expect(store.read()).toMatchObject({
      completedVersion: 3,
      skippedVersion: 4,
      updatedAtMs: 2_000,
      completedAtMs: 2_000,
      skippedAtMs: 2_000,
    });
  });
});
