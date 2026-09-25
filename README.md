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

---

*Universidad Católica de Santa María — Escuela Profesional de Ingeniería de Sistemas — Computación en Red III*
