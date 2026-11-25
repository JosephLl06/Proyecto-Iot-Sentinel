import ipaddress
import math
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from threading import RLock
from uuid import uuid4
import json

DEFAULTS = {
    "refreshInterval": 5, "saveInterval": 5, "historyRetention": 30,
    "dark": False, "notifications": True, "threshold": 5,
}
TYPES = {"Cámara IP", "Sensor", "Iluminación", "Enchufe IoT", "Desconocido"}


# Perfiles de referencia del laboratorio. Los destinos se comparan como etiquetas.
PROFILES = {
    "Cámara IP": {"maxMessages": 18, "destinations": ["grabador.local"]},
    "Sensor": {"maxMessages": 8, "destinations": ["gateway.local"]},
    "Iluminación": {"maxMessages": 7, "destinations": ["gateway.local"]},
    "Enchufe IoT": {"maxMessages": 8, "destinations": ["gateway.local"]},
    "Desconocido": {"maxMessages": 0, "destinations": []},
}


def simulated_reading(device, cycle, index):
    profile = device["profile"]
    reading = {
        "id": device["id"],
        "traffic": round(0.3 + ((cycle + index * 3) % 7) * 0.27, 2),
        "messages": 1 + (cycle + index) % 5,
        "destination": (profile["destinations"] or ["gateway.local"])[0],
    }
    if device["type"] == "Cámara IP" and cycle % 6 in (1, 2):
        reading["traffic"] = 8.7
    if device["type"] == "Sensor" and cycle % 6 == 2:
        reading["messages"] = 35
    if device["type"] == "Iluminación" and cycle % 6 == 2:
        reading["destination"] = "destino-no-registrado.invalid"
    return reading


def detect(device, sample, limit):
    profile = device["profile"]
    if not device["authorized"]:
        return "Dispositivo no autorizado", "Acceso no autorizado", "Alta"
    if sample["destination"] not in profile["destinations"]:
        return "Destino no habitual", "Destino no habitual", "Alta"
    if sample["messages"] > profile["maxMessages"]:
        return "Frecuencia anormal detectada", "Frecuencia anormal", "Media"
    if sample["traffic"] > limit:
        return "Tráfico elevado detectado", "Tráfico sospechoso", "Media"
    return None


class Invalid(ValueError):
    pass


