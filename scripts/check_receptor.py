"""Verifica TLS mutuo, exclusión de clientes ajenos y huellas sobre un socket real."""
import hashlib
from http.client import HTTPSConnection, HTTPException
import json
from pathlib import Path
import ssl
import tempfile
import threading

from backend.relay import Relay
from scripts.receptor import identity, Receiver, Receipt, receiver_context


def run():
    with tempfile.TemporaryDirectory() as folder:
        d = Path(folder)
        for role in ("gateway", "receptor"):
            identity(d, role, "127.0.0.1" if role == "receptor" else None)
        with Receiver(("127.0.0.1", 0), Receipt) as server:
            server.context = receiver_context(d)
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            try:
                port = server.server_port
                url = f"https://127.0.0.1:{port}/lecturas"
                batch = {"timestamp": 123, "readings": [{"id": "prueba"}], "procesoCpuMs": 1}
                client = Relay(url, d / "receptor.crt", d / "gateway.crt", d / "gateway.key")
                result = client.deliver(batch)
                assert result["digest"] == hashlib.sha256(json.dumps(batch).encode()).hexdigest()[:16]
                for host, ctx in [("localhost", client.tls), ("127.0.0.1", ssl.create_default_context(cafile=str(d / "receptor.crt")))]:
                    c = HTTPSConnection(host, port, context=ctx, timeout=3)
                    try:
                        c.request("POST", "/lecturas", json.dumps(batch))
                        c.getresponse()
                    except (OSError, HTTPException):
                        pass
                    else:
                        raise AssertionError("Se aceptó una conexión de prueba sin identidad correcta.")
                    finally:
                        c.close()
            finally:
                server.shutdown()
                worker.join()
    print("OK: huella de lote y mTLS; rechazo de nombre ajeno y cliente sin certificado.")


if __name__ == "__main__":
    run()
