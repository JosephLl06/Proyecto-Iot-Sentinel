"""Construye el ZIP portátil y el inventario utilizado por el desinstalador."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = "archivos-portatiles.json"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--bundle", type=Path, help="Bundle Git de la edición evaluada")
    args = parser.parse_args()
    output = args.output.resolve()
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().rstrip("\0").split("\0")
    files = sorted(name for name in names if name != INVENTORY and "__pycache__" not in Path(name).parts
                   and not name.endswith(".pyc"))
    output.parent.mkdir(exist_ok=True, parents=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        inventory = {}
        for name in files:
            content = (ROOT / name).read_bytes()
            inventory[name] = hashlib.sha256(content).hexdigest()
            archive.writestr("IoTSentinel/" + name, content)
        manifest = json.dumps(inventory, ensure_ascii=False, indent=1).encode("utf-8")
        archive.writestr("IoTSentinel/" + INVENTORY, manifest)
        remover = output.parent / "Desinstalar IoTSentinel.exe"
        fingerprint = hashlib.sha256(manifest).hexdigest()
        subprocess.run(["go", "build", "-trimpath", "-ldflags", f"-X main.current={fingerprint}",
                        "-o", str(remover), "./scripts/remover"], check=True, cwd=ROOT,
                       env=dict(os.environ, GOOS="windows", GOARCH="amd64", CGO_ENABLED="0", GO111MODULE="off"))
        archive.write(remover, remover.name)
        if args.bundle:
            archive.write(args.bundle, "IoTSentinel-CR3.bundle")
    (ROOT / INVENTORY).write_bytes(manifest)


if __name__ == "__main__":
    main()
