"""Prueba el flujo completo con una base de datos temporal."""
import http.cookiejar
import json
import queue
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pyotp

EMAIL = "demo@example.test"
PASSWORD = "demo-password-local"


def start(command, folder):
    process = subprocess.Popen(command + ["--no-browser", "--data-dir", folder],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    lines = queue.Queue()

    def read():
        for line in process.stdout:
            lines.put(line.strip())
        lines.put(None)

    threading.Thread(target=read, daemon=True).start()
    deadline = time.monotonic() + 45
    logs = []
    try:
        while time.monotonic() < deadline:
            line = lines.get(timeout=max(0.1, deadline - time.monotonic()))
            if line is None:
                break
            if "IoTSentinel listo en " in line:
                return process, line.split("IoTSentinel listo en ", 1)[1]
            logs.append(line)
    except queue.Empty:
        pass
    process.kill()
    process.wait()
    raise AssertionError("El ejecutable no arrancó:\n" + "\n".join(logs))


def stop(process):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=True)
    else:
        process.terminate()
    process.wait(timeout=10)


def client(url, certificate):
    context = ssl.create_default_context(cafile=str(certificate))
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=context),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
    )

    def request(path, payload=None, expected=200, origin=None, headers=None):
        request_data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(url + path, data=request_data, headers={"Content-Type": "application/json", "Origin": origin or url})
        try:
            result = opener.open(req, timeout=10)
        except urllib.error.HTTPError as error:
            result = error
        with result:
            assert result.code == expected, (path, result.code, result.read())
            data = result.read()
            if headers is not None:
                headers.update(result.headers.items())
        return json.loads(data) if path.startswith("/api/") else data

    return request


