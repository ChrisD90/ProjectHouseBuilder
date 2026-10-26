#!/bin/sh
# Called before pip/migrations. Installs system dependencies only when OCR is missing.
set -eu
cd "$(dirname "$0")/.."
PHB_PYTHON="${PHB_PYTHON:-python3}"

if "$PHB_PYTHON" ocr_runtime.py --check --quiet; then
  exec "$PHB_PYTHON" ocr_runtime.py --check
fi

case "$(uname -s)" in
  Darwin)
    if [ "$(uname -m)" = x86_64 ]; then
      # The current Homebrew installer no longer supports Intel macOS.
      "$PHB_PYTHON" scripts/setup_intel_ocr.py
      exec "$PHB_PYTHON" ocr_runtime.py --check
    fi
    # Terminal, Finder and VS Code can inherit different PATHs on Apple Silicon/Intel.
    PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
    export PATH
    if ! command -v brew >/dev/null 2>&1; then
      echo 'Homebrew wird für die lokale OCR eingerichtet. macOS kann Administratorrechte und Command Line Tools anfordern.'
      installer=$(mktemp -t phb-homebrew.XXXXXX)
      trap 'rm -f "$installer"' EXIT HUP INT TERM
      curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
        https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
      /bin/bash "$installer"
      rm -f "$installer"
      trap - EXIT HUP INT TERM
    fi
    if ! command -v brew >/dev/null 2>&1; then
      echo 'Homebrew konnte nicht eingerichtet werden. https://brew.sh öffnen und danach den App-Start wiederholen.' >&2
      exit 1
    fi
    echo 'OCR-Pakete gemäß Brewfile einrichten: Tesseract, Sprachdaten und Poppler …'
    HOMEBREW_NO_AUTO_UPDATE=1 brew bundle install --no-upgrade --file=Brewfile
    ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      if [ "$(id -u)" = 0 ]; then
        apt-get update
        apt-get install -y tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils
      else
        sudo apt-get update
        sudo apt-get install -y tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils
      fi
    else
      echo 'Bitte Tesseract, die Sprachen deu+eng und Poppler mit dem Paketmanager installieren, oder sh dev/start.sh verwenden.' >&2
      exit 1
    fi
    ;;
  *)
    echo 'Für diese Plattform bitte den Docker-Start verwenden: siehe dev/README.md.' >&2
    exit 1
    ;;
esac

# A failed install or missing language must never silently start an OCR-less app.
exec "$PHB_PYTHON" ocr_runtime.py --check
