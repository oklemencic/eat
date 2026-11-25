#!/usr/bin/env bash
# Sicherung von Datenbank und Fotos auf dem Host. Aufruf (im Projektordner oder per Pfad), z. B. täglich per cron:
#
#   scripts/backup.sh
#
# Ablauf: Schnappschuss der Datenbank im Container (scripts/backup.js) -> Archiv aus Schnappschuss und data/photos
# -> Archive älter als BACKUP_DAYS Tage löschen.
#
# Umgebungsvariablen (alle optional):
#   BACKUP_DIR   Zielordner      (Standard: $HOME/backups/eat; enthält persönliche Daten, wird mit Rechten 700 angelegt)
#   BACKUP_DAYS  Aufbewahrung    (Standard: 30)
#   CONTAINER    Containername   (Standard: eat)
#
# Wiederherstellen (Container zuerst stoppen: docker stop eat):
#   tar xzf <Archiv> -C /tmp/eat-restore
#   cp /tmp/eat-restore/backups/eat-*.db data/eat.db      # und alte data/eat.db vorher wegsichern
#   rm -rf data/photos && cp -r /tmp/eat-restore/photos data/photos
#   chown -R 1000:1000 data && docker start eat
#
# Hinweis: Das Archiv liegt standardmäßig auf demselben Rechner. Gegen Plattenausfall oder Diebstahl hilft erst eine
# Kopie auf ein anderes Gerät (z. B. rsync/scp des Backup-Ordners).

set -euo pipefail
umask 077

CONTAINER="${CONTAINER:-eat}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/eat}"
BACKUP_DAYS="${BACKUP_DAYS:-30}"
DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data"

[[ -d "$DATA_DIR" ]] || { echo "Datenordner nicht gefunden: $DATA_DIR" >&2; exit 1; }
[[ "$BACKUP_DAYS" =~ ^[0-9]+$ ]] || { echo "BACKUP_DAYS muss eine Zahl sein" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

snapshot="$(docker exec -e NODE_NO_WARNINGS=1 "$CONTAINER" node scripts/backup.js | tail -n 1)"
[[ "$snapshot" =~ ^eat-[0-9]{8}-[0-9]{6}\.db$ ]] || { echo "Unerwartete Ausgabe des Schnappschusses: $snapshot" >&2; exit 1; }

archive="$BACKUP_DIR/eat-$(date +%Y-%m-%d-%H%M%S).tar.gz"
tar czf "$archive" -C "$DATA_DIR" "backups/$snapshot" photos
tar tzf "$archive" >/dev/null   # Archiv lesbar?

find "$BACKUP_DIR" -maxdepth 1 -name 'eat-*.tar.gz' -mtime "+$BACKUP_DAYS" -delete
echo "Gesichert: $archive ($(du -h "$archive" | cut -f1))"
