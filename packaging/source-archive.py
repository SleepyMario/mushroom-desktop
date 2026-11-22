#!/usr/bin/env python3
"""Create the versioned source archive without build output or local caches."""
from pathlib import Path
import tarfile
root=Path(__file__).resolve().parents[1]
version=(root/'VERSION').read_text().strip()
name=f'mushroom-desktop-{version}'
out=root/'dist';out.mkdir(exist_ok=True)
with tarfile.open(out/f'{name}.tar.xz','w:xz') as archive:
 for path in sorted(root.rglob('*')):
  relative=path.relative_to(root)
  if any(part in {'.git','dist','build','__pycache__'} for part in relative.parts):continue
  if path.is_file():archive.add(path,arcname=f'{name}/{relative}',recursive=False)
print(out/f'{name}.tar.xz')
