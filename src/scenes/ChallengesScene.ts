import Phaser from 'phaser';
import { LEVELS, VIEW, campaignStageNumber } from '../config';
import { MODE_DEFS } from '../game/meta';
import {
  ACHIEVEMENTS,
  claimAchievement,
  claimChallengeReward,
  claimQuest,
  getDailyChallenge,
  getPlayerSave,
  masteryLabel,
} from '../game/retention';
import { SFX } from '../game/sfx';
import { getOnlineChallenge } from '../game/online';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import { addAmbientMotes, addArtButton, addArtPanel, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

export class ChallengesScene extends Phaser.Scene {
  private onlineChallenge = getDailyChallenge();
  private achievementPage = 0;
  constructor() {
    super('Challenges');
  }

  init(data: { achievementPage?: number }): void {
    this.achievementPage = Phaser.Math.Clamp(data.achievementPage ?? this.achievementPage, 0, Math.ceil(ACHIEVEMENTS.length / 4) - 1);
  }

  create(): void {
    const { width } = VIEW;
    const save = getPlayerSave();
    const challenge = getDailyChallenge();
    this.onlineChallenge = challenge;
    void getOnlineChallenge().then((online) => { this.onlineChallenge = online; });
    const completedChallenge = save.recentRuns.some((run) => run.challengeId === challenge.id && run.won);
    const challengeClaimed = save.claimedChallengeIds.includes(challenge.id);
    addWorldBackground(this, 'world_celestial', 0.16);
    addAmbientMotes(this, 0x79d9ff, 14, 2);

    this.add.text(width / 2, 60, 'CHALLENGE CHAMBER', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#20254f', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(10);
    this.add.text(width / 2, 106, `DAY ${save.loginStreak}/7 STREAK  •  ${save.badges.length} BADGES`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);
    this.add.text(34, 38, '‹  BACK', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#dce8f8', fontStyle: 'bold',
    }).setDepth(12).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Menu'));

    addArtPanel(this, width / 2, 236, 650, 190, 5, 0.98);
    this.add.text(58, 162, 'DAILY PRISM', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#79d9ff', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(8);
    fitText(this.add.text(58, 201, `STAGE ${campaignStageNumber(challenge.level)}  •  ${LEVELS[challenge.level].title}  •  ${MODE_DEFS[challenge.mode].name}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffffff', fontStyle: 'bold',
    }).setDepth(8), 590);
    this.add.text(58, 238, `${challenge.modifier.replace('_', ' ').toUpperCase()}  •  REWARD ◆ ${challenge.rewardCoins}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe07e', fontStyle: 'bold',
    }).setDepth(8);
    const challengeLabel = challengeClaimed ? 'REWARD CLAIMED' : completedChallenge ? 'CLAIM 500 COINS' : 'PLAY DAILY CHALLENGE';
    addArtButton(this, width / 2, 301, challengeLabel, () => {
      SFX.click();
      if (completedChallenge && !challengeClaimed) {
        claimChallengeReward(challenge.id);
        this.scene.restart();
      } else if (!completedChallenge) {
        const active = this.onlineChallenge.id === challenge.id ? this.onlineChallenge : challenge;
        this.scene.start('Game', { level: active.level, score: 0, mode: active.mode, challenge: active });
      }
    }, 350, 58, 10);

    this.add.text(48, 360, 'DAILY ORDERS', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    this.drawQuestList(save.daily, 405, 'daily');
    this.add.text(48, 604, 'WEEKLY ORDERS', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    this.drawQuestList(save.weekly, 649, 'weekly');

    this.add.text(48, 848, 'ACHIEVEMENTS', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    const visibleAchievements = ACHIEVEMENTS.slice(this.achievementPage * 4, this.achievementPage * 4 + 4);
    visibleAchievements.forEach((definition, index) => {
      const state = save.achievements[definition.id];
      const y = 894 + index * 57;
      const complete = state.unlocked;
      const label = state.claimed ? 'CLAIMED' : complete ? 'CLAIM' : `${state.value}/${definition.target}`;
      this.add.text(62, y, `${state.claimed ? '◆' : complete ? '✦' : '◇'}  ${definition.title}`, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: complete ? '#ffffff' : '#b9c6d8', fontStyle: 'bold',
      }).setDepth(10);
      const action = this.add.text(width - 62, y, label, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: complete ? '#ffe07e' : '#8fa2ba', fontStyle: 'bold',
      }).setOrigin(1, 0).setDepth(10);
      if (complete && !state.claimed) action.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        claimAchievement(definition.id);
        this.scene.restart({ achievementPage: this.achievementPage });
      });
    });

    const totalPages = Math.ceil(ACHIEVEMENTS.length / 4);
    this.add.text(68, 1123, '‹ PREV', { fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b8a3ff', fontStyle: 'bold' })
      .setDepth(12).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.restart({ achievementPage: (this.achievementPage + totalPages - 1) % totalPages }));
    this.add.text(width / 2, 1123, `BADGES ${this.achievementPage + 1} / ${totalPages}`, { fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#dce6f5', fontStyle: 'bold' })
      .setOrigin(0.5, 0).setDepth(12);
    this.add.text(width - 68, 1123, 'NEXT ›', { fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b8a3ff', fontStyle: 'bold' })
      .setOrigin(1, 0).setDepth(12).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.restart({ achievementPage: (this.achievementPage + 1) % totalPages }));

    const masteryRows = [(['chrono', 'phoenix'] as const), (['void', 'fortune'] as const)]
      .map((row) => row.map((artifact) => `${artifact.toUpperCase()} ${masteryLabel(artifact, save)}`).join('   •   '));
    masteryRows.forEach((line, index) => fitText(this.add.text(width / 2, 1153 + index * 23, line, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#9edff2', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10), 600, 0.58));
    if (PHASER_RELEASE_FEATURES.endlessLiveOperations) {
      addArtButton(this, width / 2, 1_232, 'PLAY CURRENT LIVE EVENT', () => {
        SFX.click();
        this.scene.start('Endless', { event: true });
      }, 500, 54, 18);
    }
    sharpenSceneText(this);
  }

  private drawQuestList(list: ReturnType<typeof getPlayerSave>['daily'], startY: number, kind: 'daily' | 'weekly'): void {
    list.forEach((quest, index) => {
      const y = startY + index * 63;
      const ready = quest.value >= quest.target;
      addArtPanel(this, VIEW.width / 2, y + 17, 630, 51, 6, 0.88);
      this.add.text(62, y, quest.title, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#e8eff9', fontStyle: 'bold',
      }).setDepth(9);
      this.add.text(62, y + 25, `${Math.min(quest.value, quest.target).toLocaleString()} / ${quest.target.toLocaleString()}  •  ◆ ${quest.rewardCoins}${quest.rewardKeys ? `  •  KEY ${quest.rewardKeys}` : ''}`, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: ready ? '#7ff1d0' : '#9babc0', fontStyle: 'bold',
      }).setDepth(9);
      const label = quest.claimed ? 'CLAIMED' : ready ? 'CLAIM' : 'IN PROGRESS';
      const action = this.add.text(VIEW.width - 62, y + 13, label, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: ready ? '#ffe07e' : '#899ab1', fontStyle: 'bold',
      }).setOrigin(1, 0).setDepth(10);
      if (ready && !quest.claimed) action.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        claimQuest(kind, quest.id);
        this.scene.restart();
      });
    });
  }
}
