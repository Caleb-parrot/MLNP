import './style.css';
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { GetGhosts, GetPellets, GetPlayerPosition, GetState, MovePlayer, Restart } from '../wailsjs/go/main/GameEngine';

import playerRightUrl from './assets/sprites/playerRight.png';
import playerLeftUrl from './assets/sprites/playerLeft.png';
import playerKindlUrl from './assets/sprites/playerAlternate.png';
import goldCatUrl from './assets/sprites/goldCat.png';
import blueDragonUrl from './assets/sprites/blueDragon.png';
import blackCatsUrl from './assets/sprites/blackCats.png';

// --- Maze constants (rendering only — layout is authoritative in Go maze.go) ---
const TILE = 24;
const COLS = 28;
const ROWS = 31;

// Maze wall layout mirrors Go's buildMazeWalls(). Drawing uses it, and so does
// the one-tile prediction that shows a step before the server answers.
// The server still decides whether the step counts.
const MAZE_WALLS: boolean[][] = buildMazeWalls();

function buildMazeWalls(): boolean[][] {
    const grid: boolean[][] = [];
    for (let y = 0; y < ROWS; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < COLS; x++) {
            row.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1);
        }
        grid.push(row);
    }
    const blocks: Array<[number, number, number, number]> = [
        [3, 3, 5, 2], [10, 3, 8, 2], [22, 3, 3, 2],
        [3, 8, 3, 5], [10, 8, 8, 2], [22, 8, 3, 5],
        [3, 18, 3, 5], [10, 18, 8, 2], [22, 18, 3, 5],
        [3, 27, 5, 2], [10, 27, 8, 2], [22, 27, 3, 2],
    ];
    for (const [x, y, w, h] of blocks) {
        for (let dy = 0; dy < h; dy++)
            for (let dx = 0; dx < w; dx++)
                if (grid[y + dy]) grid[y + dy][x + dx] = true;
    }
    return grid;
}

const SCARED_COLOR = 0x66eeff;

type GhostUpdate = { ID: string; X: number; Y: number; State: number; Dir: number };
type PlayerUpdate = { X: number; Y: number; Dir: number };
type GameState = {
    Score: number; Lives: number; GameOver: boolean; Won?: boolean;
    Swift?: boolean; Frozen?: boolean; SwiftMS?: number; FrozenMS?: number;
};

// Pellet values returned by Go: 0=present, 1=wall, 2=normal eaten, 3=power eaten
type PelletGrid = number[][];

// Flood-fill near-white pixels that touch the sprite edge so crest backgrounds
// drop out, while white lozenges inside a shield stay painted.
function loadKeyed(url: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('no 2d context'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = image.data;
            const w = canvas.width;
            const h = canvas.height;
            const seen = new Uint8Array(w * h);
            const stack = [0, w - 1, (h - 1) * w, (h - 1) * w + (w - 1)];
            const white = (p: number) => {
                const i = p * 4;
                return data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
            };
            while (stack.length) {
                const p = stack.pop() as number;
                if (p < 0 || p >= seen.length || seen[p]) continue;
                seen[p] = 1;
                if (!white(p)) continue;
                data[p * 4 + 3] = 0;
                const x = p % w;
                const y = Math.floor(p / w);
                if (x > 0) stack.push(p - 1);
                if (x + 1 < w) stack.push(p + 1);
                if (y > 0) stack.push(p - w);
                if (y + 1 < h) stack.push(p + w);
            }
            ctx.putImageData(image, 0, 0);
            resolve(Texture.from(canvas));
        };
        img.onerror = () => reject(new Error(`sprite failed: ${url}`));
        img.src = url;
    });
}

