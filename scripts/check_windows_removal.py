"""Comprueba el ciclo de la edición portátil dentro de un perfil temporal del runner Windows."""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from backend import desktop


def main(archive):
    if sys.platform != "win32" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("Esta prueba usa un runner Windows desechable de GitHub Actions.")
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run") as key:
            winreg.QueryValueEx(key, "IoTSentinel")
    except FileNotFoundError:
        pass
    else:
        raise RuntimeError("El runner ya tiene un inicio de IoTSentinel registrado.")
    with TemporaryDirectory(prefix="prueba continua ") as tmp:
        parent = Path(tmp)
        with ZipFile(archive) as package:
            package.extractall(parent)
        root = parent / "IoTSentinel"
        local = parent / "perfil"
        data = local / "IoTSentinel"
        with patch.dict(os.environ, {"LOCALAPPDATA": str(local)}), patch.object(desktop, "windows_trust", return_value=False):
            try:
                desktop.start_desktop(root, data)
                first = json.loads((data / "active.json").read_text())
                desktop.start_desktop(root, data)
                assert first == json.loads((data / "active.json").read_text())
                user_file = root / "nota personal.txt"
                user_file.write_text("conservar")
                cmd = [str(parent / "Desinstalar IoTSentinel.exe")]
                cancelled = subprocess.run(cmd, input=b"\r\nCANCELAR\r\n\r\n", cwd=parent, timeout=20)
                assert cancelled.returncode == 0 and desktop.live_panel(data)
                result = subprocess.run(cmd, input=b"\r\nDESINSTALAR\r\n\r\n", cwd=parent, timeout=90)
                assert result.returncode == 0
                assert not data.exists() and list(root.iterdir()) == [user_file]
            finally:
                if desktop.live_panel(data):
                    desktop.stop_desktop(data)
    print("OK: apertura en segundo plano, reconexión y desinstalador del ZIP en Windows.")


if __name__ == "__main__":
    main(sys.argv[1])
