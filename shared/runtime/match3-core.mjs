/**
 * PaoPao Prism Cascade — deterministic, platform-neutral Match-3 rules.
 *
 * The module contains gameplay state only. Rendering, input and audio stay in
 * the Phaser client, while the serializable state can be replayed or validated
 * by Node without importing Phaser.
 */

export const MATCH3_RULES_VERSION = 1;
export const MATCH3_ROWS = 8;
export const MATCH3_COLUMNS = 8;
export const MATCH3_COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple', 'orange']);
export const MATCH3_LEVEL_COUNT = 30;
export const MATCH3_SPECIALS = Object.freeze(['row', 'column', 'burst', 'spectrum']);
export const MATCH3_BOOSTERS = Object.freeze(['hammer', 'shuffle', 'spectrum']);

const WORLD_LEVEL_NAMES = Object.freeze([
  Object.freeze(['First Light', 'Prism Path', 'Crystal Choir', 'Shimmer Gate', 'Bloom Guardian']),
  Object.freeze(['Moss Mosaic', 'Vine Waltz', 'Emerald Echo', 'Canopy Crown', 'Heartwood Trial']),
  Object.freeze(['Cloud Current', 'Comet Weave', 'Star Lanterns', 'Moon Circuit', 'Astral Trial']),
  Object.freeze(['Cinder Steps', 'Flare Forge', 'Sunstone Rush', 'Phoenix Ring', 'Inferno Trial']),
  Object.freeze(['Snowglass', 'Aurora Drift', 'Glacier Pulse', 'Winter Crown', 'Frostbound Trial']),
  Object.freeze(['Nexus Wake', 'Infinity Fold', 'Spectrum Storm', 'Fusion Crown', 'Eternal Prism']),
]);

const clampInteger = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Math.trunc(Number(value) || 0)))
);

const coordinateKey = ({ row, col }) => `${row}:${col}`;
const coordinateFromKey = (key) => {
  const [row, col] = key.split(':').map(Number);
  return { row, col };
};

export function isMatch3Coordinate(value) {
  return Boolean(value)
    && Number.isInteger(value.row)
    && Number.isInteger(value.col)
    && value.row >= 0
    && value.row < MATCH3_ROWS
    && value.col >= 0
    && value.col < MATCH3_COLUMNS;
}

export function areMatch3Neighbors(first, second) {
  return isMatch3Coordinate(first)
    && isMatch3Coordinate(second)
    && Math.abs(first.row - second.row) + Math.abs(first.col - second.col) === 1;
}

function cloneTile(tile) {
  return tile ? { id: tile.id, color: tile.color, special: tile.special } : null;
}

export function cloneMatch3Board(board) {
  return board.map((row) => row.map((cell) => ({
    tile: cloneTile(cell.tile),
    shell: cell.shell,
    vine: cell.vine,
  })));
}

export function cloneMatch3State(state) {
  return {
    rulesVersion: state.rulesVersion,
    level: state.level,
    seed: state.seed,
    rngState: state.rngState,
    nextTileId: state.nextTileId,
    board: cloneMatch3Board(state.board),
    movesRemaining: state.movesRemaining,
    score: state.score,
    comboPeak: state.comboPeak,
    goals: {
      targetScore: state.goals.targetScore,
      collect: { ...state.goals.collect },
      shells: state.goals.shells,
      vines: state.goals.vines,
    },
    progress: {
      collected: { ...state.progress.collected },
      shellsCleared: state.progress.shellsCleared,
      vinesCleared: state.progress.vinesCleared,
    },
    boosters: { ...state.boosters },
    status: state.status,
  };
}

/** One explicit Mulberry32 word plus the serializable next state. */
export function nextMatch3Random(state) {
  const nextState = ((Number(state) >>> 0) + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    state: nextState,
    value: (value ^ (value >>> 14)) >>> 0,
  };
}

function randomIndex(state, length) {
  const word = nextMatch3Random(state);
  return {
    state: word.state,
    index: length > 0 ? word.value % length : 0,
  };
}

