package main

import (
	"context"
	"math/rand"
	"time"
)

const (
	// The leopard steps every 150ms. Crests are slower so a straight corridor
	// is an escape, and a scared crest is slow enough to catch.
	normalSpeed = 300 * time.Millisecond
	scaredSpeed = 460 * time.Millisecond
	eatenSpeed  = 110 * time.Millisecond
	scareLength = 8 * time.Second
	eyePause    = 2 * time.Second
	homeRest    = 4 * time.Second
)

// Ghost represents one ghost.
type Ghost struct {
	ID    string
	X, Y  int
	HomeX int
	HomeY int
	Dir   Direction
	State GhostState
	Speed time.Duration

	scaredUntil  time.Time
	respawnAt    time.Time
	releaseAt    time.Time
	releaseDelay time.Duration

	updateCh  chan<- GhostUpdate  // Send position/state to game
	commandCh <-chan GhostCommand // Receive commands from game

	lua *LuaManager // may be nil; falls back to built-in AI
}

// Direction and State enums
type Direction int

const (
	Up Direction = iota
	Down
	Left
	Right
)

type GhostState int

const (
	Normal GhostState = iota
	Scared
	Eaten
	Dormant // waiting in the pen; visible, but harmless and not hunting
)

// Messages passed via channels
type GhostUpdate struct {
	ID    string
	X, Y  int
	State GhostState
	Dir   Direction
}

type GhostCommand struct {
	Type string // "scare", "reset", "respawn", "eat"
}

// Run starts the ghost's independent goroutine. It exits when ctx is cancelled.
func (g *Ghost) Run(ctx context.Context) {
	if g.Speed <= 0 {
		g.Speed = normalSpeed
	}
	ticker := time.NewTicker(g.Speed)
	defer ticker.Stop()

	apply := func(cmd GhostCommand) {
		prev := g.Speed
		g.handleCommand(cmd)
		if g.Speed != prev {
			ticker.Reset(g.Speed)
		}
		g.publish()
	}

	for {
		// A queued scare or eat lands before the next step, so a gold pellet
		// changes the crest on this tick instead of one chase later.
		select {
		case <-ctx.Done():
			return
		case cmd := <-g.commandCh:
			apply(cmd)
			continue
		default:
		}

		select {
		case <-ctx.Done():
			return
		case cmd := <-g.commandCh:
			apply(cmd)
		case <-ticker.C:
			prev := g.Speed
			g.move()
			if g.Speed != prev {
				ticker.Reset(g.Speed)
			}
			g.publish()
		}
	}
}

func (g *Ghost) publish() {
	if g.updateCh == nil {
		return
	}
	select {
	case g.updateCh <- GhostUpdate{
		ID:    g.ID,
		X:     g.X,
		Y:     g.Y,
		State: g.State,
		Dir:   g.Dir,
	}:
	default:
	}
}

func (g *Ghost) move() {
	if frozenNow() {
		return
	}
	if g.State == Scared && !g.scaredUntil.IsZero() && time.Now().After(g.scaredUntil) {
		g.scaredUntil = time.Time{}
		g.Speed = normalSpeed
		g.State = Normal
		if isWall(g.X, g.Y) {
			g.escapeWall()
		}
	}

	if g.State == Normal || g.State == Dormant {
		if time.Now().Before(g.releaseAt) {
			g.State = Dormant
			return
		}
		if g.State == Dormant {
			g.State = Normal
		}
	}

	switch g.State {
	case Eaten:
		g.moveEaten()
	case Scared:
		if !g.luaMove("scared") {
			g.randomMove()
		}
	case Normal:
		if isWall(g.X, g.Y) {
			g.escapeWall()
			return
		}
		if !g.luaMove("normal") {
			g.chaseMove()
		}
	default:
		g.randomMove()
	}
}

// moveEaten walks the eyes back to the ghost's home tile, waits, then
// returns the ghost to the chase.
func (g *Ghost) moveEaten() {
	if isWall(g.X, g.Y) {
		g.escapeWall()
	}
	if g.X == g.HomeX && g.Y == g.HomeY {
		if g.respawnAt.IsZero() {
			g.respawnAt = time.Now().Add(eyePause)
		}
		if time.Now().Before(g.respawnAt) {
			return
		}
		g.State = Dormant
		g.Speed = normalSpeed
		g.respawnAt = time.Time{}
		g.scaredUntil = time.Time{}
		g.releaseAt = time.Now().Add(homeRest)
		return
	}
	if !g.stepToward(g.HomeX, g.HomeY) {
		g.randomMove()
	}
}

