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
import signal
import sys
import time
import webbrowser

import pyotp
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import unquote

from backend import authenticator as mfa
from backend.https_identity import panel_identity, windows_trust
from backend.instance import app_instance
from backend.mqtt_link import Telemetry
from backend.state import Invalid, Store, now
from backend.relay import Relay

COOKIE = "__Host-IoTSentinel"
CHALLENGE_LIFETIME = 300
SESSION_INACTIVITY = 15 * 60
SESSION_MAX_AGE = 4 * 3600
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
        self.factor_failures = 0
        self.factor_blocked_until = 0
        self.challenge = None

    def session_user(self, token, *, activity=False):
        with self.store.lock:
            info = self.sessions.get(token)
            if info is None:
                return None
            email, expires, last_active = info
            current = time.monotonic()
            if current >= expires or current - last_active >= SESSION_INACTIVITY:
                self.sessions.pop(token, None)
                self.store.change("session-expired", {}, email)
                return None
            if activity:
                self.sessions[token] = email, expires, current
            return email

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
                if len(password) < 12:
                    raise Invalid("Usa al menos 12 caracteres para crear la cuenta.")
                salt = os.urandom(16)
                account = {"email": email, "salt": salt.hex(), "hash": password_hash(password, salt)}

            else:
                candidate = password_hash(password, bytes.fromhex(account["salt"]))
                if not hmac.compare_digest(candidate, account["hash"]) or email != account["email"]:
                    self.failures += 1
                    if self.failures == 5:
                        self.store.change("login-limited", {}, "Sistema")
                    return None
            self.failures = 0
            if attempt < self.factor_blocked_until:
                raise Invalid("Espera 30 segundos antes de intentar otro código.")
            existing_factor = account.get("factor")
            key_salt = bytes.fromhex(existing_factor["salt"]) if existing_factor else secrets.token_bytes(16)
            key = mfa.credential_key(password, key_salt)
            secret = None if existing_factor else pyotp.random_base32()
            token = secrets.token_urlsafe(32)
            self.challenge = {
                "token": token, "expires": attempt + CHALLENGE_LIFETIME, "account": account,
                "key": key, "salt": key_salt.hex(), "secret": secret,
            }
            response = {"stage": "pair" if secret else "verify"}
            if secret:
                response["qr"] = mfa.pair(email, secret)
                response["manualKey"] = secret
            return token, response

    def expire_challenge(self):
        with self.store.lock:
            if self.challenge and time.monotonic() >= self.challenge["expires"]:
                self.challenge = None

    def verify_factor(self, token, data):
        with self.store.lock, self.store.db:
            pending = self.challenge
            attempt = time.monotonic()
            if not pending or not hmac.compare_digest(pending["token"], token) or attempt >= pending["expires"]:
                raise Invalid("El paso de verificación venció. Vuelve a ingresar tu contraseña.")
            account = pending["account"]
            factor = account.get("factor")
            code = data.get("code")
            if not isinstance(code, str) or len(code) > 32:
                raise Invalid("Ingresa el código solicitado.")
            if attempt < self.factor_blocked_until:
                raise Invalid("Espera 30 segundos antes de intentar otro código.")
            pairing = pending["secret"] is not None
            secret = pending["secret"] if pairing else mfa.unseal(factor["secret"], pending["key"])
            step = mfa.valid_step(secret, code.strip(), -1 if pairing else factor["last"])
            if step is None and not pairing:
                digest = mfa.recovery_hash(code)
                if any(hmac.compare_digest(digest, entry) for entry in factor["recovery"]):
                    # El reemplazo se confirma con un código del nuevo autenticador.
                    # Hasta entonces, el autenticador y los respaldos anteriores siguen vigentes.
                    pending["secret"] = pyotp.random_base32()
                    pending["expires"] = attempt + CHALLENGE_LIFETIME
                    return None, {"stage": "pair", "qr": mfa.pair(account["email"], pending["secret"]),
                                  "manualKey": pending["secret"], "replacement": True}
            if step is None:
                self.factor_failures += 1
                if self.factor_failures >= 5:
                    self.factor_failures = 0
                    self.factor_blocked_until = attempt + 30
                    self.challenge = None
                    self.store.change("mfa-limited", {}, "Sistema")
                return None

            response = {}
            if pairing:
                codes = mfa.recovery_codes()
                account["factor"] = {"secret": mfa.seal(secret, pending["key"]), "salt": pending["salt"],
                                     "last": step, "recovery": [mfa.recovery_hash(item) for item in codes]}
                response["recoveryCodes"] = codes
                response["recoveryUsed"] = bool(factor)
            else:
                factor["last"] = step
            # El contador y la recuperación sobreviven a reinicios y se guardan antes de emitir sesión.
            self.store.write("account", account)
            self.challenge = None
            self.factor_failures = 0
            if pairing:
                event = "mfa-recovery" if factor else "mfa-enrolled"
                self.store.change(event, {}, account["email"])
            response["state"] = self.store.change("login", {}, account["email"])
            token = secrets.token_urlsafe(32)
            self.sessions.clear()
            self.sessions[token] = account["email"], attempt + SESSION_MAX_AGE, attempt
            return token, response


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
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if cookie is not None or clear_cookie:
            value = cookie or ""
            expiry = "; Max-Age=0" if clear_cookie else ""
            self.send_header("Set-Cookie", f"{COOKIE}={value}; Path=/; Secure; HttpOnly; SameSite=Strict{expiry}")
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def cookie_token(self):
        cookies = SimpleCookie()
        cookies.load(self.headers.get("Cookie", ""))
        session = cookies.get(COOKIE)
        token = session.value if session else ""
        return token

    def user(self):
        token = self.cookie_token()
        return token, self.server.gateway.session_user(token)

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {"error": "Usa la dirección local de IoTSentinel."})
        path = self.path.partition("?")[0]
        gateway = self.server.gateway
        if path == "/api/session":
            _, user = self.user()
            with gateway.store.lock:
                setup = gateway.store.read("account") is None
            return self.respond(200, {"setup": setup, "email": user, "transport": self.connection.version()})
        if path in {"/api/state", "/api/metrics"}:
            _, user = self.user()
            if not user:
                return self.respond(401, {"error": "Inicia sesión para continuar."})
            if path == "/api/metrics":
                return self.respond(200, {"samples": gateway.store.metrics()})
            state = gateway.store.snapshot()
            state["transportInfo"] = {"broker": self.server.broker_name, "relay": dict(self.server.relay.status) if self.server.relay else {"enabled": False}}
            return self.respond(200, state)
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
        path = self.path.partition("?")[0]
        if not path.startswith("/api/"):
            return self.respond(404, {"error": "Ruta desconocida."})
        operation = path.removeprefix("/api/")
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
                token, challenge = result
                return self.respond(200, challenge, cookie=token)
            if operation == "verify":
                result = gateway.verify_factor(self.cookie_token(), data)
                if result is None:
                    return self.respond(401, {"error": "Código inválido, vencido o ya utilizado."})
                token, response = result
                return self.respond(200, response, cookie=token)
            token, user = self.user()
            if not user:
                return self.respond(401, {"error": "Inicia sesión para continuar."})
            if operation == "logout":
                with gateway.store.lock:
                    gateway.sessions.pop(token, None)
                    gateway.store.change("logout", {}, user)
                return self.respond(200, {}, clear_cookie=True)
            if operation == "activity":
                if not gateway.session_user(token, activity=True):
                    return self.respond(401, {"error": "La sesión venció."}, clear_cookie=True)
                return self.respond(200, {})
            if operation not in {"device", "block", "connection", "read-alerts", "respond-alert", "monitoring", "settings"}:
                return self.respond(404, {"error": "Ruta desconocida."})
            state = gateway.store.change(operation, data, user)
            gateway.session_user(token, activity=True)
            return self.respond(200, state)
        except Invalid as error:
            return self.respond(400, {"error": str(error)})
        except (ValueError, UnicodeError):
            return self.respond(400, {"error": "Solicitud JSON inválida."})

    def log_message(self, *_):
        pass


