export type Match3Color = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';
export type Match3Special = 'row' | 'column' | 'burst' | 'spectrum';
export type Match3Booster = 'hammer' | 'shuffle' | 'spectrum';
export type Match3Status = 'active' | 'won' | 'lost';

export interface Match3Coordinate {
  row: number;
  col: number;
}

export interface Match3Tile {
  id: number;
  color: Match3Color | null;
  special: Match3Special | null;
}

export interface Match3Cell {
  tile: Match3Tile | null;
  shell: number;
  vine: boolean;
}

export type Match3Board = Match3Cell[][];

export interface Match3Goals {
  targetScore: number;
  collect: Partial<Record<Match3Color, number>>;
  shells: number;
  vines: number;
}

export interface Match3Progress {
  collected: Record<Match3Color, number>;
  shellsCleared: number;
  vinesCleared: number;
}

export interface Match3Boosters {
  hammer: number;
  shuffle: number;
  spectrum: number;
}

export interface Match3State {
  rulesVersion: number;
  level: number;
  seed: number;
  rngState: number;
  nextTileId: number;
  board: Match3Board;
  movesRemaining: number;
  score: number;
  comboPeak: number;
  goals: Match3Goals;
  progress: Match3Progress;
  boosters: Match3Boosters;
  status: Match3Status;
}

export interface Match3LevelDefinition {
  id: number;
  world: number;
  act: number;
  name: string;
  seed: number;
  moves: number;
  palette: readonly Match3Color[];
  goals: Match3Goals;
  blockerLayout: {
    shells: Array<Match3Coordinate & { layers: number }>;
    vines: Match3Coordinate[];
  };
}

export interface Match3Run {
  orientation: 'row' | 'column';
  color: Match3Color;
  cells: Match3Coordinate[];
}

export interface Match3Move {
  from: Match3Coordinate;
  to: Match3Coordinate;
}

export interface Match3ClearedTile {
  at: Match3Coordinate;
  tile: Match3Tile;
}

export interface Match3CreatedSpecial {
  at: Match3Coordinate;
  special: Match3Special;
}

export interface Match3ResolutionStep {
  kind: 'clear' | 'shuffle' | 'transform';
  cascade: number;
  cleared: Match3ClearedTile[];
  activated: Match3ClearedTile[];
  created: Match3CreatedSpecial[];
  shellDamage: number;
  vinesCleared: number;
  scoreDelta: number;
  board: Match3Board;
}

export interface Match3ActionResult {
  accepted: boolean;
  reason:
    | 'accepted'
    | 'run-ended'
    | 'out-of-bounds'
    | 'not-adjacent'
    | 'empty-cell'
    | 'no-match'
    | 'unknown-booster'
    | 'booster-empty'
    | 'shuffle-failed'
    | 'target-required';
  state: Match3State;
  steps: Match3ResolutionStep[];
}

export const MATCH3_RULES_VERSION: number;
export const MATCH3_ROWS: number;
export const MATCH3_COLUMNS: number;
export const MATCH3_COLORS: readonly Match3Color[];
export const MATCH3_LEVEL_COUNT: number;
export const MATCH3_SPECIALS: readonly Match3Special[];
export const MATCH3_BOOSTERS: readonly Match3Booster[];
export const MATCH3_LEVELS: readonly Match3LevelDefinition[];

export function isMatch3Coordinate(value: unknown): value is Match3Coordinate;
export function areMatch3Neighbors(first: Match3Coordinate, second: Match3Coordinate): boolean;
export function cloneMatch3Board(board: Match3Board): Match3Board;
export function cloneMatch3State(state: Match3State): Match3State;
export function nextMatch3Random(state: number): { state: number; value: number };
export function getMatch3LevelDefinition(level: number): Match3LevelDefinition;
export function findMatch3Runs(board: Match3Board): Match3Run[];
export function match3MatchedCoordinates(board: Match3Board): Match3Coordinate[];
export function findValidMatch3Moves(board: Match3Board, limit?: number): Match3Move[];
export function createMatch3State(level?: number, seedOverride?: number): Match3State;
export function match3ObjectivesComplete(state: Match3State): boolean;
export function tryMatch3Swap(
  state: Match3State,
  first: Match3Coordinate,
  second: Match3Coordinate,
): Match3ActionResult;
export function useMatch3Booster(
  state: Match3State,
  booster: Match3Booster,
  coordinate?: Match3Coordinate | null,
): Match3ActionResult;
export function match3Hint(state: Match3State): Match3Move | null;
export function match3BoardFingerprint(board: Match3Board): string;