function shuffled(input, state) {
  const values = [...input];
  let nextState = state;
  for (let index = values.length - 1; index > 0; index -= 1) {
    const draw = randomIndex(nextState, index + 1);
    nextState = draw.state;
    [values[index], values[draw.index]] = [values[draw.index], values[index]];
  }
  return { values, state: nextState };
}

function blockerLayout(level, seed) {
  const world = Math.floor(level / 5);
  const act = level % 5;
  const all = [];
  for (let row = 0; row < MATCH3_ROWS; row += 1) {
    for (let col = 0; col < MATCH3_COLUMNS; col += 1) all.push({ row, col });
  }
  const order = shuffled(all, (seed ^ 0xa511e9b3 ^ Math.imul(level + 1, 0x9e3779b1)) >>> 0);
  const shellCells = level < 3 ? 0 : Math.min(18, 2 + world * 2 + act * 2);
  const vineCells = level < 6 ? 0 : Math.min(14, 1 + world + act * 2);
  const shells = new Map();
  const vines = new Set();
  for (let index = 0; index < shellCells; index += 1) {
    const coordinate = order.values[index];
    const layers = level >= 15 && (index + act) % 4 === 0 ? 2 : 1;
    shells.set(coordinateKey(coordinate), layers);
  }
  let cursor = shellCells;
  while (vines.size < vineCells && cursor < order.values.length) {
    const coordinate = order.values[cursor++];
    const key = coordinateKey(coordinate);
    if (!shells.has(key)) vines.add(key);
  }
  return { shells, vines, rngState: order.state };
}

export function getMatch3LevelDefinition(level) {
  const normalized = clampInteger(level, 0, MATCH3_LEVEL_COUNT - 1);
  if (normalized !== Number(level)) throw new RangeError(`Invalid Match-3 level: ${level}`);
  const world = Math.floor(normalized / 5);
  const act = normalized % 5;
  const paletteSize = Math.min(MATCH3_COLORS.length, 4 + Math.floor(normalized / 6));
  const palette = MATCH3_COLORS.slice(0, paletteSize);
  const seed = (0x70616f70 ^ Math.imul(normalized + 1, 0x85ebca6b)) >>> 0;
  const blockers = blockerLayout(normalized, seed);
  const shellLayers = [...blockers.shells.values()].reduce((sum, layers) => sum + layers, 0);
  const primary = palette[(world + act) % palette.length];
  const secondary = palette[(world * 2 + act + 2) % palette.length];
  const collect = {
    [primary]: 7 + world + act,
  };
  if (normalized >= 8 && secondary !== primary) {
    collect[secondary] = 5 + Math.floor(world / 2) + Math.floor(act / 2);
  }
  return {
    id: normalized,
    world,
    act,
    name: WORLD_LEVEL_NAMES[world][act],
    seed,
    moves: Math.max(19, 28 - world - (act === 4 ? 2 : 0)),
    palette,
    goals: {
      targetScore: 1_600 + normalized * 110 + world * 200,
      collect,
      shells: shellLayers,
      vines: blockers.vines.size,
    },
    blockerLayout: {
      shells: [...blockers.shells].map(([key, layers]) => ({ ...coordinateFromKey(key), layers })),
      vines: [...blockers.vines].map(coordinateFromKey),
    },
  };
}

export const MATCH3_LEVELS = Object.freeze(
  Array.from({ length: MATCH3_LEVEL_COUNT }, (_, level) => Object.freeze(getMatch3LevelDefinition(level))),
);

function emptyBoard() {
  return Array.from({ length: MATCH3_ROWS }, () => (
    Array.from({ length: MATCH3_COLUMNS }, () => ({ tile: null, shell: 0, vine: false }))
  ));
}

function boardCell(board, coordinate) {
  return isMatch3Coordinate(coordinate) ? board[coordinate.row][coordinate.col] : null;
}

function colorAt(board, row, col) {
  const tile = board[row]?.[col]?.tile;
  return tile?.special === 'spectrum' ? null : tile?.color ?? null;
}

