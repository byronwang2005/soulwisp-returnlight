"""Extract the pinned friend-provided server pack without running its scripts."""
import hashlib
import json
import pathlib
import sys
import zipfile

source = pathlib.Path(__file__).resolve().parent
lock = json.loads((source / 'mods.lock.json').read_text())
archive = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2]) / 'data'
if hashlib.sha256(archive.read_bytes()).hexdigest() != lock['sourceSha256']:
    raise ValueError('The server pack does not match the pinned archive.')
with zipfile.ZipFile(archive) as pack:
    for name in pack.namelist():
        if name.endswith('/') or not name.startswith(('mods/', 'config/', 'defaultconfigs/')):
            continue
        relative = pathlib.PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name:
            raise ValueError('Unsafe archive path: ' + name)
        if name.startswith('mods/') and any(relative.name.startswith(prefix) for prefix in lock['excludedPrefixes']):
            continue
        if name == 'config/simplebackups-common.toml':
            continue
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if name.startswith('mods/') and target.read_bytes() != pack.read(name):
                raise ValueError('Existing mod differs: ' + name)
            continue
        target.write_bytes(pack.read(name))
print('Prepared pinned server mods and initial configuration; existing configuration was preserved.')