def now():
    return time.time_ns() // 1_000_000


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = RLock()
        with self.db:
            self.db.execute("CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            if self.read("state") is None:
                self.write("state", {
                    "devices": [
                        self.device("Cámara principal", "192.0.2.101", "Cámara IP"),
                        self.device("Sensor de movimiento", "192.0.2.102", "Sensor"),
                        self.device("Foco inteligente", "192.0.2.103", "Iluminación"),
                        self.device("Enchufe inteligente", "192.0.2.104", "Enchufe IoT"),
                        self.device("Dispositivo desconocido", "192.0.2.150", "Desconocido"),
                    ],
                    "alerts": [], "events": [], "settings": DEFAULTS.copy(),
                    "monitoringEnabled": True, "lastUpdate": now(), "lastSave": None, "cycle": 0,
                })

    def read(self, key):
        row = self.db.execute("SELECT value FROM documents WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def write(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO documents VALUES (?, ?)", (key, json.dumps(value)))

    @staticmethod
    def device(name, ip, kind):
        return {"id": uuid4().hex, "name": name, "ip": ip, "type": kind,
                "status": "Conectado", "authorized": kind != "Desconocido",
                "blocked": False, "traffic": 0, "incident": None, "profile": PROFILES[kind].copy()}

    def snapshot(self):
        with self.lock:
            state = self.read("state")
            self.trim(state)
            return state

    def change(self, operation, data, user):
        with self.lock, self.db:
            state = self.read("state")
            devices = state["devices"]
            if operation == "device":
                name = data.get("name")
                kind = data.get("type")
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or not isinstance(kind, str) or kind not in TYPES:
                    raise Invalid("Ingresa un nombre válido y selecciona el tipo de dispositivo.")
                try:
                    if not isinstance(data.get("ip"), str):
                        raise ValueError
                    ip = str(ipaddress.ip_address(data["ip"].strip()))
                except ValueError:
                    raise Invalid("Ingresa una dirección IP válida.") from None
                if any(device["ip"] == ip for device in devices):
                    raise Invalid("Ya existe un dispositivo con esa dirección IP.")
                device = self.device(name.strip(), ip, kind)
                devices.append(device)
                self.event(state, "Dispositivo agregado", name.strip(), user, device=device)
            elif operation in {"block", "connection"}:
                device = next((item for item in devices if item["id"] == data.get("id")), None)
                if device is None:
                    raise Invalid("El dispositivo no existe.")
                if operation == "block":
                    device["blocked"] = not device["blocked"]
                    device["traffic"] = 0
                    action = "bloqueado" if device["blocked"] else "desbloqueado"
                    self.event(state, f"Dispositivo {action}", device["name"], user,
                               "Control de acceso", "Alta" if device["blocked"] else "Media", device, True)
                else:
                    if device["blocked"]:
                        raise Invalid("Desbloquea primero el dispositivo.")
                    connected = device["status"] == "Conectado"
                    device["status"] = "Desconectado" if connected else "Conectado"
                    device["traffic"] = 0
                    device["incident"] = None
                    self.event(state, f"Dispositivo {device['status'].lower()}", device["name"], user,
                               "Desconexión" if connected else "Actividad del sistema",
                               device=device, alert=connected)
            elif operation == "read-alerts":
                for alert in state["alerts"]:
                    if data.get("id") is None or alert["id"] == data["id"]:
                        alert["read"] = True
            elif operation == "monitoring":
                state["monitoringEnabled"] = not state["monitoringEnabled"]
                title = "Monitoreo reanudado" if state["monitoringEnabled"] else "Monitoreo pausado"
                self.event(state, title, "Simulación local", user)
            elif operation == "settings":
                state["settings"].update(self.validate_settings(data))
                self.event(state, "Configuración actualizada", "Preferencias del sistema", user)
            elif operation == "login":
                self.event(state, "Inicio de sesión", "Acceso al panel local", user)
            else:
                raise Invalid("Acción desconocida.")
            self.trim(state)
            self.write("state", state)
            return state

    @staticmethod
    def validate_settings(data):
        result = {}
        choices = {
            "refreshInterval": (5, 10, 30, 60), "saveInterval": (1, 5, 15, 30, 60),
            "historyRetention": (7, 30, 90),
        }
        for key, value in data.items():
            if key in choices and type(value) is int and value in choices[key]:
                result[key] = value
            elif key in {"dark", "notifications"} and type(value) is bool:
                result[key] = value
            elif key == "threshold" and type(value) in {int, float} and math.isfinite(value) and 1 <= value <= 1000:
                result[key] = value
            else:
                raise Invalid("El valor de configuración no es válido.")
        return result

    @staticmethod
    def event(state, title, detail, user="Sistema", kind="Actividad del sistema",
              severity="Baja", device=None, alert=False):
        timestamp = now()
        item = {
            "id": uuid4().hex, "title": title, "detail": detail, "type": kind,
            "severity": severity, "deviceType": device["type"] if device else "Sistema",
            "user": user, "time": datetime.fromtimestamp(timestamp / 1000).strftime("%d/%m/%Y %H:%M:%S"),
            "timestamp": timestamp,
        }
        state["events"].insert(0, item)
        if alert:
            state["alerts"].insert(0, {**item, "read": False})

    @staticmethod
    def trim(state):
        cutoff = now() - state["settings"]["historyRetention"] * 86_400_000
        for key in ("events", "alerts"):
            state[key] = [item for item in state[key] if item["timestamp"] >= cutoff][:5000]

    def tick(self, transport):
        with self.lock, self.db:
            state = self.read("state")
            timestamp = now()
            settings = state["settings"]
            if not state["monitoringEnabled"] or timestamp - state["lastUpdate"] < settings["refreshInterval"] * 1000:
                return
            cycle = state["cycle"] + 1
            samples = []
            for index, device in enumerate(state["devices"]):
                if device["status"] != "Conectado" or device["blocked"]:
                    continue
                device.setdefault("profile", PROFILES[device["type"]].copy())
                samples.append(simulated_reading(device, cycle, index))

            # El detector consume las mismas lecturas que publica el simulador.
            received = transport(samples) if samples else []
            by_id = {sample["id"]: sample for sample in received}
            for device in state["devices"]:
                if device["id"] not in by_id:
                    continue
                sample = by_id[device["id"]]
                device["traffic"] = sample["traffic"]
                incident = detect(device, sample, settings["threshold"])
                if incident and device["incident"] != incident[1]:
                    title, kind, severity = incident
                    detail = f"{device['name']} · {sample['traffic']} MB · {sample['messages']} mensajes · {sample['destination']}"
                    self.event(state, title, detail, kind=kind, severity=severity, device=device, alert=True)
                device["incident"] = incident[1] if incident else None

            state["lastUpdate"] = timestamp
            state["cycle"] = cycle
            last_save = state["lastSave"]
            if last_save is None or timestamp - last_save >= settings["saveInterval"] * 60_000:
                total = sum(device["traffic"] for device in state["devices"])
                self.event(state, "Registro periódico de actividad", f"Tráfico simulado: {total:.1f} MB.")
                state["lastSave"] = timestamp
            self.trim(state)
            self.write("state", state)
