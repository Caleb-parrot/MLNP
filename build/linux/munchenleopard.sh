#!/bin/bash
# Native WebKit window. Compositing mode blanks WebKit on this Hyprland session.
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
exec "$HOME/.local/lib/munchenleopard/munchenleopard"
