from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
for p in (root/'extensions').glob('*/metadata.json'):
 data=json.loads(p.read_text());data['shell-version']=['46','49','50'];data['version']=1
 data['url']='https://github.com/SleepyMario/mushroom-desktop'
 p.write_text(json.dumps(data,indent=2)+'\n')
