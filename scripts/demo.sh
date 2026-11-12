#!/usr/bin/env bash
# Demo helpers for the presenters. Run from the repository root:
#   ./scripts/demo.sh start   start the "night poacher" scenario (same as the dashboard button)
#   ./scripts/demo.sh reset   delete simulated alerts and clips (map, devices and readings stay)
# Both run inside the running containers, so they use the same secrets and network as the stack.
set -euo pipefail
cd "$(dirname "$0")/.."

dkr() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sg docker -c "$(printf '%q ' docker "$@")"
  fi
}

case "${1:-}" in
  start) dkr compose exec -T simulator node services/simulator/src/cli.ts start night-poacher ;;
  reset) dkr compose run --rm -T migrate node packages/db/src/demo-reset.ts ;;
  *) echo "usage: $0 start|reset" >&2; exit 2 ;;
esac
