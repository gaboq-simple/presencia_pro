#!/bin/bash
# Igual que start-lifestyle.sh pero con TZ=UTC — simula Vercel/prod (UTC) para
# exponer bugs de timezone que se esconden en la TZ local de la máquina (México).
# Convención de verificación del proyecto: sin TZ=UTC, no probaste nada.
export TZ=UTC
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec /bin/bash "$SCRIPT_DIR/start-lifestyle.sh"
