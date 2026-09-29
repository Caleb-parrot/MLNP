import './style.css';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { GetGhosts, GetPellets, GetPlayerPosition, GetState, GetWallSkin, MovePlayer, Restart } from '../wailsjs/go/main/GameEngine';

import playerUrl from './assets/sprites/player1.png';
import tetrisUrl from './assets/sprites/tetris.png';
import goldCatUrl from './assets/sprites/goldCat.png';
import blueDragonUrl from './assets/sprites/blueDragon.png';
import blackCatsUrl from './assets/sprites/blackCats.png';

// Maze constants. Layout is authoritative in Go maze.go.
const TILE = 24;
const COLS = 28;
const ROWS = 31;
const VIEW_W = COLS * TILE;
const VIEW_H = ROWS * TILE + 40;
// Sprites are stored at the scared-crest size and drawn smaller when calm.
const SPRITE = 32;

// Walls arrive from Go as wallSkin. Until that loads, prediction stays put.
let mazeWalls: boolean[][] = [];

// Crops of the solid cells in tetris.png. piece 1-7 is J L I O S Z T.
type Crop = { x: number; y: number; w: number; h: number };
const CROPS: Record<number, Record<string, Crop>> = {
    1: {
        '0,0': { x: 16, y: 16, w: 117, h: 118 },
        '0,1': { x: 16, y: 134, w: 117, h: 118 },
        '1,1': { x: 133, y: 134, w: 118, h: 118 },
        '2,1': { x: 251, y: 134, w: 117, h: 118 },
    },
    2: {
        '2,0': { x: 252, y: 268, w: 116, h: 116 },
        '0,1': { x: 20, y: 384, w: 116, h: 116 },
        '1,1': { x: 136, y: 384, w: 116, h: 116 },
        '2,1': { x: 252, y: 384, w: 116, h: 116 },
    },
    3: {
        '0,0': { x: 20, y: 516, w: 117, h: 116 },
        '1,0': { x: 137, y: 516, w: 117, h: 116 },
        '2,0': { x: 254, y: 516, w: 117, h: 116 },
        '3,0': { x: 371, y: 516, w: 117, h: 116 },
    },
    4: {
        '0,0': { x: 140, y: 648, w: 116, h: 116 },
        '1,0': { x: 256, y: 648, w: 116, h: 116 },
        '0,1': { x: 140, y: 764, w: 116, h: 116 },
        '1,1': { x: 256, y: 764, w: 116, h: 116 },
    },
    5: {
        '1,0': { x: 137, y: 900, w: 118, h: 116 },
        '2,0': { x: 255, y: 900, w: 117, h: 116 },
        '0,1': { x: 20, y: 1016, w: 117, h: 116 },
        '1,1': { x: 137, y: 1016, w: 118, h: 116 },
    },
    6: {
        '0,0': { x: 20, y: 1148, w: 117, h: 116 },
        '1,0': { x: 137, y: 1148, w: 118, h: 116 },
        '1,1': { x: 137, y: 1264, w: 118, h: 116 },
        '2,1': { x: 255, y: 1264, w: 117, h: 116 },
    },
    7: {
        '1,0': { x: 137, y: 1396, w: 118, h: 116 },
        '0,1': { x: 20, y: 1512, w: 117, h: 116 },
        '1,1': { x: 137, y: 1512, w: 118, h: 116 },
        '2,1': { x: 255, y: 1512, w: 117, h: 116 },
    },
};

type GhostUpdate = { ID: string; X: number; Y: number; State: number; Dir: number };
type PlayerUpdate = { X: number; Y: number; Dir: number };
type GameState = {
    Score: number; Lives: number; GameOver: boolean; Won?: boolean;
    Swift?: boolean; Frozen?: boolean; SwiftMS?: number; FrozenMS?: number;
};
type PelletGrid = number[][];

// Flood-fill near-white pixels that touch the sprite edge so crest backgrounds
// drop out, while white lozenges inside a shield stay painted. The result is a
// tile-sized canvas; the source bitmap is not kept.
function loadKeyed(url: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const src = document.createElement('canvas');
            src.width = img.width;
            src.height = img.height;
            const sctx = src.getContext('2d');
            if (!sctx) {
                reject(new Error('no 2d context'));
                return;
            }
            sctx.drawImage(img, 0, 0);
            const image = sctx.getImageData(0, 0, src.width, src.height);
            const data = image.data;
            const w = src.width;
            const h = src.height;
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
            sctx.putImageData(image, 0, 0);
            const out = document.createElement('canvas');
            out.width = SPRITE;
            out.height = SPRITE;
            const octx = out.getContext('2d');
            if (!octx) {
                reject(new Error('no 2d context'));
                return;
            }
            octx.imageSmoothingEnabled = false;
            octx.drawImage(src, 0, 0, SPRITE, SPRITE);
            resolve(out);
        };
        img.onerror = () => reject(new Error(`sprite failed: ${url}`));
        img.src = url;
    });
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

