#!/usr/bin/env bash
set -euo pipefail

uuid="lyric-ex@local"
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
temporary="${target}.install.$$"
was_enabled=0

if gnome-extensions info "$uuid" 2>/dev/null |
    grep -q 'Enabled: Yes'; then
    was_enabled=1
    gnome-extensions disable "$uuid"
fi

cleanup() {
    rm -rf "$temporary"
}
trap cleanup EXIT

rm -rf "$temporary"
mkdir -p "$temporary"
cp metadata.json extension.js indicator.js lyrics.js mpris.js online.js prefs.js stylesheet.css art-cache.js now-playing-card.js "$temporary/"
cp -r schemas "$temporary/"
glib-compile-schemas "$temporary/schemas"

rm -rf "$target"
mv "$temporary" "$target"
trap - EXIT

if [ "$was_enabled" -eq 1 ]; then
    gnome-extensions enable "$uuid"
fi

echo "Installed $uuid for GNOME Shell 50."
echo "Enable with: gnome-extensions enable $uuid"
