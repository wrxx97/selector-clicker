from argparse import ArgumentParser
from html.parser import HTMLParser
from json import loads
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile


EXTENSION_ROOT = Path(__file__).resolve().parents[1]
DIST = EXTENSION_ROOT / "dist"
CONTENT_FILES = {"site-rules.js", "picker.js", "content.js"}


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == "script" and not attrs.get("src"):
            raise ValueError("Inline scripts are prohibited in extension pages.")
        path = attrs.get("src") if tag == "script" else attrs.get("href") if tag == "link" else None
        if not path:
            return
        asset = urlsplit(path)
        if asset.scheme or asset.netloc or asset.path.startswith("/"):
            raise ValueError(f"Extension resources must use relative paths: {path}")
        self.paths.add(asset.path)


def extension_files():
    built_manifest = DIST / "manifest.json"
    if not built_manifest.is_file():
        raise ValueError("The extension build is missing. Run pnpm run build first.")
    manifest = loads(built_manifest.read_text(encoding="utf-8"))
    if manifest != loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8")):
        raise ValueError("The extension build is out of date. Run pnpm run build again.")

    action = manifest["action"]
    pages = (action["default_popup"], manifest["options_ui"]["page"])
    files = {"manifest.json", *CONTENT_FILES, *pages, manifest["background"]["service_worker"]}
    files.update(manifest["icons"].values())
    files.update(action["default_icon"].values())

    for page in pages:
        parser = PageAssets()
        parser.feed((DIST / page).read_text(encoding="utf-8"))
        files.update((Path(page).parent / asset).as_posix() for asset in parser.paths)

    files.update(path.relative_to(DIST).as_posix() for path in (DIST / "assets").rglob("*") if path.is_file())
    for file in files:
        path = DIST / file
        if not path.is_file() or not path.resolve().is_relative_to(DIST.resolve()):
            raise ValueError(f"Missing or invalid extension resource: {file}")
    return sorted(files)


def main():
    parser = ArgumentParser(description="Build the upload ZIP for Selector Clicker.")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        files = extension_files()
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, "w", compression=ZIP_DEFLATED) as archive:
        for name in files:
            archive.write(DIST / name, arcname=name)
    print(f"Created {args.output}")


if __name__ == "__main__":
    main()