export function findMatch3Runs(board) {
  const runs = [];
  for (let row = 0; row < MATCH3_ROWS; row += 1) {
    let start = 0;
    while (start < MATCH3_COLUMNS) {
      const color = colorAt(board, row, start);
      let end = start + 1;
      while (color && end < MATCH3_COLUMNS && colorAt(board, row, end) === color) end += 1;
      if (color && end - start >= 3) {
        runs.push({
          orientation: 'row',
          color,
          cells: Array.from({ length: end - start }, (_, index) => ({ row, col: start + index })),
        });
      }
      start = end;
    }
  }
  for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
    let start = 0;
    while (start < MATCH3_ROWS) {
      const color = colorAt(board, start, col);
      let end = start + 1;
      while (color && end < MATCH3_ROWS && colorAt(board, end, col) === color) end += 1;
      if (color && end - start >= 3) {
        runs.push({
          orientation: 'column',
          color,
          cells: Array.from({ length: end - start }, (_, index) => ({ row: start + index, col })),
        });
      }
      start = end;
    }
  }
  return runs;
}

export function match3MatchedCoordinates(board) {
  const keys = new Set(findMatch3Runs(board).flatMap((run) => run.cells.map(coordinateKey)));
  return [...keys].map(coordinateFromKey);
}

function swapTiles(board, first, second) {
  const firstCell = boardCell(board, first);
  const secondCell = boardCell(board, second);
  if (!firstCell || !secondCell) return;
  [firstCell.tile, secondCell.tile] = [secondCell.tile, firstCell.tile];
}

function moveProducesMatch(board, first, second) {
  if (!areMatch3Neighbors(first, second)) return false;
  const firstTile = boardCell(board, first)?.tile;
  const secondTile = boardCell(board, second)?.tile;
  if (!firstTile || !secondTile) return false;
  if (firstTile.special === 'spectrum' || secondTile.special === 'spectrum') return true;
  if (firstTile.special && secondTile.special) return true;
  const copy = cloneMatch3Board(board);
  swapTiles(copy, first, second);
  const relevant = new Set([coordinateKey(first), coordinateKey(second)]);
  return findMatch3Runs(copy).some((run) => run.cells.some((cell) => relevant.has(coordinateKey(cell))));
}

export function findValidMatch3Moves(board, limit = MATCH3_ROWS * MATCH3_COLUMNS * 2) {
  const moves = [];
  const maximum = clampInteger(limit, 0, MATCH3_ROWS * MATCH3_COLUMNS * 2);
  for (let row = 0; row < MATCH3_ROWS; row += 1) {
    for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
      const from = { row, col };
      for (const to of [{ row, col: col + 1 }, { row: row + 1, col }]) {
        if (isMatch3Coordinate(to) && moveProducesMatch(board, from, to)) {
          moves.push({ from, to });
          if (moves.length >= maximum) return moves;
        }
      }
    }
  }
  return moves;
}

function createCandidateBoard(definition, rngState, nextTileId) {
  const board = emptyBoard();
  let nextState = rngState;
  let nextId = nextTileId;
  for (let row = 0; row < MATCH3_ROWS; row += 1) {
    for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
      const forbidden = new Set();
      if (col >= 2 && colorAt(board, row, col - 1) === colorAt(board, row, col - 2)) {
        forbidden.add(colorAt(board, row, col - 1));
      }
      if (row >= 2 && colorAt(board, row - 1, col) === colorAt(board, row - 2, col)) {
        forbidden.add(colorAt(board, row - 1, col));
      }
      const choices = definition.palette.filter((color) => !forbidden.has(color));
      const draw = randomIndex(nextState, choices.length);
      nextState = draw.state;
      board[row][col].tile = { id: nextId++, color: choices[draw.index], special: null };
    }
  }
  for (const blocker of definition.blockerLayout.shells) {
    board[blocker.row][blocker.col].shell = blocker.layers;
  }
  for (const blocker of definition.blockerLayout.vines) {
    board[blocker.row][blocker.col].vine = true;
  }
  return { board, rngState: nextState, nextTileId: nextId };
}