async function main() {
    const app = new Application();
    await app.init({
        width: COLS * TILE,
        height: ROWS * TILE + 40,
        background: 0x000000,
        antialias: true,
    });
    document.getElementById('app')!.appendChild(app.canvas);

    function fitCanvas() {
        const scale = Math.min(
            window.innerWidth / app.canvas.width,
            window.innerHeight / app.canvas.height,
        );
        app.canvas.style.width = `${Math.floor(app.canvas.width * scale)}px`;
        app.canvas.style.height = `${Math.floor(app.canvas.height * scale)}px`;
    }
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    // --- HUD ---
    const scoreStyle = new TextStyle({ fill: 0xffffff, fontSize: 16, fontFamily: 'monospace' });
    const scoreText = new Text({ text: 'SCORE  0', style: scoreStyle });
    scoreText.x = 8;
    scoreText.y = ROWS * TILE + 10;
    app.stage.addChild(scoreText);

    const hintStyle = new TextStyle({ fill: 0x888888, fontSize: 13, fontFamily: 'monospace' });
    const hintText = new Text({ text: 'WASD / ARROWS    R RESTART', style: hintStyle });
    hintText.anchor.set(0.5, 0);
    hintText.x = (COLS * TILE) / 2;
    hintText.y = ROWS * TILE + 12;
    app.stage.addChild(hintText);

    const livesStyle = new TextStyle({ fill: 0xffff00, fontSize: 16, fontFamily: 'monospace' });
    const livesText = new Text({ text: 'LIVES  3', style: livesStyle });
    livesText.anchor.set(1, 0);
    livesText.x = COLS * TILE - 8;
    livesText.y = ROWS * TILE + 10;
    app.stage.addChild(livesText);

    const overStyle = new TextStyle({ fill: 0xff3333, fontSize: 48, fontFamily: 'monospace', fontWeight: 'bold' });
    const overText = new Text({ text: 'GAME OVER', style: overStyle });
    overText.anchor.set(0.5);
    overText.x = (COLS * TILE) / 2;
    overText.y = (ROWS * TILE) / 2;
    overText.visible = false;
    app.stage.addChild(overText);

    // --- Static layers ---
    drawMaze(app.stage);

    const pelletLayer = new Container();
    app.stage.addChild(pelletLayer);

    // --- Textures ---
    const [playerRightTex, playerLeftTex, kindlTex, goldCatTex, blueDragonTex, blackCatsTex] = await Promise.all([
        loadKeyed(playerRightUrl),
        loadKeyed(playerLeftUrl),
        loadKeyed(playerKindlUrl),
        loadKeyed(goldCatUrl),
        loadKeyed(blueDragonUrl),
        loadKeyed(blackCatsUrl),
    ]);
    const ghostTextures: Record<string, Texture> = {
        Spot: goldCatTex,
        Tracker: blueDragonTex,
        Shadow: blackCatsTex,
    };

    function setupTileSprite(s: Sprite) {
        s.anchor.set(0.5);
        s.width = TILE - 2;
        s.height = TILE - 2;
    }

    // --- Ghost layer ---
    const ghostLayer = new Container();
    app.stage.addChild(ghostLayer);

    // --- Player ---
    const player = new Sprite(playerRightTex);
    setupTileSprite(player);
    app.stage.addChild(player);

    let lastPlayer: PlayerUpdate = { X: 14, Y: 23, Dir: 0 };
    let powered = false;
    const scared = new Set<string>();
    let roundOver = false;
    let lastLives = 3;
    let swiftUntil = 0;
    let frozenUntil = 0;
    let confirmed: PlayerUpdate = { X: 14, Y: 23, Dir: 0 };
    // Same walking pace as before. The first tap no longer waits for a tick.
    const STEP_MS = 150;
    const SWIFT_STEP_MS = 70;

    function applyPlayerUpdate(u: PlayerUpdate) {
        lastPlayer = u;
        placeAtTile(player, u.X, u.Y);
        if (powered) {
            player.texture = kindlTex;
            return;
        }
        // Dir: 0=right 1=left 2=up 3=down (up/down borrow the horiz sprites)
        const leftish = u.Dir === 1 || u.Dir === 2;
        player.texture = leftish ? playerLeftTex : playerRightTex;
    }

    function refreshHint() {
        const now = performance.now();
        const frozen = now < frozenUntil;
        const swift = now < swiftUntil;
        if (powered) {
            hintText.text = 'EAT THE BLUE CRESTS';
            hintText.style.fill = 0x66eeff;
        } else if (frozen && swift) {
            hintText.text = 'SWIFT · CRESTS FROZEN';
            hintText.style.fill = 0xccffee;
        } else if (frozen) {
            hintText.text = 'CRESTS FROZEN';
            hintText.style.fill = 0x66eeff;
        } else if (swift) {
            hintText.text = 'SWIFT';
            hintText.style.fill = 0x44ff88;
        } else {
            hintText.text = 'GOLD SCARES   GREEN SWIFT   BLUE FREEZE   PINK LIFE';
            hintText.style.fill = 0x888888;
        }
    }

    function setPowered(on: boolean) {
        const changed = powered !== on;
        powered = on;
        refreshHint();
        if (changed) applyPlayerUpdate(lastPlayer);
    }

    // --- Initial state sync from Go ---
    const [initPlayer, initState, initPellets] = await Promise.all([
        GetPlayerPosition(),
        GetState(),
        GetPellets(),
    ]);
    confirmed = initPlayer;
    applyPlayerUpdate(initPlayer);
    applyGameState(initState);
    drawPellets(pelletLayer, initPellets);

    // --- Keyboard ---
    document.body.tabIndex = 0;
    document.body.focus();
    window.addEventListener('click', () => document.body.focus());

    const heldDirs: string[] = [];
    const DIR_KEYS: Record<string, string> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right',
    };
    let startWasDown = false;

    window.addEventListener('keydown', (e) => {
        if (DIR_KEYS[e.key]) {
            if (roundOver) return;
            e.preventDefault();
            const i = heldDirs.indexOf(e.key);
            if (i !== -1) heldDirs.splice(i, 1);
            heldDirs.push(e.key);
            // A short tap still counts once, even if the key is up before the
            // next tile is free. Key-repeat must not refresh that buffer, or
            // letting go would always sneak in one more step.
            if (!e.repeat) {
                tapDir = DIR_KEYS[e.key];
                tapFresh = true;
            }
            tryStep();
            return;
        }
        if (e.key === 'r' || e.key === 'R') {
            Restart();
        }
    });
    window.addEventListener('keyup', (e) => {
        const i = heldDirs.indexOf(e.key);
        if (i !== -1) heldDirs.splice(i, 1);
        if (!tapFresh) tapDir = '';
    });

    function keyboardDir(): string {
        const key = heldDirs[heldDirs.length - 1];
        return key ? DIR_KEYS[key] : '';
    }

    function gamepadDir(): string {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const pad of pads) {
            if (!pad) continue;
            const ax = pad.axes[0] ?? 0;
            const ay = pad.axes[1] ?? 0;
            if (Math.hypot(ax, ay) > 0.45) {
                if (Math.abs(ax) > Math.abs(ay)) return ax > 0 ? 'right' : 'left';
                return ay > 0 ? 'down' : 'up';
            }
            if (pad.buttons[12]?.pressed) return 'up';
            if (pad.buttons[13]?.pressed) return 'down';
            if (pad.buttons[14]?.pressed) return 'left';
            if (pad.buttons[15]?.pressed) return 'right';
        }
        return '';
    }

    function startPressed(): boolean {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const pad of pads) {
            if (pad?.buttons[9]?.pressed) return true;
        }
        return false;
    }

    // One step in flight. The sprite moves on the tap; the server snaps it
    // if the tile was a wall or a crest. Letting go stops, except a tap that
    // landed while a step was already underway still gets its one tile.
    let stepBusy = false;
    let lastStepAt = 0;
    let stepTimer = 0;
    let tapDir = '';
    let tapFresh = false;
    let lastPad = '';

    function stepMs(): number {
        return performance.now() < swiftUntil ? SWIFT_STEP_MS : STEP_MS;
    }

    function desiredDir(): string {
        return keyboardDir() || gamepadDir() || tapDir;
    }

    function arm(ms: number) {
        if (stepTimer) return;
        stepTimer = window.setTimeout(() => {
            stepTimer = 0;
            tryStep();
        }, Math.max(0, ms));
    }

    function predict(dir: string) {
        let x = confirmed.X;
        let y = confirmed.Y;
        let d = confirmed.Dir;
        if (dir === 'up') { y--; d = 2; }
        else if (dir === 'down') { y++; d = 3; }
        else if (dir === 'left') { x--; d = 1; }
        else if (dir === 'right') { x++; d = 0; }
        else return;
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        if (MAZE_WALLS[y][x]) return;
        applyPlayerUpdate({ X: x, Y: y, Dir: d });
    }

    function tryStep() {
        if (roundOver) return;
        const dir = desiredDir();
        if (!dir) return;
        if (stepBusy) {
            if (tapFresh) tapDir = dir;
            return;
        }
        const wait = stepMs() - (performance.now() - lastStepAt);
        if (wait > 0) {
            if (tapFresh) tapDir = dir;
            arm(wait);
            return;
        }
        tapDir = '';
        tapFresh = false;
        stepBusy = true;
        lastStepAt = performance.now();
        predict(dir);
        let moved = true;
        MovePlayer(dir).then((ok) => { moved = !!ok; }).finally(() => {
            stepBusy = false;
            // A wall does not charge a full tile of waiting, so a turn that
            // was held into a corner happens as soon as the opening is there.
            if (!moved) lastStepAt = performance.now() - stepMs() + 32;
            if (roundOver) return;
            const next = desiredDir();
            if (!next) return;
            const remain = stepMs() - (performance.now() - lastStepAt);
            if (remain > 0) arm(remain);
            else tryStep();
        });
    }

    setInterval(() => {
        const start = startPressed();
        if (start && !startWasDown && roundOver) Restart();
        startWasDown = start;
        const pad = gamepadDir();
        if (pad && pad !== lastPad) {
            tapDir = pad;
            tapFresh = true;
        }
        lastPad = pad;
        refreshHint();
        if (!stepBusy && !stepTimer) tryStep();
    }, 32);

    // --- Events from Go ---

    EventsOn('player:update', (u: PlayerUpdate) => {
        confirmed = u;
        applyPlayerUpdate(u);
    });

    EventsOn('game:state', (s: GameState) => {
        applyGameState(s);
    });

    // pellet:update is emitted after every MovePlayer that eats a pellet.
    // Go sends the full grid so we never have to diff locally.
    EventsOn('pellet:update', (grid: PelletGrid) => {
        drawPellets(pelletLayer, grid);
    });

    type GhostNodes = { sprite?: Sprite; eaten: Graphics; current: Container };
    const ghostCache = new Map<string, GhostNodes>();

    function showGhost(u: GhostUpdate) {
        let nodes = ghostCache.get(u.ID);
        if (!nodes) {
            const eaten = new Graphics();
            const tex = ghostTextures[u.ID];
            const sprite = tex ? new Sprite(tex) : undefined;
            if (sprite) setupTileSprite(sprite);
            nodes = { sprite, eaten, current: sprite ?? eaten };
            ghostLayer.addChild(nodes.current);
            ghostCache.set(u.ID, nodes);
        }

        const state = Number(u.State);
        const wantEaten = state === 2 || !nodes.sprite;
        const desired = wantEaten ? nodes.eaten : nodes.sprite!;
        if (desired !== nodes.current) {
            ghostLayer.removeChild(nodes.current);
            ghostLayer.addChild(desired);
            nodes.current = desired;
        }

        if (wantEaten) {
            drawEatenGhost(nodes.eaten);
        } else if (nodes.sprite) {
            const scaredNow = state === 1;
            const dormant = state === 3;
            nodes.sprite.tint = scaredNow ? SCARED_COLOR : 0xffffff;
            nodes.sprite.alpha = dormant ? 0.4 : 1;
            const side = scaredNow ? TILE + 6 : TILE - 2;
            nodes.sprite.width = side;
            nodes.sprite.height = side;
        }
        placeAtTile(nodes.current, u.X, u.Y);

        if (state === 1) scared.add(u.ID);
        else scared.delete(u.ID);
        setPowered(scared.size > 0);
    }

    EventsOn('ghost:update', (u: GhostUpdate) => showGhost(u));
    for (const g of await GetGhosts()) showGhost(g);

    function applyGameState(s: GameState) {
        scoreText.text = `SCORE  ${s.Score}`;
        livesText.text = `LIVES  ${s.Lives}`;
        const won = !!s.Won;
        roundOver = s.GameOver || won;
        overText.visible = roundOver;
        if (won) {
            overText.text = 'YOU WIN';
            overText.style.fill = 0xffd700;
        } else {
            overText.text = 'GAME OVER';
            overText.style.fill = 0xff3333;
        }
        if (s.Lives < lastLives && !s.GameOver) {
            player.alpha = 0.45;
            window.setTimeout(() => { player.alpha = 1; }, 1500);
        }
        lastLives = s.Lives;
        // Remaining time comes from the server, so a second pickup extends the effect.
        swiftUntil = (s.SwiftMS ?? 0) > 0 ? performance.now() + (s.SwiftMS as number) : 0;
        frozenUntil = (s.FrozenMS ?? 0) > 0 ? performance.now() + (s.FrozenMS as number) : 0;
        if (!roundOver) setPowered(scared.size > 0);
        else setPowered(false);
        refreshHint();
    }
}

