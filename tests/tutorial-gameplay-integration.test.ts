import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(
  fileURLToPath(new URL(`../${path}`, import.meta.url)),
  'utf8',
);
const game = read('src/scenes/GameScene.ts');
const modes = read('src/scenes/ModeSelectScene.ts');

function section(start: string, end: string): string {
  const from = game.indexOf(start);
  const to = game.indexOf(end, from + start.length);
  expect(from, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from);
  return game.slice(from, to);
}

describe('Level-0 tutorial gameplay adapter', () => {
  it('auto-launches only safe first runs and preserves explicit replay', () => {
    const setup = section(
      '  private configureTutorialSession(): void {',
      '  private isTutorialActive(): boolean {',
    );
    expect(setup).toContain('this.level !== 0 || this.challenge || this.arena || this.replayTrace');
    expect(setup).toContain('decideLevelZeroTutorialLaunch');
    expect(setup).toContain('isReturningPlayer');
    expect(setup).toContain('forceReplay: this.tutorialReplayRequested');
    expect(setup).toContain('new LevelZeroTutorialMachine');

    const retry = section('  private restartRunData():', '  // ── helpers');
    expect(retry).toContain('tutorialReplay: true');
  });

  it('loads the authored sparse teaching board while normal campaign openings stay deterministic', () => {
    const create = section('  create(): void {', '  /** Build a faceted crystal command plate');
    expect(create).toContain('LEVEL_ZERO_TUTORIAL_FIXTURE.opening');
    expect(create).toContain('buildCampaignOpening({ level: this.level, mode: this.mode })');
    expect(create).toContain('this.buildGrid(def.rows, campaignOpening?.grid)');
    expect(create).toContain('this.geom.topPad = this.isTutorialActive() ? 288 : 200');

    const grid = section('  private buildGrid(', '  private toCells():');
    expect(grid).toContain('if (authoredColor === null) continue;');
    expect(grid).toContain('const color = authoredColor ??');
  });

  it('connects objective, danger, preview and swap gates to the visible HUD', () => {
    const tutorialAction = section(
      '  private handleTutorialPanelAction(): void {',
      '  private skipTutorial(): void {',
    );
    expect(tutorialAction).toContain("type: 'objective-viewed'");
    expect(tutorialAction).toContain("type: 'danger-line-viewed'");

    const queue = section(
      '  private handleQueueCardPressed(): void {',
      '  private swapPreShotOrbs(): void {',
    );
    expect(queue).toContain("step === 'next-orb'");
    expect(queue).toContain("type: 'next-orb-viewed'");
    expect(queue).toContain("step === 'swap'");
    expect(queue).toContain('this.swapPreShotOrbs()');
    expect(queue).toContain("type: 'orb-swapped'");
  });

  it('accepts only the real aimed shot and real match/drop resolution', () => {
    const aim = section(
      '  private observeTutorialAim(',
      '  private updateAimAt(',
    );
    expect(aim).toContain("type: 'aim-targeted'");
    expect(aim).toContain('angularErrorDegrees');

    const shoot = section(
      '  private shootAt(x: number, y: number): void {',
      '  private startGhostReplay(): void {',
    );
    expect(shoot).toContain("!this.tutorialMachine?.canPerform('fire')");
    expect(shoot).toContain("type: 'shot-fired'");
    expect(shoot).toContain('this.tutorialShotPending = true');

    const landing = section('  private land(): void {', '  private resolve(placed: Bub): void {');
    expect(landing).toContain('LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target');
    const resolution = section('  private resolve(placed: Bub): void {', '  private finishResolvedShot(');
    expect(resolution).toContain("type: 'shot-resolved'");
    expect(resolution).toContain('matched: matched ? cluster.length : 0');
    expect(resolution).toContain('dropped: fell.length');
    expect(resolution).toContain('this.dispatchTutorial({ ...tutorialResolution, dropped: 0 })');
    expect(resolution).toContain('this.time.delayedCall(680');
    expect(resolution).toContain("currentStep !== 'drop-cluster'");
  });

  it('prevents supplies and artifact powers from destroying the authored teaching board', () => {
    const supplies = section(
      '  private async usePowerUp(kind: PowerUp): Promise<void> {',
      '  private useArtifactSuper(): void {',
    );
    const artifact = section(
      '  private useArtifactSuper(): void {',
      '  update(_time: number, delta: number): void {',
    );
    expect(supplies).toContain('if (this.isTutorialActive())');
    expect(supplies).toContain('COMPLETE TRAINING BEFORE USING SUPPLIES');
    expect(artifact).toContain('if (this.isTutorialActive())');
    expect(artifact).toContain('COMPLETE TRAINING BEFORE USING ARTIFACT POWERS');
  });

  it('keeps swap out of challenge, arena and ghost authority paths', () => {
    const swapGate = section(
      '  private canSwapPreShotOrbs(): boolean {',
      '  private setOrbTexture(',
    );
    expect(swapGate).toContain('!this.challenge && !this.arena && !this.replayTrace');
    const replayQueue = section(
      '  private replayColorAt(index: number): ColorKey | undefined {',
      '  private initializeShotQueue(): void {',
    );
    expect(replayQueue).toContain('this.replayTrace?.[index]?.color');
    const initializeQueue = section(
      '  private initializeShotQueue(): void {',
      '  private currentQueueColor(): ColorKey {',
    );
    expect(initializeQueue).toContain('preloadShotQueue(');
    expect(initializeQueue).toContain('LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue');
    const reconcile = section(
      '  private reconcilePreShotQueueWithBoard(): void {',
      '  private setOrbTexture(',
    );
    expect(reconcile).toContain('reconcileShotQueue(this.shotQueue, this.activeBoardColors())');
    expect(game.match(/this\.reconcilePreShotQueueWithBoard\(\);/g)).toHaveLength(3);
  });

  it('falls back from failed hand setup and starts server authority only after training', () => {
    const hand = section(
      '  private async startHandTracking(showError = true): Promise<void> {',
      '  private pollHand(): void {',
    );
    expect(hand).toContain('this.fallbackTutorialToPointerInput()');
    expect(hand).toContain('fallbackToPointer(pointerMode)');
    expect(hand).toContain('this.tutorialInputMode = pointerMode');
    const poll = section(
      '  private pollHand(): void {',
      '  private pollGaze(): void {',
    );
    expect(poll).toContain('if (!this.handHasSeen)');
    expect(poll).toContain("this.renderVisionHud('searching')");
    expect(poll).not.toContain('getHandTracker().disable()');
    expect(poll).not.toContain('this.fallbackTutorialToPointerInput()');

    const create = section('  create(): void {', '  /** Build a faceted crystal command plate');
    expect(create).toContain('!this.isTutorialActive()');
    const dispatch = section(
      '  private dispatchTutorial(signal: TutorialSignal): boolean {',
      '  private seedLevelMechanics(',
    );
    expect(dispatch).toContain("transition.snapshot.status === 'completed'");
    expect(dispatch).toContain('this.beginClassicAuthority()');
    const authority = section(
      '  private beginClassicAuthority(): void {',
      '  private recordClassicAuthorityShot(',
    );
    expect(authority).toContain('this.classicAuthorityTrace = []');
    expect(authority).toContain('this.classicAuthorityStartedAt = Date.now()');
    expect(authority).toContain('const generation = this.runGeneration');
    expect(authority).toContain('generation !== this.runGeneration');
  });

  it('replays every ghost shot sequentially instead of dropping busy callbacks', () => {
    const replay = section(
      '  private startGhostReplay(): void {',
      '  private refreshPowerButtons(): void {',
    );
    expect(replay).toContain('playSequentially(index, 32)');
    expect(replay).toContain('this.replayQueueIndex !== index');
    expect(replay).toContain('if (!this.flying)');
    expect(replay).toContain('GHOST_REPLAY_MAX_DELAY_MS');
    expect(replay).not.toContain('trace.forEach');
  });
});

describe('Tutorial replay entry point', () => {
  it('exposes Learn Controls from Classic without replacing the normal Play action', () => {
    expect(modes).toContain("'LEARN CONTROLS'");
    expect(modes).toContain('tutorialReplay: true');
    expect(modes).toContain("this.scene.start('WorldMap'");
    expect(modes).toContain("y + 101, 'PLAY'");
    expect(modes).not.toContain('PLAY SELECTED');
  });
});
