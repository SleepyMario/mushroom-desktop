#!/usr/bin/env python3
from pathlib import Path
import json,subprocess,tempfile
root=Path(__file__).resolve().parents[1]
expected={'workspaces-to-dock-codex@local','right-half-panel@local'}
assert {p.name for p in (root/'extensions').iterdir()}==expected
for directory in (root/'extensions').iterdir():
 data=json.loads((directory/'metadata.json').read_text())
 assert data['uuid']==directory.name
 assert set(data['shell-version'])=={'46','49','50'}
 for p in directory.iterdir():
  assert '.before-' not in p.name
  if p.suffix=='.py':compile(p.read_text(),str(p),'exec')
  if p.suffix=='.js':
   assert '10.77.0.' not in p.read_text()
with tempfile.TemporaryDirectory() as d:
 stage=Path(d)
 subprocess.run(['make','install',f'DESTDIR={stage}'],cwd=root,check=True,stdout=subprocess.DEVNULL)
 assert {p.name for p in stage.iterdir()}=={'usr'}
 assert {p.name for p in (stage/'usr/share/gnome-shell/extensions').iterdir()}==expected
 assert not (stage/'usr/share/gnome-shell/extensions/sleepymario-gdm-layout@sleepymario.local').exists()
 assert (stage/'usr/bin/mushroom-desktop').stat().st_mode&0o111
 assert (stage/'usr/share/doc/mushroom-desktop/COPYING').is_file()
print('PASS: identifiers, supported versions, privacy defaults and system-only package staging')
