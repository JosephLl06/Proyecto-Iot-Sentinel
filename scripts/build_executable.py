"""Compila el panel y empaqueta IoTSentinel para el sistema actual."""
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
npm = shutil.which("npm")
if not npm:
    raise SystemExit("Instala Node.js antes de compilar el panel.")
subprocess.run([npm, "ci"], cwd=root / "frontend", check=True)
subprocess.run([npm, "run", "build"], cwd=root / "frontend", check=True)
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--onefile", "--name", "IoTSentinel",
    "--collect-all", "amqtt", "--add-data", "frontend/dist:frontend/dist", "main.py",
], cwd=root, check=True)