function context2d(c: HTMLCanvasElement, opaque = false): CanvasRenderingContext2D {
    const ctx = c.getContext('2d', { alpha: !opaque });
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = false;
    return ctx;
}

async function main() {
    const view = makeCanvas(VIEW_W, VIEW_H);
    const ctx = context2d(view);
    document.getElementById('app')!.appendChild(view);

    function fitCanvas() {
        const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
        view.style.width = `${Math.floor(VIEW_W * scale)}px`;
        view.style.height = `${Math.floor(VIEW_H * scale)}px`;
    }
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    const maze = makeCanvas(VIEW_W, ROWS * TILE);
    const mazeCtx = context2d(maze, true);
    const pelletLayer = makeCanvas(VIEW_W, ROWS * TILE);
    const pelletCtx = context2d(pelletLayer);
    const scratch = makeCanvas(SPRITE, SPRITE);
    const scratchCtx = context2d(scratch);
    scratchCtx.imageSmoothingEnabled = true;

    const [playerImg, tetris, goldCat, blueDragon, blackCats] = await Promise.all([
        loadKeyed(playerUrl),
        loadImage(tetrisUrl),
        loadKeyed(goldCatUrl),
        loadKeyed(blueDragonUrl),
        loadKeyed(blackCatsUrl),
    ]);
    const ghostSprites: Record<string, HTMLCanvasElement> = {
        Spot: goldCat,
        Tracker: blueDragon,
        Shadow: blackCats,
    };

    let playerPos: PlayerUpdate = { X: 14, Y: 23, Dir: 0 };
    let playerAlpha = 1;
    let powered = false;
    const scared = new Set<string>();
    const ghosts = new Map<string, GhostUpdate>();
    let roundOver = false;
    let lastLives = 3;
    let swiftUntil = 0;
    let frozenUntil = 0;
    let confirmed: PlayerUpdate = { X: 14, Y: 23, Dir: 0 };
    let scoreText = 'SCORE  0';
    let livesText = 'LIVES  3';
    let hintText = '';
    let hintColor = '#888888';
    let overText = '';
    let overColor = '#ff3333';

    // Same walking pace as before. The first tap no longer waits for a tick.
    const STEP_MS = 150;
    const SWIFT_STEP_MS = 70;

    let drawQueued = 0;
    function requestDraw() {
        if (drawQueued) return;
        drawQueued = requestAnimationFrame(() => {
            drawQueued = 0;
            paint();
        });
    }

    function paint() {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.drawImage(maze, 0, 0);
        ctx.drawImage(pelletLayer, 0, 0);
        for (const g of ghosts.values()) drawGhost(g);
        drawPlayer();
        drawHud();
    }

    function drawPlayer() {
        const leftish = playerPos.Dir === 1 || playerPos.Dir === 2;
        blit(playerImg, playerPos.X, playerPos.Y, powered ? TILE + 4 : TILE - 2, playerAlpha, powered ? '#ffd700' : '', leftish);
    }

    function drawGhost(g: GhostUpdate) {
        const state = Number(g.State);
        if (state === 2) {
            drawEyes(g.X, g.Y);
            return;
        }
        const img = ghostSprites[g.ID];
        if (!img) {
            drawEyes(g.X, g.Y);
            return;
        }
        const scaredNow = state === 1;
        const dormant = state === 3;
        blit(img, g.X, g.Y, scaredNow ? TILE + 6 : TILE - 2, dormant ? 0.4 : 1, scaredNow ? '#66eeff' : '', false);
    }

    function blit(img: HTMLCanvasElement, x: number, y: number, size: number, alpha: number, tint: string, flip: boolean) {
        scratchCtx.clearRect(0, 0, SPRITE, SPRITE);
        scratchCtx.globalCompositeOperation = 'source-over';
        scratchCtx.globalAlpha = 1;
        scratchCtx.drawImage(img, 0, 0, size, size);
        if (tint) {
            scratchCtx.globalCompositeOperation = 'source-atop';
            scratchCtx.fillStyle = tint;
            scratchCtx.globalAlpha = 0.55;
            scratchCtx.fillRect(0, 0, size, size);
            scratchCtx.globalAlpha = 1;
            scratchCtx.globalCompositeOperation = 'source-over';
        }
        const cx = x * TILE + TILE / 2;
        const cy = y * TILE + TILE / 2;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        if (flip) ctx.scale(-1, 1);
        ctx.drawImage(scratch, 0, 0, size, size, -size / 2, -size / 2, size, size);
        ctx.restore();
    }

    function drawEyes(x: number, y: number) {
        const cx = x * TILE + TILE / 2;
        const cy = y * TILE + TILE / 2;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 4, cy - 3, 4, 0, Math.PI * 2);
        ctx.arc(cx + 4, cy - 3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0000ff';
        ctx.beginPath();
        ctx.arc(cx - 3, cy - 3, 2, 0, Math.PI * 2);
        ctx.arc(cx + 5, cy - 3, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawHud() {
        ctx.textBaseline = 'top';
        ctx.font = '16px monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(scoreText, 8, ROWS * TILE + 10);
        ctx.font = '13px monospace';
        ctx.fillStyle = hintColor;
        ctx.textAlign = 'center';
        ctx.fillText(hintText, VIEW_W / 2, ROWS * TILE + 12);
        ctx.font = '16px monospace';
        ctx.fillStyle = '#ffff00';
        ctx.textAlign = 'right';
        ctx.fillText(livesText, VIEW_W - 8, ROWS * TILE + 10);
        if (!overText) return;
        ctx.font = 'bold 48px monospace';
        ctx.fillStyle = overColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(overText, VIEW_W / 2, (ROWS * TILE) / 2);
    }

    function storePellets(grid: PelletGrid) {
        pelletCtx.clearRect(0, 0, VIEW_W, ROWS * TILE);
        if (!grid) return;
        for (let y = 0; y < ROWS; y++) {
            const row = grid[y];
            if (!row) continue;
            for (let x = 0; x < COLS; x++) {
                const cx = x * TILE + TILE / 2;
                const cy = y * TILE + TILE / 2;
                switch (Number(row[x])) {
                    case 0:
                        dot(cx, cy, 3, '#ffcc88');
                        break;
                    case 4:
                        dot(cx, cy, 6, '#ffd700');
                        break;
                    case 5:
                        pelletCtx.fillStyle = '#44ff88';
                        pelletCtx.beginPath();
                        pelletCtx.moveTo(cx, cy - 7);
                        pelletCtx.lineTo(cx + 7, cy);
                        pelletCtx.lineTo(cx, cy + 7);
                        pelletCtx.lineTo(cx - 7, cy);
                        pelletCtx.closePath();
                        pelletCtx.fill();
                        break;
                    case 6:
                        pelletCtx.fillStyle = '#66eeff';
                        pelletCtx.fillRect(cx - 5, cy - 5, 10, 10);
                        break;
                    case 7:
                        dot(cx, cy, 5, '#ff4488');
                        break;
                    default:
                        break;
                }
            }
        }
        requestDraw();
    }

    function dot(cx: number, cy: number, r: number, color: string) {
        pelletCtx.fillStyle = color;
        pelletCtx.beginPath();
        pelletCtx.arc(cx, cy, r, 0, Math.PI * 2);
        pelletCtx.fill();
    }

    function applyPlayerUpdate(u: PlayerUpdate) {
        playerPos = u;
        requestDraw();
    }

    function refreshHint() {
        const now = performance.now();
        const frozen = now < frozenUntil;
        const swift = now < swiftUntil;
        let text: string;
        let color: string;
        if (powered) {
            text = 'EAT THE BLUE CRESTS';
            color = '#66eeff';
        } else if (frozen && swift) {
            text = 'SWIFT · CRESTS FROZEN';
            color = '#ccffee';
        } else if (frozen) {
            text = 'CRESTS FROZEN';
            color = '#66eeff';
        } else if (swift) {
            text = 'SWIFT';
            color = '#44ff88';
        } else {
            text = 'GOLD SCARES   GREEN SWIFT   BLUE FREEZE   PINK LIFE';
            color = '#888888';
        }
        if (text === hintText && color === hintColor) return;
        hintText = text;
        hintColor = color;
        requestDraw();
    }

    function setPowered(on: boolean) {
        const changed = powered !== on;
        powered = on;
        refreshHint();
        if (changed) requestDraw();
    }

    const [initPlayer, initState, initPellets, skin] = await Promise.all([
        GetPlayerPosition(),
        GetState(),
        GetPellets(),
        GetWallSkin(),
    ]);
    mazeWalls = (skin as number[][]).map((row) => row.map((v) => Number(v) !== 0));
    paintMaze(mazeCtx, skin as number[][], tetris);
    confirmed = initPlayer;
    playerPos = initPlayer;
    applyGameState(initState);
    storePellets(initPellets);

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
            if (!e.repeat) {
                tapDir = DIR_KEYS[e.key];
                tapFresh = true;
            }
            tryStep();
            return;
        }
        if (e.key === 'r' || e.key === 'R') Restart();
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
        if (!mazeWalls[y] || mazeWalls[y][x]) return;
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

    EventsOn('player:update', (u: PlayerUpdate) => {
        confirmed = u;
        applyPlayerUpdate(u);
    });
    EventsOn('game:state', (s: GameState) => applyGameState(s));
    EventsOn('pellet:update', (grid: PelletGrid) => storePellets(grid));
    EventsOn('ghost:update', (u: GhostUpdate) => showGhost(u));
    for (const g of await GetGhosts()) showGhost(g);
    requestDraw();

    function showGhost(u: GhostUpdate) {
        ghosts.set(u.ID, u);
        const state = Number(u.State);
        if (state === 1) scared.add(u.ID);
        else scared.delete(u.ID);
        setPowered(scared.size > 0 && !roundOver);
        requestDraw();
    }

    function applyGameState(s: GameState) {
        scoreText = `SCORE  ${s.Score}`;
        livesText = `LIVES  ${s.Lives}`;
        const won = !!s.Won;
        roundOver = s.GameOver || won;
        if (roundOver) {
            overText = won ? 'YOU WIN' : 'GAME OVER';
            overColor = won ? '#ffd700' : '#ff3333';
        } else {
            overText = '';
        }
        if (s.Lives < lastLives && !s.GameOver) {
            playerAlpha = 0.45;
            window.setTimeout(() => {
                playerAlpha = 1;
                requestDraw();
            }, 1500);
        }
        lastLives = s.Lives;
        swiftUntil = (s.SwiftMS ?? 0) > 0 ? performance.now() + (s.SwiftMS as number) : 0;
        frozenUntil = (s.FrozenMS ?? 0) > 0 ? performance.now() + (s.FrozenMS as number) : 0;
        if (roundOver) setPowered(false);
        else setPowered(scared.size > 0);
        refreshHint();
        requestDraw();
    }
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`image failed: ${url}`));
        img.src = url;
    });
}

