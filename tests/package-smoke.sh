#!/bin/bash
set -euo pipefail
mkdir -p /home/tester/.config/mushroom-desktop /home/tester/.local/share/gnome-shell/extensions/right-half-panel@local
printf 'preserve settings\n' > /home/tester/.config/mushroom-desktop/sentinel
printf 'preserve local extension\n' > /home/tester/.local/share/gnome-shell/extensions/right-half-panel@local/sentinel
find /home/tester -type f -exec sha256sum {} + | sort > /tmp/before.sha256
apt-get update -qq
apt-get install -y --no-install-recommends /project/dist/mushroom-desktop_*_all.deb
sha256sum -c /tmp/before.sha256
! test -e /home/tester/.config/dconf/user
HOME=/home/tester /usr/bin/mushroom-desktop status
if HOME=/home/tester /usr/bin/mushroom-desktop enable; then echo 'FAIL: local-copy protection'; exit 1; fi
apt-get purge -y mushroom-desktop
sha256sum -c /tmp/before.sha256
! test -e /usr/share/gnome-shell/extensions/right-half-panel@local
! test -e /usr/bin/mushroom-desktop
! test -e /home/tester/.config/dconf/user
printf 'PACKAGE_SMOKE_PASS\n'
