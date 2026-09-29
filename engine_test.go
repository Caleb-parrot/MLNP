package main

import (
	"context"
	"testing"
	"time"
)

func newTestEngine() *GameEngine {
	e := NewGameEngine()
	e.ctx = context.Background()
	return e
}

func TestCorridorsConnect(t *testing.T) {
	if isWall(playerSpawnX, playerSpawnY) {
		t.Fatal("spawn is a wall")
	}
	for _, h := range [][2]int{{13, 11}, {14, 11}, {15, 11}} {
		if isWall(h[0], h[1]) {
			t.Fatalf("crest home is a wall at %d,%d", h[0], h[1])
		}
	}
	seen := map[[2]int]bool{{playerSpawnX, playerSpawnY}: true}
	q := [][2]int{{playerSpawnX, playerSpawnY}}
	for len(q) > 0 {
		p := q[0]
		q = q[1:]
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			n := [2]int{p[0] + d[0], p[1] + d[1]}
			if seen[n] || isWall(n[0], n[1]) {
				continue
			}
			seen[n] = true
			q = append(q, n)
		}
	}
	for y := 0; y < mazeRows; y++ {
		for x := 0; x < mazeCols; x++ {
			if !isWall(x, y) && !seen[[2]int{x, y}] {
				t.Fatalf("unreachable open tile %d,%d", x, y)
			}
		}
	}
}

func TestMoveIntoWallStaysPut(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 1, 1
	if e.MovePlayer("left") {
		t.Fatal("moved into the border")
	}
	if e.pacX != 1 || e.pacY != 1 {
		t.Fatalf("position %d,%d", e.pacX, e.pacY)
	}
}

func TestPelletAndPowerPellet(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 1, 1
	if !e.MovePlayer("right") {
		t.Fatal("blocked")
	}
	if e.score != 10 || e.pellets[1][2] != 2 {
		t.Fatalf("score %d cell %d", e.score, e.pellets[1][2])
	}

	e.pacX, e.pacY = 1, 1
	if !e.MovePlayer("down") {
		t.Fatal("blocked on the way to a power pellet")
	}
	if e.pellets[2][1] != cellEaten || e.score != 60 {
		t.Fatalf("power score %d cell %d", e.score, e.pellets[2][1])
	}
	if !e.emitState().Swift && e.ghostPos["Spot"].State != Scared && len(e.ghostPos) > 0 {
		t.Fatal("scare did not register")
	}
}

func TestPowerUpsSitOnOpenTiles(t *testing.T) {
	seen := map[[2]int]bool{}
	all := append([][2]int{}, scarePellets...)
	all = append(all, swiftPellets...)
	all = append(all, freezePellets...)
	all = append(all, lifePellets...)
	for _, p := range all {
		if isWall(p[0], p[1]) {
			t.Fatalf("pickup on a wall at %d,%d", p[0], p[1])
		}
		if seen[p] {
			t.Fatalf("two pickups on %d,%d", p[0], p[1])
		}
		seen[p] = true
		if p[0] == playerSpawnX && p[1] == playerSpawnY {
			t.Fatalf("pickup on the leopard spawn")
		}
	}
}

func TestSwiftFreezeAndLife(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 1, 5
	if !e.MovePlayer("down") {
		t.Fatal("swift tile blocked")
	}
	if !e.emitState().Swift {
		t.Fatal("expected swift")
	}

	e.pacX, e.pacY = 8, 10
	if !e.MovePlayer("down") {
		t.Fatal("freeze tile blocked")
	}
	t.Cleanup(func() { freezeUntilNano.Store(0) })
	if !e.emitState().Frozen || !frozenNow() {
		t.Fatal("expected freeze")
	}

	e.pacX, e.pacY = 14, 1
	before := e.lives
	if !e.MovePlayer("down") {
		t.Fatal("life tile blocked")
	}
	if e.lives != before+1 {
		t.Fatalf("lives %d", e.lives)
	}
}

func TestSecondSwiftExtends(t *testing.T) {
	e := newTestEngine()
	e.swiftUntil = time.Now().Add(time.Second)
	before := e.swiftUntil
	e.pacX, e.pacY = 1, 5
	if !e.MovePlayer("down") {
		t.Fatal("swift tile blocked")
	}
	if !e.swiftUntil.After(before.Add(3 * time.Second)) {
		t.Fatal("second swift did not extend the burst")
	}
	if e.emitState().SwiftMS < 3000 {
		t.Fatalf("SwiftMS %d", e.emitState().SwiftMS)
	}
}

func TestFreezeSkipsGhostMove(t *testing.T) {
	freezeUntilNano.Store(time.Now().Add(time.Second).UnixNano())
	t.Cleanup(func() { freezeUntilNano.Store(0) })
	g := &Ghost{X: 14, Y: 23, HomeX: 14, HomeY: 11, State: Normal, Speed: normalSpeed}
	g.move()
	if g.X != 14 || g.Y != 23 {
		t.Fatalf("moved while frozen to %d,%d", g.X, g.Y)
	}
}

func TestWalkingIntoAGhostCostsALife(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 14, 23
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 15, Y: 23, State: Normal}
	if !e.MovePlayer("right") {
		t.Fatal("blocked")
	}
	if e.lives != 2 {
		t.Fatalf("lives %d", e.lives)
	}
	if e.pacX != playerSpawnX || e.pacY != playerSpawnY {
		t.Fatalf("respawn %d,%d", e.pacX, e.pacY)
	}
}

