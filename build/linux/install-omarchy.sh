#!/bin/bash
# Install the native binary, launcher, icon, and Super+Space desktop entry.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bin="$root/build/bin/munchenleopard"
if [[ ! -x "$bin" ]]; then
	echo "missing $bin — run ./build.sh first" >&2
	exit 1
fi
mkdir -p "$HOME/.local/lib/munchenleopard" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons"
install -m 755 "$bin" "$HOME/.local/lib/munchenleopard/munchenleopard"
install -m 755 "$root/build/linux/munchenleopard.sh" "$HOME/.local/bin/munchenleopard"
install -m 644 "$root/build/linux/munchenleopard.desktop" "$HOME/.local/share/applications/munchenleopard.desktop"
# Leopard crest, not the stock Wails mark.
install -m 644 "$root/frontend/src/assets/sprites/player1.png" "$HOME/.local/share/icons/munchenleopard.png"
if command -v update-desktop-database >/dev/null; then
	update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi
echo "installed ~/.local/bin/munchenleopard"
