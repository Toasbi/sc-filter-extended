import json
from pathlib import Path
from zipfile import ZipFile

# Allowlist by design: ONLY these files are ever packaged. New tooling or
# editor dirs can never leak into a release because they are simply not on
# this list.
INCLUDE_GLOBS = [
    "src/*.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
]

with open("manifest_v3.json") as f:
    version = json.load(f)["version"]

files = sorted(
    {path for glob in INCLUDE_GLOBS for path in Path(".").glob(glob) if path.is_file()}
)

# (zip name, manifest to write in as manifest.json)
targets = [
    (f"build/sc-filter-{version}-mv2.zip", "manifest_v2.json"),
    (f"build/sc-filter-{version}-mv3.zip", "manifest_v3.json"),
]

Path("build").mkdir(exist_ok=True)
for zip_path, manifest_src in targets:
    with ZipFile(zip_path, "w") as zip:
        for file in files:
            zip.write(file)
        with open(manifest_src) as f:
            zip.writestr("manifest.json", f.read())

print(f"Packaged v{version} ({len(files) + 1} files each):")
for file in files:
    print(f"  {file}")
print("  manifest.json (from manifest_v2.json / manifest_v3.json)")
for zip_path, _ in targets:
    print(f"-> {zip_path}")