// canEnter is true when (x, y) is an open maze tile. Scared crests flee
// through the corridors, so a gold pellet leaves something you can chase.
func (g *Ghost) canEnter(x, y int) bool {
	return !isWall(x, y)
}

// luaMove asks the Lua script for a direction and applies it if the tile is
// reachable. Returns true if Lua handled the move, false to fall back to Go AI.
func (g *Ghost) luaMove(scriptKey string) bool {
	if g.lua == nil {
		return false
	}
	dir, ok := g.lua.RunThink(scriptKey, g.ID, g.X, g.Y, int(g.State), 0)
	if !ok {
		return false
	}
	nx, ny := g.X, g.Y
	switch dir {
	case "up":
		ny--
	case "down":
		ny++
	case "left":
		nx--
	case "right":
		nx++
	default:
		return true // "none" or unknown: Lua handled it, ghost just stays put
	}
	if g.canEnter(nx, ny) {
		g.X, g.Y = nx, ny
		switch dir {
		case "up":
			g.Dir = Up
		case "down":
			g.Dir = Down
		case "left":
			g.Dir = Left
		case "right":
			g.Dir = Right
		}
		return true
	}
	// Lua picked a walled tile — let Go's chase / random fallback handle it.
	return false
}

func (g *Ghost) chaseMove() {
	tx, ty := 14, 11
	if g.lua != nil {
		tx, ty = g.lua.PlayerPosition()
	}
	if !g.stepToward(tx, ty) {
		g.randomMove()
	}
}

// stepToward takes one step along a shortest open path. Scared ghosts may
// cut through walls because canEnter allows it; everyone else walks corridors.
func (g *Ghost) stepToward(tx, ty int) bool {
	nx, ny, ok := nextOpenStep(g.X, g.Y, tx, ty, g.canEnter)
	if !ok || (nx == g.X && ny == g.Y) {
		return false
	}
	switch {
	case nx > g.X:
		g.Dir = Right
	case nx < g.X:
		g.Dir = Left
	case ny > g.Y:
		g.Dir = Down
	case ny < g.Y:
		g.Dir = Up
	}
	g.X, g.Y = nx, ny
	return true
}

// escapeWall jumps a ghost that is sitting inside a wall (after a scared
// no-clip expires, or after being eaten there) to the nearest open tile.
func (g *Ghost) escapeWall() {
	if !isWall(g.X, g.Y) {
		return
	}
	for r := 1; r < mazeCols+mazeRows; r++ {
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				if absInt(dx) != r && absInt(dy) != r {
					continue
				}
				x, y := g.X+dx, g.Y+dy
				if !isWall(x, y) {
					g.X, g.Y = x, y
					return
				}
			}
		}
	}
}

func frozenNow() bool {
	until := freezeUntilNano.Load()
	return until > 0 && time.Now().UnixNano() < until
}

func absInt(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// randomMove tries up to four random directions before giving up for this
// tick, so a ghost cornered against walls doesn't freeze the moment its first
// pick happens to be blocked.
func (g *Ghost) randomMove() {
	order := []int{0, 1, 2, 3}
	rand.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
	for _, d := range order {
		nx, ny := g.X, g.Y
		dir := Up
		switch d {
		case 0:
			ny--
			dir = Up
		case 1:
			ny++
			dir = Down
		case 2:
			nx--
			dir = Left
		case 3:
			nx++
			dir = Right
		}
		if g.canEnter(nx, ny) {
			g.X, g.Y = nx, ny
			g.Dir = dir
			return
		}
	}
}

func (g *Ghost) handleCommand(cmd GhostCommand) {
	switch cmd.Type {
	case "scare":
		if g.State == Eaten {
			return
		}
		g.State = Scared
		g.Speed = scaredSpeed
		g.scaredUntil = time.Now().Add(scareLength)
		g.respawnAt = time.Time{}
	case "reset":
		g.State = Normal
		g.Speed = normalSpeed
		g.scaredUntil = time.Time{}
		g.respawnAt = time.Time{}
	case "respawn":
		g.State = Dormant
		if g.releaseDelay == 0 {
			g.State = Normal
		}
		g.Speed = normalSpeed
		g.scaredUntil = time.Time{}
		g.respawnAt = time.Time{}
		g.X, g.Y = g.HomeX, g.HomeY
		g.releaseAt = time.Now().Add(g.releaseDelay)
	case "eat":
		if g.State != Scared {
			return
		}
		g.State = Eaten
		g.Speed = eatenSpeed
		g.scaredUntil = time.Time{}
		g.respawnAt = time.Time{}
		if isWall(g.X, g.Y) {
			g.escapeWall()
		}
	}
}
