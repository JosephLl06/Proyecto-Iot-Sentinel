import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import re
import secrets
import ssl
import sys
import time
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import unquote

from backend.https_identity import panel_identity, windows_trust
from backend.mqtt_link import Telemetry
from backend.state import Invalid, Store

COOKIE = "__Host-IoTSentinel"
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; "
       "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'")


class LocalHTTPSServer(ThreadingHTTPServer):
    def get_request(self):
        connection, address = super().get_request()
        # Realizar el saludo TLS dentro del hilo de la solicitud.
        connection.settimeout(5)
        try:
            return self.tls.wrap_socket(connection, server_side=True, do_handshake_on_connect=False), address
        except OSError:
            connection.close()
            raise

    def process_request_thread(self, request, client_address):
        try:
            request.do_handshake()
        except OSError:
            self.shutdown_request(request)
            return
        super().process_request_thread(request, client_address)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1).hex()


class Gateway:
    def __init__(self, data_dir):
        self.store = Store(data_dir / "sentinel.sqlite3")
        self.sessions = {}
        self.last_attempt = 0
        self.failures = 0

    def login(self, data):
        email, password = data.get("email"), data.get("password")
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise Invalid("Ingresa un correo válido.")
        if not isinstance(password, str) or not 8 <= len(password) <= 128:
            raise Invalid("La contraseña debe tener entre 8 y 128 caracteres.")
        with self.store.lock, self.store.db:
            attempt = time.monotonic()
            if self.failures >= 5:
                if attempt - self.last_attempt < 30:
                    raise Invalid("Espera 30 segundos antes de volver a intentar.")
                self.failures = 0
            self.last_attempt = attempt
            account = self.store.read("account")
            email = email.casefold()
            if account is None:
                salt = os.urandom(16)
                account = {"email": email, "salt": salt.hex(), "hash": password_hash(password, salt)}
                self.store.write("account", account)
            else:
                candidate = password_hash(password, bytes.fromhex(account["salt"]))
                if not hmac.compare_digest(candidate, account["hash"]) or email != account["email"]:
                    self.failures += 1
                    return None
            self.failures = 0
            state = self.store.change("login", {}, email)
            token = secrets.token_urlsafe(32)
            self.sessions.clear()
            self.sessions[token] = email, attempt + 8 * 3600
            return token, state


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def respond(self, status, data, content_type="application/json", cookie=None, clear_cookie=False):
        if content_type == "application/json":
            data = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if cookie is not None or clear_cookie:
            value = cookie or ""
            expiry = "; Max-Age=0" if clear_cookie else ""
            self.send_header("Set-Cookie", f"{COOKIE}={value}; Path=/; Secure; HttpOnly; SameSite=Strict{expiry}")
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def user(self):
        cookies = SimpleCookie()
        cookies.load(self.headers.get("Cookie", ""))
        session = cookies.get(COOKIE)
        token = session.value if session else ""
        with self.server.gateway.store.lock:
            info = self.server.gateway.sessions.get(token)
        return token, info[0] if info and info[1] > time.monotonic() else None

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {"error": "Usa la dirección local de IoTSentinel."})
        path = self.path.partition("?")[0]
        gateway = self.server.gateway
        if path == "/api/session":
            _, user = self.user()
            with gateway.store.lock:
                setup = gateway.store.read("account") is None
            return self.respond(200, {"setup": setup, "email": user})
        if path == "/api/state":
            _, user = self.user()
            if not user:
                return self.respond(401, {"error": "Inicia sesión para continuar."})
            return self.respond(200, gateway.store.snapshot())
        if path.startswith("/api/"):
            return self.respond(404, {"error": "Ruta desconocida."})
        root = self.server.assets
        asset = root / (unquote(path).lstrip("/") if path != "/" else "index.html")
        asset = asset.resolve()
        if not asset.is_relative_to(root) or not asset.is_file():
            return self.respond(404, {"error": "Archivo no encontrado."})
        return self.respond(200, asset.read_bytes(), mimetypes.guess_type(asset.name)[0] or "application/octet-stream")

    def do_POST(self):
        origin = self.headers.get("Origin")
        if not self.valid_host() or origin != f"https://{self.headers['Host']}":
            return self.respond(403, {"error": "Origen no permitido."})
        gateway = self.server.gateway
        operation = self.path.partition("?")[0].removeprefix("/api/")
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 1 <= size <= 8192:
                raise Invalid("Solicitud JSON inválida.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise Invalid("Solicitud JSON inválida.")
            if operation == "login":
                result = gateway.login(data)
                if result is None:
                    return self.respond(401, {"error": "Correo o contraseña incorrectos."})
                token, state = result
                return self.respond(200, state, cookie=token)
            token, user = self.user()
            if not user:
                return self.respond(401, {"error": "Inicia sesión para continuar."})
            if operation == "logout":
                with gateway.store.lock:
                    gateway.sessions.pop(token, None)
                return self.respond(200, {}, clear_cookie=True)
            return self.respond(200, gateway.store.change(operation, data, user))
        except Invalid as error:
            return self.respond(400, {"error": str(error)})
        except (ValueError, UnicodeError):
            return self.respond(400, {"error": "Solicitud JSON inválida."})

    def log_message(self, *_):
        pass


async def run(args):
    assets = (Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "frontend" / "dist").resolve()
    if not (assets / "index.html").is_file():
        raise SystemExit("Primero compila el panel con npm ci y npm run build dentro de frontend.")
    try:
        panel_tls, root, ca = panel_identity(args.data_dir)
    except (OSError, ValueError) as error:
        raise SystemExit(f"No se pudo preparar el certificado HTTPS local. {error}") from error
    print(f"Certificado HTTPS local: {root}", flush=True)
    open_panel = not args.no_browser
    if open_panel and sys.platform == "win32":
        open_panel = windows_trust(root, ca)
    with TemporaryDirectory(prefix="iotsentinel-") as identity:
        transport = Telemetry()
        await transport.start(identity)
        loop = asyncio.get_running_loop()

        def exchange(samples):
            future = asyncio.run_coroutine_threadsafe(transport.exchange(samples), loop)
            try:
                return future.result(timeout=8)
            except TimeoutError:
                future.cancel()
                raise

        try:
            with LocalHTTPSServer(("127.0.0.1", args.port), Handler) as server:
                server.tls = panel_tls
                server.gateway = Gateway(args.data_dir)
                server.assets = assets
                url = f"https://127.0.0.1:{server.server_port}"
                Thread(target=server.serve_forever, daemon=True).start()
                print(f"IoTSentinel listo en {url}", flush=True)
                if open_panel:
                    Thread(target=webbrowser.open, args=(url,), daemon=True).start()
                try:
                    while True:
                        try:
                            await asyncio.to_thread(server.gateway.store.tick, exchange)
                        except Exception:
                            logging.exception("No se pudo recibir la telemetría MQTT. Se reintentará.")
                        await asyncio.sleep(1)
                finally:
                    server.shutdown()
        finally:
            await transport.close()


def main():
    parser = argparse.ArgumentParser(description="IoTSentinel. Laboratorio local de seguridad IoT.")
    parser.add_argument("--port", type=int, default=0, help="Puerto del panel. 0 selecciona uno libre.")
    local = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    parser.add_argument("--data-dir", type=Path, default=local / "IoTSentinel")
    parser.add_argument("--no-browser", action="store_true")
    try:
        asyncio.run(run(parser.parse_args()))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
