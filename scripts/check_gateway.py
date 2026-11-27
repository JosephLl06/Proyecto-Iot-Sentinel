"""Prueba el flujo de salida contra un receptor HTTPS local y un broker seleccionable."""
import argparse
import asyncio
import json
import queue
import ssl
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.https_identity import panel_identity
from backend.mqtt_link import TOPIC, Telemetry
from scripts.check_demo import check


async def check_roles():
    with tempfile.TemporaryDirectory() as folder:
        link = Telemetry()
        await link.start(folder)
        try:
            assert await link.simulator.subscribe([(TOPIC, 1)]) == [128]
            assert await link.gateway.subscribe([("iotsentinel/otro", 1)]) == [128]
            assert await link.gateway.subscribe([(TOPIC, 1)]) == [1]
            reading = {"id": "sensor-local", "messages": 1, "traffic": 0.1}
            assert await link.exchange([reading]) == [reading]
        finally:
            await link.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mosquitto")
    args = parser.parse_args()
    if not args.mosquitto:
        asyncio.run(check_roles())
    received = queue.Queue()

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/lecturas" and self.connection.version() == "TLSv1.3"
            received.put(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_):
            pass

    with tempfile.TemporaryDirectory() as folder, ThreadingHTTPServer(("127.0.0.1", 0), Receiver) as sink:
        context, ca_file, _ = panel_identity(Path(folder))
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        sink.socket = context.wrap_socket(sink.socket, server_side=True)
        threading.Thread(target=sink.serve_forever, daemon=True).start()
        try:
            cmd = [sys.executable, "main.py", "--relay-url", f"https://127.0.0.1:{sink.server_port}/lecturas",
                   "--relay-ca", str(ca_file)]
            if args.mosquitto:
                cmd.extend(["--mosquitto", args.mosquitto])
            check(cmd)
            assert received.qsize() >= 2
            while not received.empty():
                batch = received.get_nowait()
                assert batch["readings"] and batch["timestamp"] > 0
                for reading in batch["readings"]:
                    assert reading["traffic"] <= 5 and reading["messages"] <= 20
                    assert reading["destination"] in {"gateway.local","grabador.local","multimedia.local","audio.local"}
        finally:
            sink.shutdown()
    print("OK: entrega verificada en un receptor local TLS 1.3 y retención de anomalías.")


if __name__ == "__main__":
    main()
