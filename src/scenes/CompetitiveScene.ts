import Phaser from 'phaser';
import { VIEW } from '../config';
import { getOnlineGhost, getOnlineLeaderboard, getOnlineWeeklyChallenge, syncOnline, type OnlineLeaderboardEntry } from '../game/online';
import { getDailyChallenge, getPlayerSave } from '../game/retention';
import { ArenaConnection, getPlatformAccount, type ArenaMessage } from '../game/platform';
import { addAmbientMotes, addArtButton, addArtPanel, addWorldBackground, DISPLAY_FONT, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

export class CompetitiveScene extends Phaser.Scene {
  private activeChallenge = getDailyChallenge();
  private arena?: ArenaConnection;
  private arenaStatus?: Phaser.GameObjects.Text;
  private boardRequest = 0;
  private ghostRequest = 0;
  constructor() { super('Competitive'); }

  create(): void {
    const { width } = VIEW;
    const challenge = getDailyChallenge();
    this.activeChallenge = challenge;
    this.boardRequest += 1;
    this.ghostRequest += 1;
    addWorldBackground(this, 'world_nexus', 0.18);
    addAmbientMotes(this, 0xa88cff, 12, 2);
    this.add.text(34, 38, '‹  BACK', { fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e8ecfa', fontStyle: 'bold' })
      .setDepth(12).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Menu'));
    this.add.text(width / 2, 72, 'HALL OF CHAMPIONS', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#211743', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(10);
    const tournamentTitle = this.add.text(width / 2, 122, `DAILY TOURNAMENT  •  ${challenge.date}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbbdff', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(10);
    const dailyTab = this.add.text(250, 162, 'DAILY PRISM', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#7ff1d0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12).setInteractive({ useHandCursor: true });
    const weeklyTab = this.add.text(470, 162, 'WEEKLY CUP', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#b8a3ff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12).setInteractive({ useHandCursor: true });
    addArtPanel(this, width / 2, 220, 630, 100, 5, 0.96);
    const status = this.add.text(width / 2, 220, 'CONNECTING SECURELY…', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffe7a6', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(10);
    addArtPanel(this, width / 2, 675, 640, 780, 5, 0.96);
    const board = this.add.text(70, 430, 'Loading tournament rankings…', {
      fontFamily: 'monospace', fontSize: '19px', color: '#e7edfa', lineSpacing: 22,
    }).setDepth(10);
    const ghost = this.add.text(width / 2, 1090, 'Select a ranked run to inspect its ghost trace.', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#aebdd1', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(10);
    addArtButton(this, 230, 340, 'LIVE 1v1 MATCH', () => void this.queueLiveArena(), 300, 58, 14);
    addArtButton(this, 535, 340, 'CANCEL QUEUE', () => this.arena?.send({ type: 'cancel-queue' }), 230, 58, 14);
    this.arenaStatus = this.add.text(width / 2, 386, 'LIVE ARENA  •  EMAIL ACCOUNT REQUIRED', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#cbbdff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(12);

    const loadBoard = async (definition: typeof challenge, request = ++this.boardRequest): Promise<void> => {
      this.activeChallenge = definition;
      tournamentTitle.setText(`${definition.id.startsWith('weekly-') ? 'WEEKLY CUP' : 'DAILY TOURNAMENT'}  •  ${definition.date}`);
      board.setText('Loading tournament rankings…').removeAllListeners();
      const entries = await getOnlineLeaderboard(definition.id);
      if (!this.scene.isActive() || request !== this.boardRequest) return;
      this.drawEntries(entries, board, ghost);
    };
    dailyTab.on('pointerup', () => void loadBoard(challenge));
    weeklyTab.on('pointerup', async () => {
      const request = ++this.boardRequest;
      const weekly = await getOnlineWeeklyChallenge();
      if (!this.scene.isActive() || request !== this.boardRequest) return;
      if (weekly) await loadBoard(weekly, request);
      else status.setText('WEEKLY CUP REQUIRES ONLINE BACKEND').setColor('#ffc879');
    });
    const initialRequest = this.boardRequest;
    void Promise.all([syncOnline(), getOnlineLeaderboard(challenge.id)]).then(([sync, entries]) => {
      if (!this.scene.isActive() || initialRequest !== this.boardRequest) return;
      const save = getPlayerSave();
      status.setText(sync.online
        ? `ONLINE  •  ${sync.submitted} RUNS UPLOADED  •  ${save.pendingRuns.length} QUEUED`
        : `OFFLINE MODE  •  ${save.pendingRuns.length} RUNS SAFELY QUEUED`)
        .setColor(sync.online ? '#7ff1d0' : '#ffc879');
      this.drawEntries(entries, board, ghost);
    });
    sharpenSceneText(this);
  }

  private async queueLiveArena(): Promise<void> {
    const account = await getPlatformAccount(true);
    if (!this.scene.isActive() || !this.arenaStatus) return;
    if (!account) { this.arenaStatus.setText('SIGN IN WITH EMAIL FROM ACCOUNT TO ENTER LIVE ARENA').setColor('#ffc879'); return; }
    this.arena?.close(); this.arena = new ArenaConnection();
    this.arena.connect((message: ArenaMessage) => {
      if (!this.scene.isActive() || !this.arenaStatus) return;
      if (message.type === 'arena-ready') {
        this.arenaStatus.setText('SECURE MATCHMAKING  •  SEARCHING…').setColor('#7ff1d0');
        this.arena?.send({ type: 'queue' });
      } else if (message.type === 'queued') {
        this.arenaStatus.setText(`MATCHMAKING QUEUE  •  POSITION ${message.position ?? 1}`);
      } else if (message.type === 'match-found') {
        this.arenaStatus.setText('RIVAL FOUND  •  SYNCHRONIZING SHARED BOARD');
        const matchId = String(message.matchId); const seed = Number(message.seed); const level = Number(message.level);
        const startsAt = Number(message.startsAt); const serverTime = Number(message.serverTime); const clientReceivedAt = Date.now();
        this.time.delayedCall(450, () => this.scene.start('Game', {
          level, mode: 'classic', score: 0,
          arena: { matchId, seed, startsAt, serverTime, clientReceivedAt, userId: account.userId },
        }));
      } else if (message.type === 'error') this.arenaStatus.setText(String(message.error ?? 'ARENA ERROR').toUpperCase()).setColor('#ff8d8d');
    }, (state) => this.arenaStatus?.setText(`LIVE ARENA  •  ${state.toUpperCase()}`));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.arena?.close());
  }

  private drawEntries(entries: OnlineLeaderboardEntry[], board: Phaser.GameObjects.Text, ghostLabel: Phaser.GameObjects.Text): void {
    if (!entries.length) {
      board.setText('NO ONLINE RUNS YET\nComplete this tournament to claim first place.');
      return;
    }
    board.setText(entries.slice(0, 10).map((entry, index) => (
      `${String(index + 1).padStart(2, '0')}  ${entry.displayName.padEnd(14, ' ')} ${entry.score.toLocaleString().padStart(9, ' ')}  ${(entry.durationMs / 1000).toFixed(1).padStart(6, ' ')}s`
    )).join('\n\n'));
    board.setInteractive({ useHandCursor: true }).on('pointerup', async (pointer: Phaser.Input.Pointer) => {
      const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const localY = worldPoint.y - board.y;
      const index = Phaser.Math.Clamp(Math.floor(localY / 62), 0, Math.min(9, entries.length - 1));
      const entry = entries[index];
      const challenge = this.activeChallenge;
      const request = ++this.ghostRequest;
      const replay = await getOnlineGhost(entry.runId);
      if (!this.scene.isActive() || request !== this.ghostRequest) return;
      if (replay?.ghost?.length) {
        ghostLabel.setText(`${entry.displayName} GHOST  •  REPLAYING ${replay.ghost.length} SHOTS`);
        this.time.delayedCall(220, () => this.scene.start('Game', {
          level: entry.level,
          mode: entry.mode,
          score: 0,
          challenge,
          ghost: replay.ghost,
        }));
      } else ghostLabel.setText('This run has no replay trace.');
    });
  }
}
