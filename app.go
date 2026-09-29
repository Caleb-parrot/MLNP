package main

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// GameState is the snapshot emitted to the frontend on every state change.
type GameState struct {
	Score    int   `json:"Score"`
	Lives    int   `json:"Lives"`
	GameOver bool  `json:"GameOver"`
	Won      bool  `json:"Won"`
	Swift    bool  `json:"Swift"`
	Frozen   bool  `json:"Frozen"`
	SwiftMS  int64 `json:"SwiftMS"`
	FrozenMS int64 `json:"FrozenMS"`
}

// PlayerUpdate is emitted after each successful MovePlayer call.
type PlayerUpdate struct {
	X   int `json:"X"`
	Y   int `json:"Y"`
	Dir int `json:"Dir"` // 0=right 1=left 2=up 3=down
}

// GameEngine is the Wails-bound type. It owns the ghost goroutines, the
// channels that connect them to the game loop, and the loop itself. Ghost
// updates and player updates are forwarded to the frontend as Wails runtime
// events. All simulation state (position, pellets, score, lives) lives here.
//
// Each ghost has its own command channel so that broadcasts (scare, reset)
// reach every ghost rather than being consumed by whichever goroutine wins
// the race for a shared channel.
type GameEngine struct {
	ctx context.Context

	updateCh chan GhostUpdate

	mu          sync.RWMutex
	pacX        int
	pacY        int
	dir         int
	pellets     [][]int8 // 0=pellet 1=wall 2=eaten 3=power-pellet-eaten
	score       int
	lives       int
	gameOver    bool
	won         bool
	invulnUntil time.Time
	swiftUntil  time.Time
	freezeUntil time.Time
	ghosts      map[string]*Ghost
	ghostPos    map[string]GhostUpdate
	ghostCmds   map[string]chan<- GhostCommand // send-end of each ghost's commandCh

	lua *LuaManager

	cancel context.CancelFunc
	loopWG sync.WaitGroup
}

const (
	playerSpawnX = 14
	playerSpawnY = 23
	lifeMercy    = 1500 * time.Millisecond
	swiftLength  = 5 * time.Second
	freezeLength = 4 * time.Second
	maxLives     = 5

	cellPellet int8 = 0
	cellWall   int8 = 1
	cellEaten  int8 = 2
	cellScare  int8 = 4
	cellSwift  int8 = 5
	cellFreeze int8 = 6
	cellLife   int8 = 7
)

// freezeUntilNano is what the ghost goroutines read, so they do not take the
// engine lock on every tick.
var freezeUntilNano atomic.Int64

var scarePellets = [][2]int{
	{1, 2}, {25, 2}, {2, 28}, {25, 28},
	{14, 6}, {14, 21}, {6, 15}, {21, 15},
}
var swiftPellets = [][2]int{{1, 6}, {26, 6}, {1, 23}, {26, 23}}
var freezePellets = [][2]int{{8, 11}, {19, 11}, {14, 15}}
var lifePellets = [][2]int{{14, 2}, {14, 26}}

func buildPellets() [][]int8 {
	grid := make([][]int8, mazeRows)
	for y := 0; y < mazeRows; y++ {
		grid[y] = make([]int8, mazeCols)
		for x := 0; x < mazeCols; x++ {
			if mazeWalls[y][x] {
				grid[y][x] = cellWall
			}
		}
	}
	place := func(list [][2]int, kind int8) {
		for _, p := range list {
			grid[p[1]][p[0]] = kind
		}
	}
	place(scarePellets, cellScare)
	place(swiftPellets, cellSwift)
	place(freezePellets, cellFreeze)
	place(lifePellets, cellLife)
	return grid
}

func NewGameEngine() *GameEngine {
	lm := NewLuaManager()

	// Load scripts; log but don't crash on missing files so the game still runs
	// with fallback Go AI if scripts are absent. Disk copies win so they can be
	// hot-reloaded; otherwise the copy embedded in the binary is used.
	if err := lm.LoadScript("normal", "scripts/ghost_normal.lua"); err != nil {
		println("warning:", err.Error())
	}
	if err := lm.LoadScript("scared", "scripts/ghost_scared.lua"); err != nil {
		println("warning:", err.Error())
	}
	lm.SetPlayerPosition(playerSpawnX, playerSpawnY)

	return &GameEngine{
		updateCh:  make(chan GhostUpdate, 32),
		ghosts:    make(map[string]*Ghost),
		ghostPos:  make(map[string]GhostUpdate),
		ghostCmds: make(map[string]chan<- GhostCommand),
		pacX:      playerSpawnX,
		pacY:      playerSpawnY,
		pellets:   buildPellets(),
		lives:     3,
		lua:       lm,
	}
}