// --- Pure rendering helpers ---

function drawEatenGhost(g: Graphics) {
    g.clear();
    g.circle(-4, -3, 4).fill(0xffffff);
    g.circle(4, -3, 4).fill(0xffffff);
    g.circle(-3, -3, 2).fill(0x0000ff);
    g.circle(5, -3, 2).fill(0x0000ff);
}

function drawPellets(layer: Container, grid: PelletGrid) {
    layer.removeChildren();
    if (!grid) return;
    const dots = new Graphics();
    const scare = new Graphics();
    const swift = new Graphics();
    const freeze = new Graphics();
    const life = new Graphics();
    for (let y = 0; y < ROWS; y++) {
        const row = grid[y];
        if (!row) continue;
        for (let x = 0; x < COLS; x++) {
            const cx = x * TILE + TILE / 2;
            const cy = y * TILE + TILE / 2;
            switch (Number(row[x])) {
                case 0:
                    dots.circle(cx, cy, 3);
                    break;
                case 4:
                    scare.circle(cx, cy, 6);
                    break;
                case 5:
                    swift.poly([cx, cy - 7, cx + 7, cy, cx, cy + 7, cx - 7, cy]);
                    break;
                case 6:
                    freeze.rect(cx - 5, cy - 5, 10, 10);
                    break;
                case 7:
                    life.circle(cx, cy, 5);
                    break;
                default:
                    break;
            }
        }
    }
    // One fill per path. Per-circle fill() in Pixi 8 drops the dots.
    dots.fill({ color: 0xffcc88 });
    scare.fill({ color: 0xffd700 });
    swift.fill({ color: 0x44ff88 });
    freeze.fill({ color: 0x66eeff });
    life.fill({ color: 0xff4488 });
    layer.addChild(dots);
    layer.addChild(scare);
    layer.addChild(swift);
    layer.addChild(freeze);
    layer.addChild(life);
}

function placeAtTile(node: Container, x: number, y: number) {
    node.x = x * TILE + TILE / 2;
    node.y = y * TILE + TILE / 2;
}

function drawMaze(stage: Container) {
    const g = new Graphics();
    for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
            if (MAZE_WALLS[y][x]) g.rect(x * TILE, y * TILE, TILE, TILE);
    g.fill(0x1a1aff);
    g.stroke({ color: 0x4444ff, width: 1 });
    stage.addChild(g);
}

main().catch((err) => console.error(err));
