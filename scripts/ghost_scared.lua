-- ghost_scared.lua
-- Flee through open corridors, away from the player.
-- Returns one of: "up", "down", "left", "right", "none"

function think(ghost_id, gx, gy, state, dt)
    local px, py = get_player_position()
    local dx = gx - px
    local dy = gy - py
    local cands = {}

    local function add(dir, nx, ny, score)
        if not is_wall(nx, ny) then
            cands[#cands + 1] = { dir = dir, score = score }
        end
    end

    add("right", gx + 1, gy, dx)
    add("left", gx - 1, gy, -dx)
    add("down", gx, gy + 1, dy)
    add("up", gx, gy - 1, -dy)

    local pick = nil
    for _, c in ipairs(cands) do
        if not pick or c.score > pick.score then
            pick = c
        end
    end
    if pick then
        return pick.dir
    end
    return "none"
end
