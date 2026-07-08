#!/bin/sh
# ChatWave Docker entrypoint
# Generates config.js at runtime with the correct socket URL
set -e

SOCKET_SERVER_URL="${SOCKET_SERVER_URL:-}"

cat > /app/public/js/config.js << EOF
window.CONFIG = {
  SOCKET_URL: '$SOCKET_SERVER_URL'
};
EOF

echo "Starting ChatWave server..."
exec node server.js