func TestScaredGhostIsEaten(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 14, 23
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 15, Y: 23, State: Scared}
	if !e.MovePlayer("right") {
		t.Fatal("blocked")
	}
	if e.lives != 3 {
		t.Fatalf("lives %d", e.lives)
	}
	if e.score != 210 { // pellet 10 + eat 200
		t.Fatalf("score %d", e.score)
	}
	if e.pacX != 15 || e.pacY != 23 {
		t.Fatalf("should stay on the eaten tile, at %d,%d", e.pacX, e.pacY)
	}
	if e.ghostPos["Spot"].State != Eaten {
		t.Fatalf("state %d", e.ghostPos["Spot"].State)
	}
}

func TestMercyIgnoresTheNextHit(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 14, 23
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 15, Y: 23, State: Normal}
	e.MovePlayer("right")
	if e.lives != 2 {
		t.Fatalf("lives %d", e.lives)
	}
	// The next tile is occupied, and the mercy window from the death is still open.
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 13, Y: 23, State: Normal}
	e.MovePlayer("left")
	if e.lives != 2 {
		t.Fatalf("mercy should hold, lives %d", e.lives)
	}
}

func TestClearingTheMazeWins(t *testing.T) {
	e := newTestEngine()
	for y := range e.pellets {
		for x := range e.pellets[y] {
			if e.pellets[y][x] == 0 {
				e.pellets[y][x] = 2
			}
		}
	}
	e.pellets[23][15] = 0
	e.pacX, e.pacY = 14, 23
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 15, Y: 23, State: Normal}
	if !e.MovePlayer("right") {
		t.Fatal("blocked")
	}
	if !e.won || e.gameOver || e.lives != 3 {
		t.Fatalf("won %v over %v lives %d", e.won, e.gameOver, e.lives)
	}
}

func TestRestartDealsAFreshMaze(t *testing.T) {
	e := newTestEngine()
	e.score = 400
	e.lives = 1
	e.gameOver = true
	e.won = true
	e.Restart()
	if e.score != 0 || e.lives != 3 || e.gameOver || e.won {
		t.Fatalf("state %+v", e.emitState())
	}
	if e.pacX != playerSpawnX || e.pacY != playerSpawnY {
		t.Fatalf("pos %d,%d", e.pacX, e.pacY)
	}
	if e.pelletsLeftLocked() == 0 {
		t.Fatal("no pellets after restart")
	}
}

func TestSpotChasesRight(t *testing.T) {
	e := newTestEngine()
	dir, ok := e.lua.RunThink("normal", "Spot", 10, 23, 0, 0)
	if !ok || dir != "right" {
		t.Fatalf("ok %v dir %q", ok, dir)
	}
}

func TestEyesPathHome(t *testing.T) {
	g := &Ghost{X: 14, Y: 23, HomeX: 14, HomeY: 11, State: Eaten, Speed: eatenSpeed}
	for i := 0; i < 80 && !(g.X == g.HomeX && g.Y == g.HomeY); i++ {
		g.moveEaten()
	}
	if g.X != 14 || g.Y != 11 {
		t.Fatalf("stuck at %d,%d", g.X, g.Y)
	}
}

func TestDormantCrestIsHarmless(t *testing.T) {
	e := newTestEngine()
	e.pacX, e.pacY = 14, 23
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 15, Y: 23, State: Dormant}
	if !e.MovePlayer("right") {
		t.Fatal("blocked")
	}
	if e.lives != 3 || e.pacX != 15 {
		t.Fatalf("lives %d pos %d,%d", e.lives, e.pacX, e.pacY)
	}
}

func TestGoldPelletScaresEveryCrest(t *testing.T) {
	e := newTestEngine()
	e.ghostPos["Spot"] = GhostUpdate{ID: "Spot", X: 13, Y: 11, State: Dormant}
	e.ghostPos["Tracker"] = GhostUpdate{ID: "Tracker", X: 14, Y: 11, State: Normal}
	e.ghostPos["Shadow"] = GhostUpdate{ID: "Shadow", X: 15, Y: 11, State: Eaten}
	e.pacX, e.pacY = 1, 1
	if !e.MovePlayer("down") {
		t.Fatal("blocked")
	}
	if e.ghostPos["Spot"].State != Scared || e.ghostPos["Tracker"].State != Scared {
		t.Fatalf("spot %d tracker %d", e.ghostPos["Spot"].State, e.ghostPos["Tracker"].State)
	}
	if e.ghostPos["Shadow"].State != Eaten {
		t.Fatalf("eyes should stay eaten, got %d", e.ghostPos["Shadow"].State)
	}
	if e.score < 50 {
		t.Fatalf("score %d", e.score)
	}
}

func TestScaredScriptFlees(t *testing.T) {
	e := newTestEngine()
	e.lua.SetPlayerPosition(14, 23)
	dir, ok := e.lua.RunThink("scared", "Spot", 10, 23, 1, 0)
	if !ok || dir != "left" {
		t.Fatalf("ok %v dir %q", ok, dir)
	}
}

func TestEscapeWall(t *testing.T) {
	g := &Ghost{X: 0, Y: 0, State: Normal}
	g.escapeWall()
	if isWall(g.X, g.Y) {
		t.Fatalf("still walled at %d,%d", g.X, g.Y)
	}
}
