"""Mide cifrado, descifrado y decisión por lectura en el equipo que ejecuta la prueba."""
import argparse
import json
import os
import platform
import statistics
import time

from backend.mqtt_link import ENVELOPE_VERSION, TOPIC, Telemetry
from backend.state import Store, detect, simulated_reading, volume_limit
from cryptography.hazmat.primitives.asymmetric import x25519


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=3000)
    count = parser.parse_args().samples
    if not 100 <= count <= 100000:
        parser.error("Elige entre 100 y 100000 lecturas.")
    device = Store.device("Cámara", "192.0.2.105", "Cámara IP")
    device["normalVolumes"] = [0.8, 1.3, 1.7] * 12
    link = Telemetry()
    link.gateway_key = x25519.X25519PrivateKey.generate()
    link.sender_keys, link.receiver_keys = {}, {}
    link.register(device["id"])
    send, receive = link.sender_keys[device["id"]], link.receiver_keys[device["id"]]
    records = {"cifrado": [], "descifrado": [], "detección": []}
    for i in range(count):
        sample = simulated_reading(device, i, 0)
        plain = json.dumps(sample).encode()
        nonce = os.urandom(12)
        aad = ENVELOPE_VERSION + os.urandom(16) + TOPIC.encode() + device["id"].encode()
        start = time.perf_counter_ns()
        ciphertext = send.encrypt(nonce, plain, aad)
        encrypted = time.perf_counter_ns()
        result = receive.decrypt(nonce, ciphertext, aad)
        decrypted = time.perf_counter_ns()
        detect(device, sample, volume_limit(device, 5))
        end = time.perf_counter_ns()
        assert plain == result
        for key, duration in zip(records, (encrypted-start, decrypted-encrypted, end-decrypted)):
            records[key].append(duration / 1000)
    print(f"{platform.system()} {platform.machine()}, Python {platform.python_version()}, {count} lecturas.")
    for key, values in records.items():
        print(f"{key}: mediana {statistics.median(values):.2f} µs, p95 {statistics.quantiles(values,n=100)[94]:.2f} µs")


if __name__ == "__main__":
    main()
