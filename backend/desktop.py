"""Ciclo de vida del gateway portátil y apertura de su panel local."""
import json
import secrets
import ssl
import subprocess
import time
import urllib.request
import webbrowser
from contextlib import contextmanager
from pathlib import Path

from .https_identity import windows_trust
from .instance import app_instance
from cryptography import x509

DESKTOP_VERSION = 3


@contextmanager
def advertise(directory, port):
    token = secrets.token_hex(16)
    marker = directory / "active.json"
    temporary = directory / "active.new"
    stop = directory / "stop.request"
    stop.unlink(missing_ok=True)
    temporary.write_text(json.dumps({"port": port, "instance": token, "desktopVersion": DESKTOP_VERSION}), encoding="ascii")
    temporary.replace(marker)
    def stopping():
        try:
            return stop.read_text(encoding="ascii") == token
        except FileNotFoundError:
            return False
    try:
        yield stopping
    finally:
        marker.unlink(missing_ok=True)
        stop.unlink(missing_ok=True)


def live_panel(directory):
    try:
        active = json.loads((directory / "active.json").read_text(encoding="ascii"))
        port = active["port"]
        if type(port) is not int or not 1 <= port <= 65535:
            return None
        url = f"https://127.0.0.1:{port}"
        ca = directory / "https" / "iotsentinel-local.crt"
        context = ssl.create_default_context(cafile=str(ca))
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                             urllib.request.HTTPSHandler(context=context))
        with opener.open(url + "/api/session", timeout=1) as response:
            if json.load(response).get("transport") == "TLSv1.3":
                return url
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def worker_command(root):
    return [str(root / "runtime" / "pythonw.exe"), "-B", str(root / "main.py"), "--no-browser"]


def start_desktop(root, directory):
    url = live_panel(directory)
    if url:
        active = json.loads((directory / "active.json").read_text(encoding="ascii"))
        if active.get("desktopVersion", 1) < DESKTOP_VERSION:
            stop_desktop(directory)
            for _ in range(50):
                try:
                    with app_instance(directory):
                        break
                except SystemExit:
                    time.sleep(0.2)
            else:
                raise SystemExit("La versión anterior todavía está cerrando sus conexiones.")
            url = None
    if url is None:
        directory.mkdir(parents=True, exist_ok=True)
        log = directory / "arranque.log"
        with log.open("w", encoding="utf-8") as output:
            process = subprocess.Popen(worker_command(root), cwd=root, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(100):
            url = live_panel(directory)
            if url:
                break
            if process.poll() is not None:
                # Otra apertura simultánea puede estar preparando el mismo gateway.
                if process.returncode == 0:
                    break
            time.sleep(0.2)
        if not url:
            raise SystemExit(f"No se pudo abrir el gateway. Revisa {log}.")
    ca = directory / "https" / "iotsentinel-local.crt"
    print(f"Gateway en ejecución: {url}", flush=True)
    if windows_trust(ca, x509.load_pem_x509_certificate(ca.read_bytes())):
        webbrowser.open(url)


def stop_desktop(directory):
    try:
        marker = directory / "active.json"
        info = json.loads(marker.read_text(encoding="ascii"))
        if not live_panel(directory):
            raise SystemExit("El gateway no responde. Comprueba si la versión anterior sigue abierta.")
        (directory / "stop.request").write_text(info["instance"], encoding="ascii")
        for _ in range(100):
            if not marker.exists():
                print("Simulación detenida. Los datos se conservan.")
                return
            time.sleep(0.2)
        raise SystemExit("El gateway todavía no ha confirmado la parada.")
    except FileNotFoundError:
        print("No hay una simulación activa.")
