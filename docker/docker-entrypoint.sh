#!/bin/sh
set -eu
: "${CONVERSATION_PASSWORD:?Set CONVERSATION_PASSWORD before exposing the container listener}"
exec node server.js --host 0.0.0.0 --dataRoot /data --allowed-host "${CONVERSATION_HOST:-localhost}" "$@"
