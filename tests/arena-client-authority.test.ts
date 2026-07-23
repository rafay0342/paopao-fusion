import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../src/scenes/GameScene.ts', import.meta.url)), 'utf8');

function section(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('arena client authority boundary', () => {
  it('submits only a monotonic quantized aim action at launch and never claims outcomes', () => {
    const launch = section('  private shootAt(x: number, y: number): void {', '  private startGhostReplay(): void {');
    const resolution = section('  private finishResolvedShot(', '  private addPlayableRow(): void {');

    expect(launch).toContain('const atMs = Math.round(this.arenaElapsedMs());');
    expect(launch).toContain('angleMilliDegrees');
    expect(launch).toContain("type: 'input', matchId: this.arena.matchId, seq, atMs, angleMilliDegrees");
    expect(launch).not.toContain('popped');
    expect(launch).not.toContain('dropped');
    expect(resolution).not.toContain("type: 'input'");
    expect(source).toContain('this.arenaVerifiedScore = self.score;');
  });

  it('freezes and submits local completion without granting a local victory', () => {
    const board = section('  private checkBoardState(): boolean {', '  private levelClearCard(): void {');
    const wait = section('  private awaitArenaResult(): void {', '  private sendArenaFinish(): void {');

    expect(board).toContain('if (this.arena) {\n        this.awaitArenaResult();\n        return true;');
    expect(wait).toContain('this.running = false;');
    expect(wait).toContain('this.sendArenaFinish();');
    expect(wait).not.toContain('claimCoinReward');
    expect(wait).not.toContain('recordCompletedRun');
    expect(wait).not.toContain("endCard('YOU WON!'");
  });

  it('allows only a matching, well-formed server result to choose win or loss', () => {
    const resolve = section('  private resolveArenaResult(message: ArenaMessage): void {', '  private endCard(msg: string, color: number): void {');
    const end = section('  private endCard(msg: string, color: number): void {', '  private connectArena(): void {');

    expect(resolve).toContain('message.matchId !== this.arena.matchId');
    expect(resolve).toContain("typeof message.winnerUserId === 'string'");
    expect(resolve).toContain('this.arenaResultResolved = true;');
    expect(resolve).not.toContain('!this.arenaCompletionPending');
    expect(resolve).toContain("isTie ? 'ARENA DRAW' : won ? 'YOU WON!' : 'RIVAL FINISHED AHEAD'");
    expect(end).toContain('if (this.arena && !this.arenaResultResolved)');
    expect(end).not.toContain("send({ type: 'finish'");
  });

  it('resubmits finish after reconnect and provides a no-reward exit path', () => {
    const connect = section('  private connectArena(): void {', '\n}');
    const waitCard = section('  private showArenaWaitCard(): void {', '  private resolveArenaResult(message: ArenaMessage): void {');

    expect(connect).toContain("message.type === 'arena-ready'");
    expect(connect).toContain("message.type === 'match-resumed'");
    expect(connect).toContain('this.sendArenaFinish();');
    expect(waitCard).toContain("'RETURN TO ARENA LOBBY'");
    expect(waitCard).toContain("this.scene.start('Competitive')");
    expect(source).toContain('NO LOCAL WIN OR REWARD WAS GRANTED');
  });

  it('rejects malformed arena identifiers and non-finite numeric scene data', () => {
    const init = section('  init(data: GameSceneData = {}): void {', '  create(): void {');

    expect(init).toContain('Number.isFinite(requestedLevel)');
    expect(init).toContain('Number.isFinite(requestedScore)');
    expect(init).toContain('Number.isSafeInteger(seed)');
    expect(init).toContain('Number.isSafeInteger(startsAt)');
    expect(init).toContain('Number.isSafeInteger(serverTime)');
    expect(init).toContain('Number.isSafeInteger(clientReceivedAt)');
    expect(init).toContain("matchId.startsWith('match_')");
    expect(init).toContain("userId.startsWith('usr_')");
    const patternSource = source.match(/const ARENA_ID_PATTERN = \/(.+)\/;/)?.[1];
    expect(patternSource).toBeTruthy();
    const arenaIdPattern = new RegExp(patternSource!);
    expect(arenaIdPattern.test('match_7xQnM4vR2kLp9ZsT')).toBe(true);
    expect(arenaIdPattern.test('usr_7xQnM4vR2kLp9ZsT')).toBe(true);
    expect(arenaIdPattern.test('user_7xQnM4vR2kLp9ZsT')).toBe(false);
  });

  it('never converts an arena result into story progression or a draw into a winner reward', () => {
    const shard = section('  private claimStoryShard(): number {', '  private recordCompletedRun(won: boolean): void {');
    const resolve = section('  private resolveArenaResult(message: ArenaMessage): void {', '  private endCard(msg: string, color: number): void {');

    expect(shard).toContain('if (this.challenge || this.arena || this.replayTrace) return 0;');
    expect(resolve).toContain('const won = !isTie && winnerUserId === this.arena.userId;');
    expect(resolve).toContain("else if (!isTie) SFX.lose();");
    expect(resolve).toContain('this.pauseOverlay?.destroy(true);');
  });
});
