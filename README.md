# IoTSentinel

**Monitor de seguridad para redes de sensores IoT domésticas**

## Descripción

IoTSentinel es un software que actúa como **gateway de seguridad** entre los dispositivos IoT del hogar (cámaras, focos, enchufes, sensores) y el router de internet. Centraliza la comunicación mediante **MQTT**, cifra el tráfico entre cada sensor y el gateway con un esquema propio de bajo consumo (**IoTS-Crypt**), y analiza continuamente el comportamiento de cada dispositivo para detectar anomalías —como patrones de botnet o conexiones no autorizadas— alertando al usuario en tiempo real a través de un dashboard simple, pensado para personas sin conocimientos técnicos de redes.

El proyecto surge porque muchos dispositivos IoT domésticos conservan contraseñas de fábrica y comunicación sin cifrar, lo que los convierte en blancos fáciles de botnets (como Mirai) y en riesgo para la privacidad del hogar. IoTSentinel busca dar visibilidad y protección sin que el usuario necesite experiencia técnica.

## Estado del proyecto

Versión v0.1 — etapa de propuesta y diseño (TRL 2–3), previa a la implementación del prototipo.

## Equipo desarrollador

- [Chavez Perez Janlennart](https://github.com/janlennartchp$0)
- [Llaza Sanchez Joseph](https://github.com/JosephLl06$0)
- [Menacho Canales John](https://github.com/This-eSau01$0)
- [Rondan Medina Salvador](https://github.com/SalvadorRondan160506$0)

## Tecnologías utilizadas

- **MQTT** (broker **Mosquitto**) — mensajería entre dispositivos y gateway.
- **IoTS-Crypt** — cifrado autenticado ligero, propio del proyecto, para el enlace sensor–gateway.
- **IoTS-KEX** — intercambio de claves basado en curvas elípticas para el aprovisionamiento inicial.
- **TLS 1.3** — cifrado del tráfico saliente hacia internet.
- **JSON** — formato de codificación de mensajes.
- **Raspberry Pi** — plataforma del gateway.
- **ESP32** (o simulación por software) — dispositivos sensores de prueba.

## Requisitos

- 1 Raspberry Pi (gateway de seguridad).
- Al menos 3 microcontroladores ESP32, o dispositivos IoT simulados por software.
- 1 router WiFi de pruebas.
- Broker MQTT (Mosquitto) instalado.
- Librerías criptográficas necesarias para el esquema IoTS-Crypt.
- Python 3 (o el entorno de ejecución definido para el gateway).

## Instalación y ejecución

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/usuario/iotsentinel.git
   cd iotsentinel
   ```
2. Instalar el broker MQTT (Mosquitto) en el Raspberry Pi que hará de gateway:
   ```bash
   sudo apt update
   sudo apt install mosquitto mosquitto-clients
   ```
3. Instalar las dependencias del proyecto (gateway y módulo de análisis):
   ```bash
   pip install -r requirements.txt
   ```
4. Configurar los dispositivos ESP32 (o simulados) con las credenciales de aprovisionamiento (IoTS-KEX) para registrarse en el gateway.
5. Iniciar el gateway de seguridad:
   ```bash
   python main.py
   ```
6. Acceder al dashboard de alertas desde el navegador para visualizar el estado de la red y los dispositivos conectados.
---

*Universidad Católica de Santa María — Escuela Profesional de Ingeniería de Sistemas — Computación en Red III*