export function createMatch3State(level = 0, seedOverride) {
  const definition = getMatch3LevelDefinition(level);
  let rngState = Number.isFinite(seedOverride) ? Number(seedOverride) >>> 0 : definition.seed;
  let nextTileId = 1;
  let candidate = null;
  for (let attempt = 0; attempt < 256; attempt += 1) {
    candidate = createCandidateBoard(definition, rngState, nextTileId);
    rngState = candidate.rngState;
    nextTileId = candidate.nextTileId;
    if (findMatch3Runs(candidate.board).length === 0 && findValidMatch3Moves(candidate.board, 1).length > 0) break;
    candidate = null;
  }
  if (!candidate) throw new Error(`Unable to generate a legal Match-3 board for level ${level}`);
  const collected = Object.fromEntries(MATCH3_COLORS.map((color) => [color, 0]));
  return {
    rulesVersion: MATCH3_RULES_VERSION,
    level: definition.id,
    seed: Number.isFinite(seedOverride) ? Number(seedOverride) >>> 0 : definition.seed,
    rngState,
    nextTileId,
    board: candidate.board,
    movesRemaining: definition.moves,
    score: 0,
    comboPeak: 0,
    goals: {
      targetScore: definition.goals.targetScore,
      collect: { ...definition.goals.collect },
      shells: definition.goals.shells,
      vines: definition.goals.vines,
    },
    progress: {
      collected,
      shellsCleared: 0,
      vinesCleared: 0,
    },
    boosters: { hammer: 1, shuffle: 1, spectrum: 1 },
    status: 'active',
  };
}

function chooseCreationCell(run, preferred) {
  for (const coordinate of preferred) {
    if (run.cells.some((cell) => coordinateKey(cell) === coordinateKey(coordinate))) return coordinate;
  }
  return run.cells[Math.floor(run.cells.length / 2)];
}

const SPECIAL_PRIORITY = Object.freeze({ row: 1, column: 1, burst: 2, spectrum: 3 });

function specialCreations(runs, preferred) {
  const orientations = new Map();
  for (const run of runs) {
    for (const cell of run.cells) {
      const key = coordinateKey(cell);
      if (!orientations.has(key)) orientations.set(key, new Set());
      orientations.get(key).add(run.orientation);
    }
  }
  const candidates = [];
  for (const [key, values] of orientations) {
    if (values.size > 1) candidates.push({ at: coordinateFromKey(key), special: 'burst' });
  }
  for (const run of runs) {
    if (run.cells.length >= 5) {
      candidates.push({ at: chooseCreationCell(run, preferred), special: 'spectrum' });
    } else if (run.cells.length === 4) {
      candidates.push({
        at: chooseCreationCell(run, preferred),
        special: run.orientation === 'row' ? 'row' : 'column',
      });
    }
  }
  const byCell = new Map();
  for (const candidate of candidates) {
    const key = coordinateKey(candidate.at);
    const current = byCell.get(key);
    if (!current || SPECIAL_PRIORITY[candidate.special] > SPECIAL_PRIORITY[current.special]) {
      byCell.set(key, candidate);
    }
  }
  return [...byCell.values()];
}

function mostCommonColor(board) {
  const counts = Object.fromEntries(MATCH3_COLORS.map((color) => [color, 0]));
  for (const row of board) {
    for (const cell of row) {
      if (cell.tile?.color) counts[cell.tile.color] += 1;
    }
  }
  return MATCH3_COLORS.reduce((best, color) => counts[color] > counts[best] ? color : best, MATCH3_COLORS[0]);
}

function expandSpecialClears(board, initial, spectrumColor = null, protectedKeys = new Set()) {
  const clear = new Set([...initial].map(coordinateKey));
  const queue = [...clear];
  const activated = [];
  const activatedIds = new Set();
  while (queue.length) {
    const coordinate = coordinateFromKey(queue.shift());
    const tile = boardCell(board, coordinate)?.tile;
    if (!tile?.special || activatedIds.has(tile.id)) continue;
    activatedIds.add(tile.id);
    activated.push({ at: coordinate, tile: cloneTile(tile) });
    const additions = [];
    if (tile.special === 'row') {
      for (let col = 0; col < MATCH3_COLUMNS; col += 1) additions.push({ row: coordinate.row, col });
    } else if (tile.special === 'column') {
      for (let row = 0; row < MATCH3_ROWS; row += 1) additions.push({ row, col: coordinate.col });
    } else if (tile.special === 'burst') {
      for (let row = coordinate.row - 1; row <= coordinate.row + 1; row += 1) {
        for (let col = coordinate.col - 1; col <= coordinate.col + 1; col += 1) additions.push({ row, col });
      }
    } else {
      const targetColor = spectrumColor ?? mostCommonColor(board);
      for (let row = 0; row < MATCH3_ROWS; row += 1) {
        for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
          if (board[row][col].tile?.color === targetColor) additions.push({ row, col });
        }
      }
    }
    for (const addition of additions) {
      if (!isMatch3Coordinate(addition)) continue;
      const key = coordinateKey(addition);
      if (protectedKeys.has(key)) continue;
      if (!clear.has(key)) {
        clear.add(key);
        queue.push(key);
      }
    }
  }
  return { coordinates: [...clear].map(coordinateFromKey), activated };
}