// Startup is called by Wails once the frontend is ready. We capture the
// context (needed for runtime.EventsEmit) and spin up the ghost goroutines
// plus the main loop.
func (e *GameEngine) Startup(ctx context.Context) {
	e.ctx = ctx
	loopCtx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.lua.WatchScripts(loopCtx, "scripts")

	spawns := []struct {
		ID    string
		X, Y  int
		Delay time.Duration
	}{
		{"Spot", 13, 11, 2 * time.Second},
		{"Tracker", 14, 11, 8 * time.Second},
		{"Shadow", 15, 11, 15 * time.Second},
	}
	e.mu.Lock()
	now := time.Now()
	for _, s := range spawns {
		cmdCh := make(chan GhostCommand, 8)
		st := Dormant
		if s.Delay == 0 {
			st = Normal
		}
		g := &Ghost{
			ID:           s.ID,
			X:            s.X,
			Y:            s.Y,
			HomeX:        s.X,
			HomeY:        s.Y,
			State:        st,
			Speed:        normalSpeed,
			releaseAt:    now.Add(s.Delay),
			releaseDelay: s.Delay,
			updateCh:     e.updateCh,
			commandCh:    cmdCh,
			lua:          e.lua,
		}
		e.ghosts[g.ID] = g
		e.ghostCmds[g.ID] = cmdCh
		e.ghostPos[g.ID] = GhostUpdate{ID: g.ID, X: g.X, Y: g.Y, State: st}
		go g.Run(loopCtx)
	}
	e.mu.Unlock()

	e.loopWG.Add(1)
	go e.runLoop(loopCtx)
}

func (e *GameEngine) Shutdown(ctx context.Context) {
	if e.cancel != nil {
		e.cancel()
	}
	e.loopWG.Wait()
	if e.lua != nil {
		e.lua.Close()
	}
}

// runLoop fans ghost updates out to the frontend and checks ghost-player
// collisions after each ghost move.
func (e *GameEngine) runLoop(ctx context.Context) {
	defer e.loopWG.Done()

	for {
		select {
		case <-ctx.Done():
			return

		case update := <-e.updateCh:
			e.emit("ghost:update", update)
			e.checkGhostCollision(update)
		}
	}
}

func (e *GameEngine) emit(event string, data ...interface{}) {
	if e.ctx == nil || e.ctx.Value("events") == nil {
		return
	}
	runtime.EventsEmit(e.ctx, event, data...)
}

// checkGhostCollision is called after every ghost update. Must not hold e.mu
// while calling back into ghost command channels to avoid deadlock.
func (e *GameEngine) checkGhostCollision(update GhostUpdate) {
	e.mu.Lock()
	e.ghostPos[update.ID] = update
	if e.gameOver || e.won || update.X != e.pacX || update.Y != e.pacY {
		e.mu.Unlock()
		return
	}
	eatID := e.applyContactLocked(update)
	state := e.emitState()
	player := PlayerUpdate{X: e.pacX, Y: e.pacY, Dir: e.dir}
	e.mu.Unlock()

	e.emit("player:update", player)
	e.emit("game:state", state)
	if eatID != "" {
		e.sendGhost(eatID, GhostCommand{Type: "eat"})
	}
}

// applyContactLocked resolves one ghost occupying the player's tile.
// Caller must hold e.mu. Returns the id of a ghost that should be eaten.
func (e *GameEngine) applyContactLocked(g GhostUpdate) string {
	switch g.State {
	case Scared:
		e.score += 200
		g.State = Eaten
		e.ghostPos[g.ID] = g
		return g.ID
	case Normal:
		if time.Now().Before(e.invulnUntil) {
			return ""
		}
		e.loseLifeLocked()
		return ""
	default:
		// Dormant crests are still in the pen, and eyes are already eaten.
		return ""
	}
}