async def run(args):
    root_dir = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    assets = (root_dir / "frontend" / "dist").resolve()
    bundled_broker = root_dir / "runtime" / "mosquitto" / "mosquitto.exe"
    mosquitto = args.mosquitto or (str(bundled_broker) if sys.platform == "win32" and bundled_broker.is_file() else None)
    if sys.platform != "win32":
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, asyncio.current_task().cancel)
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
    relay = Relay(args.relay_url, args.relay_ca) if args.relay_url else None
    with TemporaryDirectory(prefix="iotsentinel-") as identity:
        transport = Telemetry()
        await transport.start(identity, mosquitto)
        sender = asyncio.create_task(relay.run()) if relay else None
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
                server.broker_name = "Mosquitto" if mosquitto else "aMQTT"
                server.relay = relay
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
                            accepted = await asyncio.to_thread(server.gateway.store.tick, exchange)
                            if relay and accepted:
                                relay.enqueue(accepted, now())
                            server.gateway.expire_challenge()
                        except Exception:
                            logging.exception("No se pudo recibir la telemetría MQTT. Se reintentará.")
                        await asyncio.sleep(1)
                finally:
                    server.shutdown()
        finally:
            if sender:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
            await transport.close()


def main():
    parser = argparse.ArgumentParser(description="IoTSentinel. Laboratorio local de seguridad IoT.")
    parser.add_argument("--port", type=int, default=0, help="Puerto del panel. 0 selecciona uno libre.")
    local = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    parser.add_argument("--data-dir", type=Path, default=local / "IoTSentinel")
    parser.add_argument("--mosquitto", help="Ruta al ejecutable Mosquitto para el broker local con mTLS.")
    parser.add_argument("--relay-url", help="Receptor HTTPS opcional de lecturas admitidas (TLS 1.3).")
    parser.add_argument("--relay-ca", help="CA de confianza del receptor HTTPS de pruebas.")
    parser.add_argument("--no-browser", action="store_true")
    try:
        args = parser.parse_args()
        with app_instance(args.data_dir):
            asyncio.run(run(args))
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == "__main__":
    main()
