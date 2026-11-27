import ipaddress
import math
import sqlite3
from statistics import median
import time
from datetime import datetime
from pathlib import Path
from threading import RLock
from uuid import uuid4
import json

from backend.home import HOME, PROFILES

DEFAULTS = {
    "refreshInterval": 5, "saveInterval": 5, "historyRetention": 30,
    "dark": False, "notifications": True, "threshold": 5,
}
MAX_DEVICES = 64
MAX_SAMPLES = 360


def simulated_reading(device, cycle, index):
    profile = device["profile"]
    reading = {
        "id": device["id"],
        "traffic": round(0.3 + ((cycle + index * 3) % 7) * 0.27, 2),
        "messages": 1 + (cycle + index) % 5,
        "destination": (profile["destinations"] or ["gateway.local"])[0],
    }
    if device["ip"] == "192.0.2.105" and cycle % 12 in (1, 2):
        reading["traffic"] = 8.7
    if device["ip"] == "192.0.2.102" and cycle % 12 in (2, 3):
        reading["messages"] = 35
    if device["ip"] == "192.0.2.106" and cycle % 12 in (2, 3):
        reading["destination"] = "203.0.113.45"
    if device["ip"] == "192.0.2.107" and cycle % 12 in (2, 3, 4):
        reading.update(messages=32, destination="198.51.100.27")
    # Las direcciones solo son campos JSON de la simulación local.
    if device["ip"] == "192.0.2.108" and cycle % 12 in (6, 7):
        reading["identityTest"] = "unknown"
    if device["ip"] == "192.0.2.109" and cycle % 12 in (9, 10):
        reading["destination"] = "203.0.113.89"
    return reading


def detect(device, sample, limit):
    profile = device["profile"]
    if not device["authorized"] or sample.get("identityTest") == "unknown":
        return "Dispositivo no autorizado", "Acceso no autorizado", "Alta"
    unusual_target = sample["destination"] not in profile["destinations"]
    if unusual_target and sample["messages"] > profile["maxMessages"] and device.get("burstStreak", 0) >= 2:
        return "Ráfaga repetida hacia un destino desconocido", "Posible patrón de botnet", "Alta"
    if unusual_target:
        return "Destino no habitual", "Destino no habitual", "Alta"
    if sample["messages"] > profile["maxMessages"]:
        return "Frecuencia anormal detectada", "Frecuencia anormal", "Media"
    if sample["traffic"] > limit:
        return "Tráfico elevado detectado", "Tráfico sospechoso", "Media"
    return None