// loseLifeLocked decrements lives and handles respawn or game-over.
// Caller must hold e.mu.
func (e *GameEngine) loseLifeLocked() {
	e.lives--
	if e.lives <= 0 {
		e.gameOver = true
		return
	}
	e.pacX, e.pacY = playerSpawnX, playerSpawnY
	e.dir = 0
	e.invulnUntil = time.Now().Add(lifeMercy)
	e.lua.SetPlayerPosition(e.pacX, e.pacY)
}

// emitState snapshots the current score/lives/gameOver for event emission.
// Caller must hold e.mu.
func remainMS(until time.Time) int64 {
	if until.IsZero() {
		return 0
	}
	d := time.Until(until)
	if d <= 0 {
		return 0
	}
	return d.Milliseconds()
}

func (e *GameEngine) emitState() GameState {
	return GameState{
		Score:    e.score,
		Lives:    e.lives,
		GameOver: e.gameOver,
		Won:      e.won,
		Swift:    time.Now().Before(e.swiftUntil),
		Frozen:   time.Now().Before(e.freezeUntil),
		SwiftMS:  remainMS(e.swiftUntil),
		FrozenMS: remainMS(e.freezeUntil),
	}
}

func (e *GameEngine) pelletsLeftLocked() int {
	n := 0
	for y := range e.pellets {
		for x := range e.pellets[y] {
			if e.pellets[y][x] == cellPellet {
				n++
			}
		}
	}
	return n
}

func (e *GameEngine) ghostAtLocked(x, y int) (GhostUpdate, bool) {
	for _, g := range e.ghostPos {
		if g.X == x && g.Y == y {
			return g, true
		}
	}
	return GhostUpdate{}, false
}

func (e *GameEngine) sendGhost(id string, cmd GhostCommand) {
	ch, ok := e.ghostCmds[id]
	if !ok {
		return
	}
	select {
	case ch <- cmd:
	default:
	}
}

func (e *GameEngine) broadcast(cmd GhostCommand) {
	for id := range e.ghostCmds {
		e.sendGhost(id, cmd)
	}
}

// --- Bound methods callable from the frontend ---

// MovePlayer validates the requested direction against the maze, updates the
// player's authoritative position, handles pellet collection, and emits
// player:update + game:state events. dir: "up" "down" "left" "right".
// Returns false if the move is blocked by a wall (frontend can ignore it).
func (e *GameEngine) MovePlayer(dir string) bool {
	e.mu.Lock()

	if e.gameOver || e.won {
		e.mu.Unlock()
		return false
	}

	nx, ny := e.pacX, e.pacY
	facing := e.dir
	switch dir {
	case "up":
		ny--
		facing = 2
	case "down":
		ny++
		facing = 3
	case "left":
		nx--
		facing = 1
	case "right":
		nx++
		facing = 0
	default:
		e.mu.Unlock()
		return false
	}

	if isWall(nx, ny) {
		e.mu.Unlock()
		return false
	}

	e.pacX, e.pacY = nx, ny
	e.dir = facing
	e.lua.SetPlayerPosition(nx, ny)

	var scarePellet bool
	switch e.pellets[ny][nx] {
	case cellPellet:
		e.pellets[ny][nx] = cellEaten
		e.score += 10
	case cellScare:
		e.pellets[ny][nx] = cellEaten
		e.score += 50
		scarePellet = true
	case cellSwift:
		e.pellets[ny][nx] = cellEaten
		e.score += 30
		e.swiftUntil = time.Now().Add(swiftLength)
	case cellFreeze:
		e.pellets[ny][nx] = cellEaten
		e.score += 30
		e.freezeUntil = time.Now().Add(freezeLength)
		freezeUntilNano.Store(e.freezeUntil.UnixNano())
	case cellLife:
		e.pellets[ny][nx] = cellEaten
		e.score += 100
		if e.lives < maxLives {
			e.lives++
		}
	}
	if e.pelletsLeftLocked() == 0 {
		e.won = true
	}

	var eatID string
	if !e.won {
		if g, ok := e.ghostAtLocked(nx, ny); ok {
			eatID = e.applyContactLocked(g)
		}
	}

	stateSnap := e.emitState()
	playerSnap := PlayerUpdate{X: e.pacX, Y: e.pacY, Dir: e.dir}
	pelletSnap := e.copyPelletsLocked()
	e.mu.Unlock()

	e.emit("player:update", playerSnap)
	e.emit("game:state", stateSnap)
	e.emit("pellet:update", pelletSnap)
	if eatID != "" {
		e.sendGhost(eatID, GhostCommand{Type: "eat"})
	}
	if scarePellet && !stateSnap.Won && !stateSnap.GameOver {
		e.scareAll()
	}
	return true
}

