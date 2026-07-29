import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/scenes/EndlessScene.ts', import.meta.url),
  'utf8',
);

describe('Nexus Aim offline practice wiring', () => {
  it('creates a bounded daily-seed practice session before any server bootstrap', () => {
    expect(source).toContain('type EndlessSceneData = { event?: boolean; practice?: boolean }');
    expect(source).toContain('export function nexusAimDailySeed(');
    expect(source).toContain("const label = `paopao-nexus-aim-v1:${day}`");
    expect(source).toContain('maximumShots: 30');
    expect(source).toContain("contentVersion: 'nexus-aim-practice-v1'");

    const bootstrap = source.indexOf('private async bootstrapRun');
    const practice = source.indexOf('if (this.practice)', bootstrap);
    const fetch = source.indexOf('await getBootstrapV3()', bootstrap);
    expect(practice).toBeGreaterThan(bootstrap);
    expect(fetch).toBeGreaterThan(practice);
  });

  it('records local arcade bests without entering the authority submission path', () => {
    const finish = source.indexOf('private async finishRun');
    const practice = source.indexOf('if (this.practice)', finish);
    const localRecord = source.indexOf("recordArcadeResult('nexus-aim'", practice);
    const finalize = source.indexOf('await finalizeEndlessRunSubmission', finish);
    const submit = source.indexOf('await this.submitPending()', finish);

    expect(practice).toBeGreaterThan(finish);
    expect(localRecord).toBeGreaterThan(practice);
    expect(finalize).toBeGreaterThan(localRecord);
    expect(submit).toBeGreaterThan(finalize);
    expect(source).toContain('PRACTICE • LOCAL • NO WALLET REWARD');
    expect(source).toContain('NO COINS, WALLET BALANCE, EVENT REWARD, OR CAMPAIGN PROGRESS CHANGED.');
  });

  it('keeps every existing input path and returns practice to the arcade hub', () => {
    for (const input of [
      "fireSelectedLane('pointer')",
      "fireSelectedLane('keyboard')",
      "fireSelectedLane('hand')",
      "fireSelectedLane('gaze')",
      "fireSelectedLane('gaze-hand')",
    ]) expect(source).toContain(input);
    expect(source).toContain("this.scene.restart({ practice: true })");
    expect(source).toContain("this.scene.start(this.practice ? 'ArcadeHub'");
  });

  it('exposes the target, lane, camera and back controls accessibly', () => {
    expect(source).toContain("id: this.practice ? 'nexus-aim'");
    expect(source).toContain('Nexus Aim Trial: thirty-shot daily practice');
    expect(source).toContain('Target lane ${target.lane + 1}');
    expect(source).toContain('this.a11y?.announce(`Aim lane ${this.selectedLane + 1}.`)');
    expect(source).toContain("label: this.handStarting");
    expect(source).toContain('pressed: this.handOn');
    expect(source).toContain("setArtButtonHitArea(addArtButton(this, 88, 50, '‹  BACK'");
    expect(source).toContain('if (!prefersReducedMotion())');
  });
});