def volume_limit(device, ceiling):
    history = device.get("normalVolumes", [])
    if len(history) < 12:
        return ceiling
    center = median(history)
    deviation = median(abs(value - center) for value in history)
    return round(min(ceiling, center + max(1.0, 4 * deviation)), 2)


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
            self.db.execute("CREATE TABLE IF NOT EXISTS telemetry (timestamp INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            state = self.read("state") or {
                "devices": [], "alerts": [], "events": [], "settings": DEFAULTS.copy(),
                "monitoringEnabled": True, "lastUpdate": now(), "lastSave": None, "cycle": 0,
            }
            by_ip = {device["ip"]: device for device in state["devices"]}
            if state.get("inventoryVersion", 0) < 2:
                for last_octet, name, kind, room in HOME:
                    ip = f"192.0.2.{last_octet}"
                    if ip in by_ip:
                        by_ip[ip].setdefault("room", room)
                    elif len(state["devices"]) < MAX_DEVICES:
                        state["devices"].append(self.device(name, ip, kind, room))
                state["inventoryVersion"] = 2
            self.db.execute("CREATE TABLE IF NOT EXISTS legacy_alerts (id TEXT PRIMARY KEY, timestamp INTEGER, value TEXT)")
            if not state.get("caseVersion"):
                self.migrate_cases(state)
                state["caseVersion"] = 1
            self.write("state", state)

    def migrate_cases(self, state):
        alerts = state["alerts"]
        if not alerts:
            return
        # Conserva el original antes de agrupar los avisos de la edición anterior.
        self.db.executemany("INSERT OR IGNORE INTO legacy_alerts VALUES (?, ?, ?)",
                            [(a["id"], a["timestamp"], json.dumps(a)) for a in alerts])
        kinds = {"Tráfico sospechoso", "Frecuencia anormal", "Destino no habitual", "Acceso no autorizado"}
        grouped = {}
        rebuilt = []
        for alert in sorted(alerts, key=lambda a: a["timestamp"], reverse=True):
            name, separator, _ = alert["detail"].partition(" · ")
            matches = [d for d in state["devices"] if d["name"] == name and d["type"] == alert["deviceType"]]
            if alert["type"] not in kinds or not separator or len(matches) != 1:
                rebuilt.append(alert)
                continue
            device = matches[0]
            key = device["id"], alert["type"]
            if key in grouped:
                case = grouped[key]
                case["firstSeen"] = alert["timestamp"]
                case["occurrences"] += 1
                case["read"] = case["read"] and alert["read"]
            else:
                alert.update(deviceId=device["id"], deviceName=name, ip=device["ip"], room=device.get("room"),
                             firstSeen=alert["timestamp"], lastSeen=alert["timestamp"], occurrences=1,
                             status="Abierta", detection=True)
                grouped[key] = alert
                rebuilt.append(alert)
        state["alerts"] = rebuilt

    def metrics(self):
        with self.lock:
            rows = self.db.execute("SELECT value FROM telemetry WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?",
                                   (now() - 86_400_000, MAX_SAMPLES))
            return [json.loads(row[0]) for row in reversed(rows.fetchall())]

    def read(self, key):
        row = self.db.execute("SELECT value FROM documents WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def write(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO documents VALUES (?, ?)", (key, json.dumps(value)))

    @staticmethod
    def device(name, ip, kind, room="Sin asignar"):
        return {"id": uuid4().hex, "name": name, "ip": ip, "type": kind, "room": room,
                "status": "Conectado", "authorized": kind != "Desconocido",
                "blocked": False, "traffic": 0, "incident": None, "profile": PROFILES[kind].copy()}

    def snapshot(self):
        with self.lock:
            state = self.read("state")
            self.trim(state)
            self.describe_profiles(state)
            return state

    @staticmethod
    def describe_profiles(state):
        for device in state["devices"]:
            history = device.get("normalVolumes", [])
            device["typicalVolume"] = median(history) if history else None
            device["volumeLimit"] = volume_limit(device, state["settings"]["threshold"])

    def change(self, operation, data, user):
        with self.lock, self.db:
            state = self.read("state")
            devices = state["devices"]
            if operation == "device":
                name = data.get("name")
                kind = data.get("type")
                room = data.get("room", "Sin asignar")
                if len(devices) >= MAX_DEVICES:
                    raise Invalid("El inventario admite hasta 64 dispositivos.")
                if not isinstance(room, str) or not 1 <= len(room.strip()) <= 40:
                    raise Invalid("Ingresa una zona de hasta 40 caracteres.")
                if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or not isinstance(kind, str) or kind not in PROFILES:
                    raise Invalid("Ingresa un nombre válido y selecciona el tipo de dispositivo.")
                try:
                    if not isinstance(data.get("ip"), str):
                        raise ValueError
                    ip = str(ipaddress.ip_address(data["ip"].strip()))
                except ValueError:
                    raise Invalid("Ingresa una dirección IP válida.") from None
                if any(device["ip"] == ip for device in devices):
                    raise Invalid("Ya existe un dispositivo con esa dirección IP.")
                device = self.device(name.strip(), ip, kind, room.strip())
                devices.append(device)
                self.event(state, "Dispositivo agregado", name.strip(), user, device=device)
            elif operation == "scenario":
                names = {"volume": "Pico de volumen", "destination": "Destino desconocido",
                         "identity": "Identidad no autorizada"}
                kind = data.get("kind")
                device = next((d for d in devices if d["id"] == data.get("id")), None)
                if not isinstance(kind, str) or kind not in names or not device or not device["authorized"]:
                    raise Invalid("Selecciona una prueba y un equipo autorizado.")
                if not state["monitoringEnabled"] or device["blocked"] or device["status"] != "Conectado":
                    raise Invalid("El monitoreo y el equipo deben estar activos.")
                if device.get("scenario"):
                    raise Invalid("Este equipo ya tiene una prueba pendiente.")
                test_id = self.event(state, "Prueba programada", names[kind], user, device=device)
                device["scenario"] = {"id": test_id, "kind": kind, "name": names[kind]}
            elif operation in {"block", "connection"}:
                device = next((item for item in devices if item["id"] == data.get("id")), None)
                if device is None:
                    raise Invalid("El dispositivo no existe.")
                if operation == "block":
                    device["blocked"] = not device["blocked"]
                    if device["blocked"]:
                        device["isolatedAt"] = now()
                    else:
                        device.update(restoredAt=now(), recurrenceAt=None)
                    device["incident"] = None
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
            elif operation == "respond-alert":
                self.respond_alert(state, data, user)
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
            elif operation in {"login", "logout", "session-expired", "login-limited", "mfa-enrolled", "mfa-recovery", "mfa-limited", "password-reset"}:
                title, detail = {
                    "login": ("Inicio de sesión", "Acceso al panel local"),
                    "logout": ("Cierre de sesión", "La sesión se cerró desde el panel"),
                    "session-expired": ("Sesión caducada", "Se alcanzó el límite de la sesión"),
                    "mfa-enrolled": ("Autenticador vinculado", "Se activó el segundo factor local"),
                    "mfa-recovery": ("Código de respaldo utilizado", "Se vinculó otro autenticador y se invalidaron los respaldos anteriores"),
                    "password-reset": ("Contraseña restablecida", "Se cerraron las sesiones y se invalidaron los respaldos anteriores"),
                    "mfa-limited": ("Verificación limitada", "Se activó una espera de 30 segundos"),
                    "login-limited": ("Intentos de acceso limitados", "Se activó una espera de 30 segundos"),
                }[operation]
                self.event(state, title, detail, user, "Control de acceso")
            else:
                raise Invalid("Acción desconocida.")
            self.trim(state)
            self.write("state", state)
            self.describe_profiles(state)
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
              severity="Baja", device=None, alert=False, **fields):
        timestamp = now()
        item = {
            "id": uuid4().hex, "title": title, "detail": detail, "type": kind,
            "severity": severity, "deviceType": device["type"] if device else "Sistema",
            "user": user, "time": datetime.fromtimestamp(timestamp / 1000).strftime("%d/%m/%Y %H:%M:%S"),
            "timestamp": timestamp, **fields,
        }
        if device:
            item.update(deviceId=device["id"], deviceName=device["name"], ip=device["ip"], room=device.get("room"))
        state["events"].insert(0, item)
        if alert:
            state["alerts"].insert(0, {**item, "read": False, "status": "Abierta", "occurrences": 1})
        return item["id"]

    def respond_alert(self, state, data, user):
        alert = next((a for a in state["alerts"] if a["id"] == data.get("id")), None)
        if alert is None:
            raise Invalid("Esta alerta ya no está disponible.")
        action = data.get("action")
        note = data.get("note", "")
        if not isinstance(note, str) or len(note) > 350:
            raise Invalid("Usa una nota de hasta 350 caracteres.")
        note = note.strip()
        status = alert.get("status", "Abierta")
        if action == "investigate" and status == "Abierta":
            new_status, title = "En revisión", "Investigación iniciada"
        elif action == "isolate" and status != "Resuelta":
            device = next((d for d in state["devices"] if d["id"] == alert.get("deviceId")), None)
            if not device or device["blocked"]:
                raise Invalid("No se puede aislar este equipo desde esta alerta.")
            instant = now()
            device.update(blocked=True, traffic=0, incident=None, burstStreak=0, isolatedAt=instant)
            rows = self.metrics()
            start = alert.get("firstSeen", alert["timestamp"])
            def readings(items):
                return [[r["timestamp"], *r["devices"][device["id"]]] for r in items if device["id"] in r["devices"]][-12:]
            alert["comparison"] = {"at": instant, "before": readings(r for r in rows if r["timestamp"] < start),
                                   "during": readings(r for r in rows if start <= r["timestamp"] <= instant),
                                   "after": []}
            new_status, title = "En revisión", "Equipo aislado en el gateway"
        elif action == "resolve" and status != "Resuelta" and note:
            new_status, title = "Resuelta", "Alerta resuelta"
        elif action == "reopen" and status == "Resuelta":
            new_status, title = "En revisión", "Investigación reabierta"
        else:
            raise Invalid("Comprueba el estado del caso e indica el motivo al resolverlo.")
        alert.update(status=new_status, read=True, updatedAt=now())
        device = next((d for d in state["devices"] if d["id"] == alert.get("deviceId")), None)
        self.event(state, title, " · ".join(filter(None, [alert["title"], alert.get("deviceName"), note])),
                   user, "Respuesta a alerta", alert["severity"], device, caseId=alert["id"], note=note)

    def record_detection(self, state, device, sample, incident, timestamp, limit, cases):
        title, kind, severity = incident
        detail = f"{device['name']} · {sample['traffic']} MB · {sample['messages']} mensajes · {sample['destination']}"
        evidence = {"traffic": sample["traffic"], "messages": sample["messages"],
                    "destination": sample["destination"], "volumeLimit": limit,
                    "messageLimit": device["profile"]["maxMessages"],
                    "expectedDestinations": device["profile"]["destinations"]}
        key = (device["id"], kind)
        case = cases.get(key)
        if case:
            case.update(lastSeen=timestamp, lastEvidence=evidence, detail=detail)
            case["occurrences"] = case.get("occurrences", 1) + 1
            case_id = case["id"]
        else:
            case_id = self.event(state, title, detail, kind=kind, severity=severity, device=device,
                                 alert=True, detection=True, evidence=evidence, lastSeen=timestamp, firstSeen=timestamp)
            cases[key] = state["alerts"][0]
        return {"deviceId": device["id"], "device": device["name"], "reason": title,
                "severity": severity, "detail": detail, "caseId": case_id}

    @staticmethod
    def trim(state):
        cutoff = now() - state["settings"]["historyRetention"] * 86_400_000
        state["events"] = [e for e in state["events"] if e["timestamp"] >= cutoff][:5000]
        def recent(a):
            return max(a["timestamp"], a.get("lastSeen", 0), a.get("updatedAt", 0))
        state["alerts"] = sorted((a for a in state["alerts"] if recent(a) >= cutoff), key=recent, reverse=True)[:5000]

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
                reading = simulated_reading(device, cycle, index)
                test = device.get("scenario")
                if test:
                    reading.update(traffic=0.2, messages=1, destination=device["profile"]["destinations"][0])
                    if test["kind"] == "volume":
                        reading["traffic"] = settings["threshold"] + 2
                    elif test["kind"] == "destination":
                        reading["destination"] = "203.0.113.77"
                    else:
                        reading["identityTest"] = "unknown"
                samples.append(reading)

            # El detector consume las mismas lecturas que publica el simulador.
            received = transport(samples) if samples else []
            by_id = {sample["id"]: sample for sample in received}
            flags = []
            limits = {}
            allowed = []
            cases = {(a.get("deviceId"), a["type"]): a for a in reversed(state["alerts"])
                     if a.get("status") != "Resuelta" and a.get("detection")}
            for device in state["devices"]:
                if device["id"] not in by_id:
                    device["burstStreak"] = 0
                    continue
                sample = by_id[device["id"]]
                profile = device["profile"]
                combined = sample["destination"] not in profile["destinations"] and sample["messages"] > profile["maxMessages"]
                device["burstStreak"] = device.get("burstStreak", 0) + 1 if combined else 0
                device["lastReadingAt"] = timestamp
                device["traffic"] = sample["traffic"]
                limit = volume_limit(device, settings["threshold"])
                limits[device["id"]] = [limit, profile["maxMessages"]]
                incident = detect(device, sample, limit)
                if incident:
                    flag = self.record_detection(state, device, sample, incident, timestamp, limit, cases)
                    flags.append(flag)
                    if device.get("restoredAt") and not device.get("recurrenceAt"):
                        device["recurrenceAt"] = timestamp
                    test = device.pop("scenario", None)
                    if test:
                        self.event(state, "Prueba detectada", test["name"], device=device,
                                   caseId=flag["caseId"], testId=test["id"])
                        cases[(device["id"], incident[1])]["lastTest"] = test["name"]
                else:
                    history = device.setdefault("normalVolumes", [])
                    history.append(sample["traffic"])
                    del history[:-36]
                    allowed.append(sample)
                device["incident"] = incident[1] if incident else None
            for alert in state["alerts"]:
                comparison = alert.get("comparison")
                if comparison and len(comparison["after"]) < 12:
                    sample = by_id.get(alert["deviceId"])
                    comparison["after"].append([timestamp, sample["traffic"] if sample else None,
                                                sample["messages"] if sample else None])

            total = sum(sample["traffic"] for sample in received)
            sample_row = {
                "timestamp": timestamp, "traffic": round(total, 2), "flags": flags,
                "threshold": settings["threshold"], "limits": limits, "admitted": len(allowed),
                "messages": sum(sample["messages"] for sample in received),
                "devices": {sample["id"]: [sample["traffic"], sample["messages"]] for sample in received},
            }
            self.db.execute("INSERT INTO telemetry VALUES (?, ?)", (timestamp, json.dumps(sample_row)))
            self.db.execute("DELETE FROM telemetry WHERE timestamp < ? OR timestamp NOT IN "
                            "(SELECT timestamp FROM telemetry ORDER BY timestamp DESC LIMIT ?)",
                            (timestamp - 86_400_000, MAX_SAMPLES))
            state["lastUpdate"] = timestamp
            state["cycle"] = cycle
            last_save = state["lastSave"]
            if last_save is None or timestamp - last_save >= settings["saveInterval"] * 60_000:
                total = sum(device["traffic"] for device in state["devices"])
                self.db.execute("DELETE FROM legacy_alerts WHERE timestamp < ?", (timestamp - settings["historyRetention"] * 86_400_000,))
                self.event(state, "Registro periódico de actividad", f"Tráfico simulado: {total:.1f} MB.")
                state["lastSave"] = timestamp
            self.trim(state)
            self.write("state", state)
            self.last_count = len(received)
            return allowed
