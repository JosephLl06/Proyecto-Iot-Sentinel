"""Muestra un sobre de prueba recibido por MQTT y la lectura autenticada recuperada."""
import asyncio
import json
import tempfile
from backend.mqtt_link import Telemetry


async def run():
    with tempfile.TemporaryDirectory() as folder:
        mqtt = Telemetry()
        await mqtt.start(folder)
        try:
            sample = {"id": "sensor-demostracion", "mensajes": 3}
            def display(envelope, decoded):
                print("Sobre recibido (nonce y cifrado autenticado, Base64):", envelope)
                print("JSON recuperado:", json.dumps(decoded, ensure_ascii=False))
            decoded = await mqtt.exchange([sample], evidence=display)
            if decoded != [sample]:
                raise RuntimeError("La lectura recibida difiere de la enviada.")
            print("Coincidencia verificada después del transporte MQTT con mTLS.")
        finally:
            await mqtt.close()


if __name__ == "__main__":
    asyncio.run(run())
