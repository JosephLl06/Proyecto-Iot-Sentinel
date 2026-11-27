"""Entrega opcional de lecturas admitidas a un único receptor configurado por el operador."""
import asyncio
import hashlib
import json
import ssl
import time
from http.client import HTTPException, HTTPSConnection
from urllib.parse import urlsplit


class Relay:
    def __init__(self, url, ca_file=None, cert=None, key=None):
        target = urlsplit(url)
        if (target.scheme != "https" or not target.hostname or target.username is not None
                or target.password is not None or target.fragment or target.query):
            raise ValueError("El receptor requiere una URL HTTPS sin credenciales, consulta ni fragmento.")
        self.host, self.port, self.path = target.hostname, target.port or 443, target.path or "/"
        self.tls = ssl.create_default_context(cafile=ca_file)
        if bool(cert) != bool(key) or (cert and not ca_file):
            raise ValueError("Para mTLS indica certificado, clave y certificado público del receptor.")
        if cert:
            self.tls.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
            self.tls.load_cert_chain(cert, key)
        self.tls.minimum_version = ssl.TLSVersion.TLSv1_3
        self.queue = asyncio.Queue(maxsize=4)
        self.status = {"enabled": True, "sent": 0, "failed": 0, "dropped": 0, "lastBatch": None}

    def enqueue(self, samples, timestamp):
        if samples:
            try:
                self.queue.put_nowait({"timestamp": timestamp, "readings": samples, "procesoCpuMs": time.process_time_ns() // 1_000_000})
            except asyncio.QueueFull:
                self.status["dropped"] += 1

    def deliver(self, batch):
        conn = HTTPSConnection(self.host, self.port, context=self.tls, timeout=3)
        try:
            body = json.dumps(batch).encode()
            conn.request("POST", self.path, body, {"Content-Type": "application/json"})
            response = conn.getresponse()
            if 200 <= response.status < 300:
                return {"timestamp": batch["timestamp"], "bytes": len(body),
                        "digest": hashlib.sha256(body).hexdigest()[:16], "readings": len(batch["readings"])}
            return None
        finally:
            conn.close()

    async def run(self):
        while True:
            batch = await self.queue.get()
            try:
                success = await asyncio.to_thread(self.deliver, batch)
            except (OSError, ValueError, HTTPException):
                success = None
            if success:
                self.status["lastBatch"] = success
            self.status["sent" if success else "failed"] += 1
