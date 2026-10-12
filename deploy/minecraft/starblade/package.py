"""Package compiled Java 21 classes with deterministic archive metadata."""
from pathlib import Path
import sys,zipfile,hashlib,json
source=Path(sys.argv[1]); classes=Path(sys.argv[2]); output=Path(sys.argv[3]);output.mkdir(parents=True,exist_ok=True)
jar=output/'byron-perks-1.1.0.jar'
files=[(p,str(p.relative_to(classes))) for p in sorted(classes.rglob('*.class'))]
assert files,'Compile the Java sources first'
files += [(source/'neoforge.mods.toml','META-INF/neoforge.mods.toml'),(source/'byron-perks.mixins.json','byron-perks.mixins.json')]
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
 for p,name in files:
  entry=zipfile.ZipInfo(name,(2026,10,12,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;z.writestr(entry,p.read_bytes())
release={'filename':jar.name,'version':'1.1.0','sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'bytes':jar.stat().st_size}
(output.parent/'release.json').write_text(json.dumps(release,indent=2)+'\n');print(json.dumps(release))
