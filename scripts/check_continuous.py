"""Valida ciclos sin navegador, parada cooperativa y continuación sobre la misma base."""
from contextlib import closing
import json
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

from backend.desktop import live_panel, stop_desktop
from scripts.check_demo import start, stop


def sample_count(folder):
    with closing(sqlite3.connect(folder / "sentinel.sqlite3")) as db:
        return db.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        first = 0
        for target in (10, 1):
            process, url = start([sys.executable, "main.py"], tmp)
            try:
                assert live_panel(folder) == url
                # El cliente queda cerrado durante varios ciclos completos.
                for _ in range(240):
                    if sample_count(folder) >= first + target:
                        break
                    time.sleep(0.3)
                assert sample_count(folder) >= first + target
                stop_desktop(folder)
                assert process.wait(timeout=15) == 0
                assert live_panel(folder) is None
                with closing(sqlite3.connect(folder / "sentinel.sqlite3")) as db:
                    rows = [json.loads(row[0]) for row in db.execute("SELECT value FROM telemetry ORDER BY timestamp")]
                    assert all(len(row["devices"]) == 15 for row in rows)
                    assert len({tuple(row["devices"].values())[0][0] for row in rows}) >= 2
                    detections = {(flag["device"], flag["reason"]) for row in rows for flag in row["flags"]}
                    assert ("Cerradura de la puerta principal", "Dispositivo no autorizado") in detections
                    assert ("Smart TV de la sala", "Destino no habitual") in detections
                    assert all(row["admitted"] + len(row["flags"]) == 15 for row in rows)
                first = len(rows)
            finally:
                if process.poll() is None:
                    stop(process)
        print(f"OK: {first} intervalos de 15 dispositivos sin navegador, parada y reanudación.")


if __name__ == "__main__":
    main()
