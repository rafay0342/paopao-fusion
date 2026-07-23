export interface ScoreEntry {
  name: string;
  score: number;
  level: number;
  date: string;
}

const KEY = 'paopao-fusion-leaderboard-v1';

export function getLeaderboard(): ScoreEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as ScoreEntry[];
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.score === 'number').slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function submitScore(score: number, level: number, name = 'PLAYER'): ScoreEntry {
  const entered = name.trim().slice(0, 14) || 'PLAYER';
  const entry: ScoreEntry = { name: entered.toUpperCase(), score, level: level + 1, date: new Date().toISOString() };
  const next = [...getLeaderboard(), entry].sort((a, b) => b.score - a.score).slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing can disable localStorage; the run still completes.
  }
  return entry;
}
