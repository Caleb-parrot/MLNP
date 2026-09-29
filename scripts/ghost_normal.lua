-- ghost_normal.lua
-- Chase through corridors. Spot hunts the player directly, Tracker aims
-- a few tiles past them, Shadow wanders unless the player is close.
-- Returns one of: "up", "down", "left", "right", "none"

local function consider(list, dir, nx, ny, score)
    if not is_wall(nx, ny) then
        list[#list + 1] = { dir = dir, score = score }
    end
end

local function best(list)
    local pick = nil
    for _, c in ipairs(list) do
        if not pick or c.score > pick.score then
            pick = c
        end
    end
    if pick then
        return pick.dir
    end
    return "none"
end

function think(ghost_id, gx, gy, state, dt)
    local px, py = get_player_position()
    local dx = px - gx
    local dy = py - gy
    local cands = {}

    if ghost_id == "Shadow" then
        local near = math.abs(dx) + math.abs(dy) <= 6
        if not near and math.random() < 0.65 then
            local wander = {
                { "right", gx + 1, gy },
                { "left", gx - 1, gy },
                { "down", gx, gy + 1 },
                { "up", gx, gy - 1 },
            }
            local open = {}
            for _, w in ipairs(wander) do
                if not is_wall(w[2], w[3]) then
                    open[#open + 1] = w[1]
                end
            end
            if #open > 0 then
                return open[math.random(#open)]
            end
        end
    end

    local tx, ty = px, py
    if ghost_id == "Tracker" then
        if math.abs(dx) >= math.abs(dy) then
            if dx >= 0 then tx = px + 4 else tx = px - 4 end
        else
            if dy >= 0 then ty = py + 4 else ty = py - 4 end
        end
    end

    local tdx = tx - gx
    local tdy = ty - gy
    consider(cands, "right", gx + 1, gy, tdx)
    consider(cands, "left", gx - 1, gy, -tdx)
    consider(cands, "down", gx, gy + 1, tdy)
    consider(cands, "up", gx, gy - 1, -tdy)
    return best(cands)
end
