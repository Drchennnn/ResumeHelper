from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'extension/manifest.json').read_text())
version = manifest['version']
destination = root / 'dist' / f'resume-helper-{version}.zip'
destination.parent.mkdir(exist_ok=True)
files = sorted(path for path in (root / 'extension').rglob('*') if path.is_file())
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(root))
    for name in ['README.md', 'THIRD_PARTY_NOTICES.md', 'docs/hybrid-control.md', 'docs/attachments.md', 'docs/verification-0.7.0.md']:
        archive.write(root / name, name)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert 'extension/vendor/pdfjs/pdf.worker.min.mjs' in archive.namelist()
    assert not any(name.startswith(('fixtures/', 'node_modules/', '.git/')) for name in archive.namelist())
metadata = {'version': version, 'file': destination.name, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'bytes': destination.stat().st_size, 'extensionFiles': len(files)}
(root / 'dist/package-info.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata))
