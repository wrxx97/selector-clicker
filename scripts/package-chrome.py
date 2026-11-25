from argparse import ArgumentParser
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


EXTENSION_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_FILES = (
    "manifest.json",
    "content.js",
    "picker.js",
    "site-rules.js",
    "service-worker.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "rules.html",
    "rules.css",
    "rules.js",
    "icons/icon-16.png",
    "icons/icon-24.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
)


def main():
    parser = ArgumentParser(description="Build the upload ZIP for Selector Clicker.")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    for name in PACKAGE_FILES:
        if not (EXTENSION_ROOT / name).is_file():
            parser.error(f"Missing extension file: {name}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.output, "w", compression=ZIP_DEFLATED) as archive:
        for name in PACKAGE_FILES:
            archive.write(EXTENSION_ROOT / name, arcname=name)
    print(f"Created {args.output}")


if __name__ == "__main__":
    main()