def check_transport(url, certificate):
    port = int(url.rsplit(":", 1)[1])
    endpoint = ("127.0.0.1", port)
    trusted = ssl.create_default_context(cafile=str(certificate))
    with socket.create_connection(endpoint, timeout=5) as connection:
        with trusted.wrap_socket(connection, server_hostname="127.0.0.1") as tls:
            assert tls.version() == "TLSv1.3"
    for context, server_name in [
        (ssl.create_default_context(), "127.0.0.1"),
        (trusted, "localhost"),
    ]:
        with socket.create_connection(endpoint, timeout=5) as connection:
            try:
                context.wrap_socket(connection, server_hostname=server_name)
            except ssl.SSLCertVerificationError:
                pass
            else:
                raise AssertionError("Se aceptó un certificado sin confianza o con nombre incorrecto")
    old_tls = ssl.create_default_context(cafile=str(certificate))
    old_tls.maximum_version = ssl.TLSVersion.TLSv1_2
    with socket.create_connection(endpoint, timeout=5) as connection:
        try:
            old_tls.wrap_socket(connection, server_hostname="127.0.0.1")
        except ssl.SSLError:
            pass
        else:
            raise AssertionError("TLS 1.2 se aceptó")
    with socket.create_connection(endpoint, timeout=5) as connection:
        connection.sendall(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        try:
            assert b"HTTP/" not in connection.recv(512)
        except ConnectionResetError:
            pass


def check(command):
    with tempfile.TemporaryDirectory() as folder:
        process, url = start(command, folder)
        try:
            certificate = Path(folder) / "https" / "iotsentinel-local.crt"
            request = client(url, certificate)
            assert b"iotsentinel" in request("/").lower()
            original_ca = certificate.read_bytes()
            check_transport(url, certificate)
            assert request("/api/session")["setup"]
            request("/api/metrics", expected=401)
            request("/api/respond-alert", {"action":"isolate"}, expected=401)
            request("/api/state", expected=401)
            payload = {"email": EMAIL, "password": PASSWORD}
            request("/api/login", payload, expected=403, origin="https://example.invalid")
            headers = {}
            pairing = request("/api/login", payload, headers=headers)
            assert pairing["stage"] == "pair" and pairing["qr"].startswith("data:image/png;base64,")
            assert all(flag in headers["Set-Cookie"] for flag in (
                "__Host-IoTSentinel=", "Secure", "HttpOnly", "SameSite=Strict", "Path=/"))
            assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
            request("/api/state", expected=401)
            request("/api/metrics", expected=401)
            seed = pairing["manualKey"]
            totp = pyotp.TOTP(seed)
            step = int(time.time() // 30)
            first_code = totp.generate_otp(step)
            request("/api/verify", {"code": "00000X"}, expected=401)
            enrolled = request("/api/verify", {"code": first_code})
            codes = enrolled["recoveryCodes"]
            assert len(codes) == len(set(codes)) == 8
            state = enrolled["state"]
            assert len(state["devices"]) == 15
            assert {"Cámara de cochera", "Cámara de pasaje"} <= {device["name"] for device in state["devices"]}
            assert request("/api/session")["transport"] == "TLSv1.3"
            request("/api/session-expired", {}, expected=404)
            request("/api/activity", {}, origin="https://example.invalid", expected=403)
            request("/api/activity", {})

            for _ in range(55):
                time.sleep(0.5)
                state = request("/api/state")
                kinds = {alert["type"] for alert in state["alerts"]}
                if {"Acceso no autorizado", "Tráfico sospechoso", "Frecuencia anormal", "Destino no habitual", "Posible patrón de botnet"} <= kinds:
                    break
            else:
                raise AssertionError("No llegaron las lecturas cifradas por MQTT o faltaron alertas")

            metrics = request("/api/metrics")["samples"]
            assert len(metrics) >= 2
            assert all(batch["messages"] == sum(values[1] for values in batch["devices"].values()) for batch in metrics)
            device = next(device for device in state["devices"] if device["name"] == "Cámara de cochera")
            assert any(batch["devices"][device["id"]][0] > 5 for batch in metrics)
            assert any(flag["deviceId"] == device["id"] and flag["reason"] == "Tráfico elevado detectado"
                       and point["devices"][device["id"]][0] > point["threshold"]
                       for point in metrics for flag in point["flags"])
            camera_cases = [a for a in state["alerts"] if a.get("deviceId") == device["id"]]
            assert len(camera_cases) == 1 and camera_cases[0]["occurrences"] >= 2
            case = camera_cases[0]
            assert case["evidence"]["volumeLimit"] == 5 and case["lastEvidence"]["traffic"] == 8.7
            assert any(f.get("caseId") == case["id"] for point in metrics for f in point["flags"])
            assert all(p["admitted"] + len(p["flags"]) == len(p["devices"]) for p in metrics)
            def respond(action, note="", expected=200):
                return request("/api/respond-alert", {"action":action, "id":case["id"], "note":note}, expected)
            respond("investigate")
            respond("resolve", expected=400)
            request("/api/respond-alert", {"action":"isolate", "id":case["id"]}, 403, origin="https://example.invalid")
            respond("isolate")
            respond("isolate", expected=400)
            state = respond("resolve", "Cámara aislada tras verificar el pico.")
            assert next(a for a in state["alerts"] if a["id"] == case["id"])["status"] == "Resuelta"
            state = respond("reopen", "Volver a verificar el equipo.")
            assert [e["title"] for e in state["events"] if e.get("caseId") == case["id"]][:4] == [
                "Investigación reabierta", "Alerta resuelta", "Equipo aislado en el gateway", "Investigación iniciada"]
            assert all(e["user"] == EMAIL for e in state["events"] if e.get("caseId") == case["id"])
            assert any(item["id"] == device["id"] and item["blocked"] and item["traffic"] == 0
                       for item in state["devices"])
            request("/api/connection", {"id": device["id"]}, expected=400)
            request("/api/device", {"name": "Demo", "ip": "inválida", "type": "Sensor"}, expected=400)
            state = request("/api/device", {"name": "Demo", "ip": "192.0.2.200", "type": "Sensor"})
            assert len(state["devices"]) == 16
            state = request("/api/read-alerts", {})
            assert all(alert["read"] for alert in state["alerts"])
            state = request("/api/monitoring", {})
            assert not state["monitoringEnabled"]
            request("/api/settings", {"threshold": 7})
            request("/api/logout", {})
            request("/api/state", expected=401)
            request("/api/login", {"email": EMAIL, "password": "incorrecta"}, expected=401)
        finally:
            stop(process)

        process, url = start(command, folder)
        try:
            assert certificate.read_bytes() == original_ca
            request = client(url, certificate)
            assert not request("/api/session")["setup"]
            challenge = request("/api/login", payload)
            assert challenge == {"stage": "verify"}
            request("/api/metrics", expected=401)
            request("/api/verify", {"code": first_code}, expected=401)
            replacement = request("/api/verify", {"code": codes[0]})
            assert replacement["stage"] == "pair" and replacement["replacement"]
            request("/api/state", expected=401)
            next_totp = pyotp.TOTP(replacement["manualKey"])
            next_step = int(time.time() // 30)
            result = request("/api/verify", {"code": next_totp.generate_otp(next_step)})
            assert result["recoveryUsed"] and len(result["recoveryCodes"]) == 8
            request("/api/logout", {})
            request("/api/login", payload)
            request("/api/verify", {"code": codes[0]}, expected=401)
            new_code = next_totp.generate_otp(max(next_step + 1, int(time.time() // 30)))
            state = request("/api/verify", {"code": new_code})["state"]
            assert state["settings"]["threshold"] == 7
            assert len(state["devices"]) == 16
            assert request("/api/metrics")["samples"]
            assert not state["monitoringEnabled"]
            assert next(a for a in state["alerts"] if a["id"] == case["id"])["status"] == "En revisión"
            assert any(item["blocked"] for item in state["devices"])
            assert any(event["title"] == "Dispositivo agregado" for event in state["events"])
        finally:
            stop(process)


if __name__ == "__main__":
    check([str(Path(sys.argv[1]).resolve())] if len(sys.argv) > 1 else [sys.executable, "main.py"])
    print("OK: HTTPS con TLS 1.3, validación de certificado, sesión segura, MQTT, telemetría histórica, alertas y persistencia.")
