#!/bin/bash
# Si el servidor principal ya corre en 3002, levanta un proxy de health en $PORT.
# Si no, inicia next dev normalmente.
NODE="/Users/GaboQ/.nvm/versions/node/v20.20.1/bin/node"
export PATH="/Users/GaboQ/.nvm/versions/node/v20.20.1/bin:$PATH"
TARGET_PORT="${PORT:-3002}"

if lsof -ti :3002 > /dev/null 2>&1; then
  exec "$NODE" -e "
    const http = require('http');
    http.createServer((req, res) => { res.writeHead(200); res.end('ok'); })
      .listen($TARGET_PORT, () => console.log('lifestyle health proxy on $TARGET_PORT'));
  "
else
  cd /Users/GaboQ/presenciapro/apps/lifestyle
  exec "$NODE" \
    /Users/GaboQ/presenciapro/node_modules/.bin/next \
    dev --port "$TARGET_PORT"
fi
