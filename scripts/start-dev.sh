#!/usr/bin/env bash
# start-dev.sh
# -------------
# Startet Server + ngrok Tunnel fuer lokale Entwicklung.
# Ausfuehren: chmod +x scripts/start-dev.sh && ./scripts/start-dev.sh
#
# Voraussetzungen:
#   - ngrok installiert: https://ngrok.com/download
#   - ngrok account + authtoken gesetzt: ngrok config add-authtoken TOKEN
#   - .env konfiguriert

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "FEHLER: .env Datei nicht gefunden. Zuerst setup.sh ausfuehren."
  exit 1
fi

# ngrok pruefen
if ! command -v ngrok &>/dev/null; then
  echo "FEHLER: ngrok nicht gefunden."
  echo "  Installation: https://ngrok.com/download"
  echo "  Nach Installation: ngrok config add-authtoken DEIN_TOKEN"
  exit 1
fi

PORT="${PORT:-3001}"

echo "================================================="
echo "TalentFlow Voice Agent – Dev Environment"
echo "================================================="
echo ""

# ngrok im Hintergrund starten
echo "Starte ngrok Tunnel auf Port $PORT..."
ngrok http "$PORT" --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Kurz warten bis ngrok URL verfuegbar ist
sleep 2

# ngrok Public URL aus API holen
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "
import json, sys
data = json.load(sys.stdin)
tunnels = data.get('tunnels', [])
for t in tunnels:
    if t.get('proto') == 'https':
        print(t['public_url'])
        break
" 2>/dev/null)

if [ -z "$NGROK_URL" ]; then
  echo "WARNUNG: ngrok URL konnte nicht automatisch ermittelt werden."
  echo "  Oeffne http://localhost:4040 im Browser und kopiere die HTTPS-URL manuell."
  echo "  Dann: WEBHOOK_URL=https://XXXX.ngrok.io in .env eintragen"
else
  echo "ngrok URL: $NGROK_URL"
  echo ""
  echo "Eintragen in .env:"
  echo "  WEBHOOK_URL=$NGROK_URL"
  echo ""
  echo "Dann Vapi Assistant updaten:"
  echo "  node scripts/create-assistant.js"
fi

echo ""
echo "Server starten (neues Terminal):"
echo "  cd server && npm run dev"
echo ""
echo "ngrok Dashboard: http://localhost:4040"
echo ""

# Auf Enter warten
read -r -p "Enter druecken zum Beenden des ngrok Tunnels..."
kill $NGROK_PID 2>/dev/null
echo "ngrok beendet."
