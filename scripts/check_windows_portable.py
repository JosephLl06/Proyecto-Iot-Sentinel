"""Comprueba el lanzador distribuido con la cuenta y la base de datos de un usuario nuevo."""
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from scripts.check_demo import client

import pyotp


def check():
    if sys.platform != "win32":
        raise SystemExit("Este ensayo requiere Windows x64.")
    exe = Path(__file__).resolve().parents[1] / "IoTSentinel.exe"
    assert not (exe.parent / "runtime" / "mosquitto" / "mosquitto.exe").exists()
    with tempfile.TemporaryDirectory(prefix="IoTSentinel prueba ") as folder:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        url = f"https://127.0.0.1:{port}"
        env = dict(os.environ, LOCALAPPDATA=folder, IOTSENTINEL_PORT=str(port), IOTSENTINEL_NO_BROWSER="1")
        process = subprocess.Popen([str(exe)], env=env, cwd=folder)
        try:
            ca = Path(folder) / "IoTSentinel" / "https" / "iotsentinel-local.crt"
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError("El lanzador se cerró antes de servir HTTPS.")
                try:
                    request = client(url, ca)
                    if request("/api/session")["setup"]:
                        break
                except OSError:
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError("El panel no respondió en 60 segundos.")
            request("/api/metrics", expected=401)
            pair = request("/api/login", {"email":"windows@example.test","password":"portable-test-123456"})
            request("/api/verify", {"code":pyotp.TOTP(pair["manualKey"]).now()})
            for _ in range(30):
                state = request("/api/state")
                if state["transportInfo"]["health"]["lastExchange"]:
                    break
                time.sleep(1)
            assert state["transportInfo"]["broker"] == "aMQTT"
            assert state["transportInfo"]["health"]["lastExchange"]
            assert len(state["devices"]) == 15 and request("/api/metrics")["samples"]
        finally:
            if process.poll() is None:
                subprocess.run(["taskkill","/PID",str(process.pid),"/T","/F"], check=True)
            process.wait(timeout=15)
    print("OK: lanzador portátil, alta con TOTP, HTTPS, aMQTT y 15 dispositivos en Windows.")


if __name__ == "__main__":
    check()