// GetState returns the current game state snapshot for initial frontend sync.
func (e *GameEngine) GetState() GameState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.emitState()
}

// GetPlayerPosition returns the current player tile coordinates for initial sync.
func (e *GameEngine) GetPlayerPosition() PlayerUpdate {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return PlayerUpdate{X: e.pacX, Y: e.pacY, Dir: e.dir}
}

// GetPellets returns the full pellet grid for initial frontend sync.
// Values: 0=pellet, 1=wall, 2=eaten, 4=scare, 5=swift, 6=freeze, 7=life.
// GetWallSkin is the tetromino paint for each tile. 0 is open.
func (e *GameEngine) GetWallSkin() [][]int {
	return wallSkin
}

func (e *GameEngine) GetPellets() [][]int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.copyPelletsLocked()
}

// GetGhosts returns the latest ghost tiles for the first paint, before any
// ghost:update event has been delivered.
func (e *GameEngine) GetGhosts() []GhostUpdate {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]GhostUpdate, 0, len(e.ghostPos))
	for _, g := range e.ghostPos {
		out = append(out, g)
	}
	return out
}

// copyPelletsLocked copies the pellet grid as plain ints. A [][]int8 is easy
// for a JSON binding to treat as raw bytes, and then the dots never draw.
// Caller must hold at least a read lock.
func (e *GameEngine) copyPelletsLocked() [][]int {
	out := make([][]int, len(e.pellets))
	for i, row := range e.pellets {
		c := make([]int, len(row))
		for j, v := range row {
			c[j] = int(v)
		}
		out[i] = c
	}
	return out
}

// scareAll turns every crest that is still on the board blue and fleeing.
// Eyes that are already eaten stay eyes.
func (e *GameEngine) scareAll() {
	e.mu.Lock()
	updates := make([]GhostUpdate, 0, len(e.ghostPos))
	for id, g := range e.ghostPos {
		if g.State == Eaten {
			continue
		}
		g.State = Scared
		e.ghostPos[id] = g
		updates = append(updates, g)
	}
	e.mu.Unlock()
	for _, u := range updates {
		e.sendGhost(u.ID, GhostCommand{Type: "scare"})
		e.emit("ghost:update", u)
	}
}

// ResetGhosts returns every ghost to normal state without moving them.
func (e *GameEngine) ResetGhosts() {
	e.broadcast(GhostCommand{Type: "reset"})
}

// Restart deals a fresh maze: pellets, lives, score, and ghost homes.
func (e *GameEngine) Restart() {
	e.mu.Lock()
	e.pacX, e.pacY = playerSpawnX, playerSpawnY
	e.dir = 0
	e.score = 0
	e.lives = 3
	e.gameOver = false
	e.won = false
	e.invulnUntil = time.Time{}
	e.swiftUntil = time.Time{}
	e.freezeUntil = time.Time{}
	freezeUntilNano.Store(0)
	e.pellets = buildPellets()
	e.lua.SetPlayerPosition(e.pacX, e.pacY)
	for id, g := range e.ghostPos {
		g.State = Normal
		if home, ok := e.ghosts[id]; ok {
			g.X, g.Y = home.HomeX, home.HomeY
			if home.releaseDelay > 0 {
				g.State = Dormant
			}
		}
		e.ghostPos[id] = g
	}
	state := e.emitState()
	player := PlayerUpdate{X: e.pacX, Y: e.pacY, Dir: 0}
	pellets := e.copyPelletsLocked()
	e.mu.Unlock()

	e.emit("player:update", player)
	e.emit("game:state", state)
	e.emit("pellet:update", pellets)
	e.broadcast(GhostCommand{Type: "respawn"})
}
