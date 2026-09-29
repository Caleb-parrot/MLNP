# MunchenLeopard

A maze-chase game. The leopard clears a heraldic maze while three crests
(Spot, Tracker, and Shadow) hunt it. They leave the pen one at a time, and
they are slower than the leopard. A gold pellet turns every crest blue and
sends them running; the leopard becomes the Münchner Kindl and can eat them.
A green diamond is a burst of speed, a blue square freezes the crests, and a
pink dot is an extra life.
Eyes run home and sit out before hunting again. Clear the maze, or lose the
last life.

Built with [Wails](https://wails.io/). The maze is drawn on a canvas.
Ghost brains live in `scripts/*.lua` and hot-reload while a `scripts/`
directory is next to the working copy. The binary also embeds those scripts,
so a menu launch does not need them on disk.

## Play on Omarchy

Arrows or WASD move. A gamepad d-pad or left stick does the same. R restarts.
After a win or a loss, Start on the pad restarts too.

The installed launcher is `munchenleopard` (Super+Space: Munchen Leopard).
Rebuild and reinstall with:

```
./build.sh
./build/linux/install-omarchy.sh
```

`build.sh` needs Go, Node, GTK 3, and webkit2gtk 4.1. The Linux build tags are `production` and `webkit2_41`.

## Development

```
wails dev -tags webkit2_41
```

## License

Copyright (c) 2026 Caleb-parrot. All rights reserved. See [LICENSE](LICENSE).