function clearAndDamage(draft, coordinates, cascade, activated) {
  const cleared = [];
  let shellDamage = 0;
  let vinesCleared = 0;
  const blockerHits = new Set();
  for (const coordinate of coordinates) {
    const cell = boardCell(draft.board, coordinate);
    if (!cell) continue;
    if (cell.tile) {
      cleared.push({ at: coordinate, tile: cloneTile(cell.tile) });
      if (cell.tile.color) draft.progress.collected[cell.tile.color] += 1;
      cell.tile = null;
    }
    blockerHits.add(coordinateKey(coordinate));
    for (let row = coordinate.row - 1; row <= coordinate.row + 1; row += 1) {
      for (let col = coordinate.col - 1; col <= coordinate.col + 1; col += 1) {
        const neighbor = { row, col };
        if (isMatch3Coordinate(neighbor)) blockerHits.add(coordinateKey(neighbor));
      }
    }
  }
  // Shells and vines react to a match beside them as well as a direct special
  // hit. Each board cell is damaged at most once per cascade wave.
  for (const key of blockerHits) {
    const cell = boardCell(draft.board, coordinateFromKey(key));
    if (!cell) continue;
    if (cell.shell > 0) {
      cell.shell -= 1;
      draft.progress.shellsCleared += 1;
      shellDamage += 1;
    }
    if (cell.vine) {
      cell.vine = false;
      draft.progress.vinesCleared += 1;
      vinesCleared += 1;
    }
  }
  const scoreDelta = cleared.length * 60 * cascade
    + activated.length * 140
    + shellDamage * 80
    + vinesCleared * 100;
  draft.score += scoreDelta;
  draft.comboPeak = Math.max(draft.comboPeak, cascade);
  return { cleared, shellDamage, vinesCleared, scoreDelta };
}

function gravityAndRefill(draft, palette) {
  for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
    const tiles = [];
    for (let row = MATCH3_ROWS - 1; row >= 0; row -= 1) {
      const tile = draft.board[row][col].tile;
      if (tile) tiles.push(tile);
      draft.board[row][col].tile = null;
    }
    let targetRow = MATCH3_ROWS - 1;
    for (const tile of tiles) draft.board[targetRow--][col].tile = tile;
    while (targetRow >= 0) {
      const draw = randomIndex(draft.rngState, palette.length);
      draft.rngState = draw.state;
      draft.board[targetRow][col].tile = {
        id: draft.nextTileId++,
        color: palette[draw.index],
        special: null,
      };
      targetRow -= 1;
    }
  }
}

