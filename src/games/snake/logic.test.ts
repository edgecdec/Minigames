import {
  advanceLevel,
  createGame,
  DIRS,
  generateMaze,
  getTickMsForLevel,
  MAZE_COLS,
  MAZE_ROWS,
  placeFood,
  queueTurn,
  step,
} from "./logic";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// Deterministic pseudo-RNG for testing
function createSeededRng(seed = 12345) {
  let s = seed;
  return function rng() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function canReach(
  walls: boolean[][],
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  const directions = [DIRS.up, DIRS.down, DIRS.left, DIRS.right];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.x === end.x && current.y === end.y) return true;

    for (const dir of directions) {
      const x = current.x + dir.x;
      const y = current.y + dir.y;
      const key = `${x},${y}`;
      if (
        y >= 0 &&
        y < walls.length &&
        x >= 0 &&
        x < walls[0].length &&
        !walls[y][x] &&
        !seen.has(key)
      ) {
        seen.add(key);
        queue.push({ x, y });
      }
    }
  }

  return false;
}

console.log("Running Snake logic tests...");

// Test 1: Classic mode initialization
{
  const game = createGame("classic");
  assert(game.mode === "classic", "Classic mode set");
  assert(game.cols === 20 && game.rows === 20, "Classic 20x20 dimensions");
  assert(game.snake.length === 3, "Snake initial length 3");
  assert(!game.dead, "Snake initially alive");
}

// Test 2: Maze generation solvability & dimensions
{
  const rng = createSeededRng(42);
  const walls = generateMaze(35, 35, rng);
  assert(walls.length === 35, "Maze rows is 35");
  assert(walls[0].length === 35, "Maze cols is 35");
  // Check start (1,1) and exit (33,33) are open paths
  assert(!walls[1][1], "Maze start (1,1) is open passage");
  assert(!walls[33][33], "Maze exit (33,33) is open passage");
  assert(
    canReach(walls, { x: 1, y: 1 }, { x: 33, y: 33 }),
    "Maze has a path from start to exit",
  );
}

// Test 3: Maze mode game creation & speed curve
{
  const rng = createSeededRng(100);
  const game = createGame("maze", 1, 0, rng);
  assert(game.mode === "maze", "Maze mode created");
  assert(game.cols === MAZE_COLS && game.rows === MAZE_ROWS, "35x35 grid");
  assert(game.level === 1, "Level 1");
  assert(game.tickMs === 130, "Level 1 tickMs is 130");
  assert(game.food.x === -1 && game.food.y === -1, "Maze has no food objective");

  const level3Speed = getTickMsForLevel(3);
  assert(level3Speed === 116, `Level 3 speed is 116ms (got ${level3Speed})`);
}

// Test 4: Wall collision in Maze mode
{
  const rng = createSeededRng(1);
  const game = createGame("maze", 1, 0, rng);
  // Ensure wall at cell (1, 0)
  game.walls[0][1] = true;

  // Turn up towards top boundary / wall
  const turned = queueTurn(game, DIRS.up);
  const stepped = step(turned, rng);
  assert(stepped.dead, "Colliding with maze wall results in death");
}

// Test 5: Round completion in Maze mode when reaching exit
{
  const rng = createSeededRng(5);
  const game = createGame("maze", 1, 0, rng);

  // Force snake head near exit (33, 33)
  game.snake = [
    { x: 32, y: 33 },
    { x: 31, y: 33 },
    { x: 30, y: 33 },
  ];
  game.dir = DIRS.right;
  game.exit = { x: 33, y: 33 };
  game.exitOpen = true;

  const stepped = step(game, rng);
  assert(stepped.wonRound, "Reaching exit completes the round");
  assert(stepped.score > 0, "Score increased on round completion");

  // Advance level
  const nextGame = advanceLevel(stepped, rng);
  assert(nextGame.level === 2, "Level advanced to 2");
  assert(nextGame.tickMs < game.tickMs, "Round 2 speed is faster than Round 1");
}

console.log("All Snake logic tests passed successfully!");