const tileCache = new Map<number, HTMLCanvasElement>();

function turnClockwise(src: HTMLCanvasElement): HTMLCanvasElement {
    const dst = makeCanvas(TILE, TILE);
    const g = dst.getContext('2d');
    if (!g) return src;
    g.translate(TILE, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
    return dst;
}

function mazeTile(skin: number, sheet: HTMLImageElement): HTMLCanvasElement {
    const hit = tileCache.get(skin);
    if (hit) return hit;
    let piece = skin >> 8;
    let rot = (skin >> 4) & 3;
    let sx = skin & 3;
    let sy = (skin >> 2) & 3;
    if (piece === 8) {
        piece = 1;
        sx = 1;
        sy = 1;
        rot = 0;
    }
    const crop = CROPS[piece]?.[`${sx},${sy}`];
    const base = makeCanvas(TILE, TILE);
    const bctx = base.getContext('2d');
    if (!bctx) return base;
    bctx.imageSmoothingEnabled = true;
    if (crop) bctx.drawImage(sheet, crop.x, crop.y, crop.w, crop.h, 0, 0, TILE, TILE);
    else {
        bctx.fillStyle = '#1a1aff';
        bctx.fillRect(0, 0, TILE, TILE);
    }
    let cur = base;
    for (let i = 0; i < rot; i++) cur = turnClockwise(cur);
    tileCache.set(skin, cur);
    return cur;
}

function paintMaze(g: CanvasRenderingContext2D, skin: number[][], sheet: HTMLImageElement) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, VIEW_W, ROWS * TILE);
    for (let y = 0; y < ROWS; y++) {
        const row = skin[y];
        if (!row) continue;
        for (let x = 0; x < COLS; x++) {
            const v = Number(row[x]);
            if (!v) continue;
            g.drawImage(mazeTile(v, sheet), x * TILE, y * TILE);
        }
    }
}

main().catch((err) => console.error(err));