function settleDraft(draft, preferred, forced = null) {
  const definition = getMatch3LevelDefinition(draft.level);
  const steps = [];
  let cascade = 1;
  let pendingForced = forced;
  for (; cascade <= 48; cascade += 1) {
    const runs = pendingForced ? [] : findMatch3Runs(draft.board);
    if (!pendingForced && runs.length === 0) break;
    const creations = pendingForced ? [] : specialCreations(runs, cascade === 1 ? preferred : []);
    const protectedKeys = new Set(creations.map((creation) => coordinateKey(creation.at)));
    const matchedBeforeCreation = pendingForced
      ? pendingForced.coordinates
      : [...new Set(runs.flatMap((run) => run.cells.map(coordinateKey)))].map(coordinateFromKey);
    for (const creation of creations) {
      const tile = boardCell(draft.board, creation.at)?.tile;
      if (tile) {
        tile.special = creation.special;
        if (creation.special === 'spectrum') tile.color = null;
      }
    }
    const matched = matchedBeforeCreation
      .filter((coordinate) => !protectedKeys.has(coordinateKey(coordinate)));
    const expanded = expandSpecialClears(
      draft.board,
      matched,
      pendingForced?.spectrumColor ?? null,
      protectedKeys,
    );
    if (expanded.coordinates.length === 0) break;
    const result = clearAndDamage(draft, expanded.coordinates, cascade, expanded.activated);
    gravityAndRefill(draft, definition.palette);
    steps.push({
      kind: 'clear',
      cascade,
      cleared: result.cleared,
      activated: expanded.activated,
      created: creations.map((creation) => ({
        at: { ...creation.at },
        special: creation.special,
      })),
      shellDamage: result.shellDamage,
      vinesCleared: result.vinesCleared,
      scoreDelta: result.scoreDelta,
      board: cloneMatch3Board(draft.board),
    });
    pendingForced = null;
  }
  if (cascade > 48) throw new Error('Match-3 cascade safety limit exceeded');
  return steps;
}

export function match3ObjectivesComplete(state) {
  if (state.score < state.goals.targetScore) return false;
  for (const [color, target] of Object.entries(state.goals.collect)) {
    if ((state.progress.collected[color] ?? 0) < target) return false;
  }
  return state.progress.shellsCleared >= state.goals.shells
    && state.progress.vinesCleared >= state.goals.vines;
}

function shuffleDraftBoard(draft) {
  const originalTiles = draft.board.flatMap((row) => row.map((cell) => cloneTile(cell.tile)));
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const draw = shuffled(originalTiles, draft.rngState);
    draft.rngState = draw.state;
    let index = 0;
    for (let row = 0; row < MATCH3_ROWS; row += 1) {
      for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
        draft.board[row][col].tile = cloneTile(draw.values[index++]);
      }
    }
    if (findMatch3Runs(draft.board).length === 0 && findValidMatch3Moves(draft.board, 1).length > 0) return true;
  }
  return false;
}

function finalizeDraft(draft, steps) {
  if (match3ObjectivesComplete(draft)) draft.status = 'won';
  else if (draft.movesRemaining <= 0) draft.status = 'lost';
  else draft.status = 'active';

  if (draft.status === 'active' && findValidMatch3Moves(draft.board, 1).length === 0) {
    if (!shuffleDraftBoard(draft)) throw new Error('Unable to recover a dead Match-3 board');
    steps.push({
      kind: 'shuffle',
      cascade: 0,
      cleared: [],
      activated: [],
      created: [],
      shellDamage: 0,
      vinesCleared: 0,
      scoreDelta: 0,
      board: cloneMatch3Board(draft.board),
    });
  }
}

function invalidAction(state, reason) {
  return {
    accepted: false,
    reason,
    state: cloneMatch3State(state),
    steps: [],
  };
}

function specialSwapClear(board, first, second) {
  const firstTile = boardCell(board, first)?.tile;
  const secondTile = boardCell(board, second)?.tile;
  if (!firstTile || !secondTile) return null;
  if (firstTile.special === 'spectrum' && secondTile.special === 'spectrum') {
    const coordinates = [];
    for (let row = 0; row < MATCH3_ROWS; row += 1) {
      for (let col = 0; col < MATCH3_COLUMNS; col += 1) coordinates.push({ row, col });
    }
    return { coordinates, spectrumColor: null };
  }
  if (firstTile.special === 'spectrum') {
    return { coordinates: [first, second], spectrumColor: secondTile.color };
  }
  if (secondTile.special === 'spectrum') {
    return { coordinates: [first, second], spectrumColor: firstTile.color };
  }
  if (firstTile.special && secondTile.special) {
    return { coordinates: [first, second], spectrumColor: null };
  }
  return null;
}

