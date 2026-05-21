#!/bin/bash
# Inicia el servidor Next.js de lifestyle en $PORT.
# Si ya existe un proceso `next dev` corriendo en $PORT, levanta un proxy de health
# para no duplicar instancias. Detecta next dev por proceso, no por puerto genérico.
NODE="/Users/GaboQ/.nvm/versions/node/v20.20.1/bin/node"
export PATH="/Users/GaboQ/.nvm/versions/node/v20.20.1/bin:$PATH"
TARGET_PORT="${PORT:-3002}"

# Detectar si hay un proceso `next dev` ya escuchando en TARGET_PORT
if lsof -ti :"$TARGET_PORT" | xargs -r ps -p 2>/dev/null | grep -q "next"; then
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
