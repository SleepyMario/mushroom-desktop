#!/usr/bin/env python3
from pathlib import Path
import subprocess,tempfile,sys,gzip
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1] if len(sys.argv)>1 else root/'dist').resolve();out.mkdir(parents=True,exist_ok=True)
version=(root/'VERSION').read_text().strip().replace('-alpha.','~alpha.')+'-1'
with tempfile.TemporaryDirectory(prefix='mushroom-desktop-deb-') as d:
 stage=Path(d);stage.chmod(0o755)
 subprocess.run(['make','install',f'DESTDIR={stage}'],cwd=root,check=True)
 control=stage/'DEBIAN';control.mkdir()
 (control/'control').write_text(f'''Package: mushroom-desktop
Version: {version}
Architecture: all
Maintainer: Mushroom <admin@sleepymario.com>
Section: gnome
Priority: optional
Depends: gnome-shell (>= 46), gnome-shell (<< 51), gjs, python3, gir1.2-soup-3.0, xdg-utils
Recommends: gnome-shell-extension-ubuntu-dock
Description: Mushroom GNOME workspace dock and status panel
 Custom workspace previews, system monitoring, window layout controls and
 bottom status panel. Supports Ubuntu 24.04 and 26.04 LTS.
 Installation does not enable extensions or change user settings.
''')
 doc=stage/'usr/share/doc/mushroom-desktop'
 (doc/'copyright').write_text('Mushroom desktop contributors. License: GPL-3.0-or-later.\nSee COPYING for the complete license text.\n')
 (doc/'changelog.Debian.gz').write_bytes(gzip.compress(f'mushroom-desktop ({version}) stable; urgency=medium\n\n  * Initial standalone desktop package.\n\n -- Mushroom <admin@sleepymario.com>  Sun, 22 Nov 2026 16:30:00 +0800\n'.encode(),mtime=0))
 subprocess.run(['dpkg-deb','--root-owner-group','--build',str(stage),str(out/f'mushroom-desktop_{version}_all.deb')],check=True)