export function tryMatch3Swap(state, first, second) {
  if (state.status !== 'active') return invalidAction(state, 'run-ended');
  if (!isMatch3Coordinate(first) || !isMatch3Coordinate(second)) return invalidAction(state, 'out-of-bounds');
  if (!areMatch3Neighbors(first, second)) return invalidAction(state, 'not-adjacent');
  if (!boardCell(state.board, first)?.tile || !boardCell(state.board, second)?.tile) {
    return invalidAction(state, 'empty-cell');
  }

  const draft = cloneMatch3State(state);
  swapTiles(draft.board, first, second);
  const specialClear = specialSwapClear(draft.board, first, second);
  const relevant = new Set([coordinateKey(first), coordinateKey(second)]);
  const createsMatch = findMatch3Runs(draft.board)
    .some((run) => run.cells.some((cell) => relevant.has(coordinateKey(cell))));
  if (!specialClear && !createsMatch) return invalidAction(state, 'no-match');

  draft.movesRemaining -= 1;
  const steps = settleDraft(draft, [second, first], specialClear);
  finalizeDraft(draft, steps);
  return {
    accepted: true,
    reason: 'accepted',
    state: draft,
    steps,
  };
}

export function useMatch3Booster(state, booster, coordinate = null) {
  if (state.status !== 'active') return invalidAction(state, 'run-ended');
  if (!MATCH3_BOOSTERS.includes(booster)) return invalidAction(state, 'unknown-booster');
  if ((state.boosters[booster] ?? 0) <= 0) return invalidAction(state, 'booster-empty');
  const draft = cloneMatch3State(state);
  const steps = [];

  if (booster === 'shuffle') {
    if (!shuffleDraftBoard(draft)) return invalidAction(state, 'shuffle-failed');
    draft.boosters.shuffle -= 1;
    steps.push({
      kind: 'shuffle',
      cascade: 0,
      cleared: [],
      activated: [],
      created: [],
      shellDamage: 0,
      vinesCleared: 0,
      scoreDelta: 0,
      board: cloneMatch3Board(draft.board),
    });
  } else {
    if (!isMatch3Coordinate(coordinate) || !boardCell(draft.board, coordinate)?.tile) {
      return invalidAction(state, 'target-required');
    }
    if (booster === 'spectrum') {
      const tile = boardCell(draft.board, coordinate).tile;
      tile.color = null;
      tile.special = 'spectrum';
      draft.boosters.spectrum -= 1;
      steps.push({
        kind: 'transform',
        cascade: 0,
        cleared: [],
        activated: [],
        created: [{ at: { ...coordinate }, special: 'spectrum' }],
        shellDamage: 0,
        vinesCleared: 0,
        scoreDelta: 0,
        board: cloneMatch3Board(draft.board),
      });
    } else {
      draft.boosters.hammer -= 1;
      steps.push(...settleDraft(draft, [], { coordinates: [{ ...coordinate }], spectrumColor: null }));
    }
  }
  finalizeDraft(draft, steps);
  return {
    accepted: true,
    reason: 'accepted',
    state: draft,
    steps,
  };
}

export function match3Hint(state) {
  if (state.status !== 'active') return null;
  const moves = findValidMatch3Moves(state.board);
  let best = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    const result = tryMatch3Swap(state, move.from, move.to);
    if (!result.accepted) continue;
    let value = result.state.status === 'won' ? 1_000_000 : 0;
    value += (result.state.progress.shellsCleared - state.progress.shellsCleared) * 4_000;
    value += (result.state.progress.vinesCleared - state.progress.vinesCleared) * 4_000;
    for (const [color, target] of Object.entries(state.goals.collect)) {
      const before = Math.min(state.progress.collected[color] ?? 0, target);
      const after = Math.min(result.state.progress.collected[color] ?? 0, target);
      value += (after - before) * 900;
    }
    value += result.state.score - state.score;
    value += result.steps.reduce((sum, step) => sum + step.activated.length * 250, 0);
    if (value > bestValue) {
      bestValue = value;
      best = move;
    }
  }
  return best;
}

export function match3BoardFingerprint(board) {
  return board.map((row) => row.map((cell) => {
    const tile = cell.tile;
    return `${tile?.id ?? 0}:${tile?.color ?? 'x'}:${tile?.special ?? '-'}:${cell.shell}:${cell.vine ? 1 : 0}`;
  }).join(',')).join('|');
}
