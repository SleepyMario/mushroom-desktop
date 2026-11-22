#!/bin/bash
set -euo pipefail
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.local/share/gnome-shell/extensions"
chmod 700 "$XDG_RUNTIME_DIR"
cp -a /project/extensions/. "$HOME/.local/share/gnome-shell/extensions/"
cp -a /project/tests/probe "$HOME/.local/share/gnome-shell/extensions/mushroom-smoke-probe@local"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['workspaces-to-dock-codex@local', 'right-half-panel@local', 'mushroom-smoke-probe@local']"
gnome-shell --headless --wayland --virtual-monitor=1920x1080 --no-x11 > /tmp/shell.log 2>&1 &
shell_pid=$!
trap 'kill "$shell_pid" 2>/dev/null || true; cat /tmp/shell.log' EXIT
for attempt in $(seq 1 30); do
 if gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.ListExtensions > /tmp/extensions.txt 2>/dev/null; then break; fi
 kill -0 "$shell_pid" || exit 1
 sleep 1
done
sleep 5
export WAYLAND_DISPLAY=wayland-0
GDK_BACKEND=wayland gjs /project/tests/window-smoke.js
sleep 2
test "$(cat /tmp/mushroom-probe-result)" = PASS
gnome-extensions disable mushroom-smoke-probe@local
cat /tmp/extensions.txt
for uuid in workspaces-to-dock-codex@local right-half-panel@local; do
 info=$(gnome-extensions info "$uuid"); printf "%s\n" "$info"
 grep -Eq "State: (ACTIVE|ENABLED)" <<< "$info"
 gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.GetExtensionErrors "$uuid"
done
for uuid in right-half-panel@local workspaces-to-dock-codex@local; do
 gnome-extensions disable "$uuid"
done
sleep 2
for uuid in workspaces-to-dock-codex@local right-half-panel@local; do
 gnome-extensions enable "$uuid"
done
sleep 3
for uuid in workspaces-to-dock-codex@local right-half-panel@local; do
 info=$(gnome-extensions info "$uuid"); printf '%s\n' "$info"
 grep -Eq 'State: (ACTIVE|ENABLED)' <<< "$info"
done
if grep -Eq 'JS ERROR|Gjs-CRITICAL' /tmp/shell.log; then exit 1; fi
printf 'SHELL_SMOKE_PASS\n'
