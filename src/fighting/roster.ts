export type FighterId = 'kael' | 'nyra';

export interface FighterDefinition {
  id: FighterId;
  name: string;
  epithet: string;
  origin: string;
  assetKey: string;
  assetPath: string;
  accent: number;
  accentCss: string;
  darkAccent: number;
  style: string;
  specialName: string;
  superName: string;
  stats: {
    power: number;
    speed: number;
    defense: number;
    reach: number;
  };
}

export const FIGHTERS: Record<FighterId, FighterDefinition> = {
  kael: {
    id: 'kael',
    name: 'KAEL VEYR',
    epithet: 'THE STORMBOUND',
    origin: 'NORTH CITADEL',
    assetKey: 'fighter-kael',
    assetPath: '/assets/fighting/fighters/kael-veyr.png',
    accent: 0x48d9ff,
    accentCss: '#48d9ff',
    darkAccent: 0x07354a,
    style: 'FAST / COUNTER',
    specialName: 'VOLT LANCE',
    superName: 'EYE OF THE STORM',
    stats: { power: 7, speed: 9, defense: 6, reach: 8 },
  },
  nyra: {
    id: 'nyra',
    name: 'NYRA ASH',
    epithet: 'THE EMBER MARSHAL',
    origin: 'SCARLET FORGE',
    assetKey: 'fighter-nyra',
    assetPath: '/assets/fighting/fighters/nyra-ash.png',
    accent: 0xff573f,
    accentCss: '#ff573f',
    darkAccent: 0x4b0d0b,
    style: 'POWER / PRESSURE',
    specialName: 'CINDER BREAK',
    superName: 'LAST PYRE',
    stats: { power: 9, speed: 6, defense: 8, reach: 7 },
  },
};

export const FIGHTER_ORDER: FighterId[] = ['kael', 'nyra'];

export function rivalOf(fighter: FighterId): FighterId {
  return fighter === 'kael' ? 'nyra' : 'kael';
}
