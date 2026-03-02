#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# B2B Voice Agent – TalentFlow | Setup Script
# Führe dieses Script im Root-Verzeichnis des Projekts aus:
#   chmod +x setup.sh && ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Abbruch bei Fehler

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════╗"
echo "║   B2B Voice Agent – TalentFlow   Setup Script      ║"
echo "╚════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Voraussetzungen prüfen ──────────────────────────────────────────────────
echo -e "${YELLOW}[1/6] Prüfe Voraussetzungen...${NC}"

check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}✗ $1 nicht gefunden. Bitte installieren: $2${NC}"
    exit 1
  else
    echo -e "${GREEN}✓ $1 gefunden: $(command -v $1)${NC}"
  fi
}

check_command "node"   "https://nodejs.org (v20+)"
check_command "npm"    "https://nodejs.org (mit Node.js)"
check_command "python3" "https://python.org (v3.11+)"
check_command "pip3"   "pip3 install --upgrade pip"

# Node-Version prüfen
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}✗ Node.js v20+ erforderlich. Aktuell: $(node -v)${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js Version OK: $(node -v)${NC}"

# Python-Version prüfen
PYTHON_VERSION=$(python3 -c "import sys; print(sys.version_info.minor)")
if [ "$PYTHON_VERSION" -lt 11 ]; then
  echo -e "${RED}✗ Python 3.11+ erforderlich${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Python Version OK: $(python3 --version)${NC}"

# ── .env Setup ──────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/6] Environment-Datei einrichten...${NC}"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "${GREEN}✓ .env aus .env.example erstellt${NC}"
  echo -e "${YELLOW}  ⚠ Bitte .env mit deinen API-Keys befüllen!${NC}"
else
  echo -e "${GREEN}✓ .env bereits vorhanden${NC}"
fi

# ── Python venv + Gradio Requirements ───────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/6] Python Virtual Environment & Gradio Requirements...${NC}"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo -e "${GREEN}✓ Virtual Environment erstellt${NC}"
fi

source venv/bin/activate

pip install --upgrade pip -q
pip install -r gradio/requirements.txt

echo -e "${GREEN}✓ Python Requirements installiert${NC}"
deactivate

# ── Node.js Server Dependencies ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/6] Node.js Server Dependencies...${NC}"

cd server
npm install
cd ..
echo -e "${GREEN}✓ Server Dependencies installiert${NC}"

# ── Next.js Dashboard Dependencies ──────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5/6] Next.js Dashboard Dependencies...${NC}"

cd dashboard
npm install
cd ..
echo -e "${GREEN}✓ Dashboard Dependencies installiert${NC}"

# ── Verzeichnisstruktur sicherstellen ───────────────────────────────────────
echo ""
echo -e "${YELLOW}[6/6] Verzeichnisse & Daten prüfen...${NC}"

mkdir -p recordings logs gradio/data gradio/models

echo -e "${GREEN}✓ Verzeichnisse OK${NC}"

# ── Abschluss ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅  Setup erfolgreich abgeschlossen!              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Nächste Schritte:"
echo -e "  1. ${YELLOW}.env${NC} mit API-Keys befüllen (Vapi, Anthropic, Supabase, etc.)"
echo -e "  2. ${YELLOW}Supabase Migrations ausführen:${NC}"
echo -e "     supabase db push  (oder manuell in Supabase Dashboard)"
echo -e "  3. ${YELLOW}Server starten:${NC}"
echo -e "     cd server && npm run dev"
echo -e "  4. ${YELLOW}Dashboard starten:${NC}"
echo -e "     cd dashboard && npm run dev"
echo -e "  5. ${YELLOW}Gradio Testinterface starten:${NC}"
echo -e "     source venv/bin/activate && python gradio/app.py"
echo ""
echo -e "  📄 Vollständige Dokumentation: ${YELLOW}README.md${NC}"
echo ""
