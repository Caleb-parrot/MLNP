#!/bin/bash
# Native Linux build for Omarchy / Arch (webkit2gtk 4.1).
set -euo pipefail
cd "$(dirname "$0")"
(cd frontend && npm ci && npm run build)
CGO_ENABLED=1 go build -tags "production webkit2_41" -o build/bin/munchenleopard .
echo "built build/bin/munchenleopard"
