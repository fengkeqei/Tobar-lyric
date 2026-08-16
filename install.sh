#!/usr/bin/env bash
set -euo pipefail

uuid="lyric-ex@local"
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"

mkdir -p "$target"
cp metadata.json extension.js indicator.js lyrics.js mpris.js online.js prefs.js stylesheet.css "$target/"
cp -r schemas "$target/"
glib-compile-schemas "$target/schemas"

echo "Installed $uuid for GNOME Shell 50."
echo "Enable with: gnome-extensions enable $uuid"
