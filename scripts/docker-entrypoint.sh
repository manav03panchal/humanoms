#!/bin/sh
set -e

# Docker creates bind-mount parent directories as root.
# The Claude Code SDK needs to write $HOME/.claude.lock for token refresh,
# so ensure $HOME exists and is owned by the current user.
mkdir -p "$HOME" 2>/dev/null || true

exec "$@"
