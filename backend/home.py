"""Inventario y perfiles del hogar simulado."""
PROFILES = {
    "Cámara IP": {"maxMessages": 18, "destinations": ["grabador.local"]},
    "Sensor": {"maxMessages": 8, "destinations": ["gateway.local"]},
    "Iluminación": {"maxMessages": 7, "destinations": ["gateway.local"]},
    "Enchufe IoT": {"maxMessages": 8, "destinations": ["gateway.local"]},
    "Timbre inteligente": {"maxMessages": 14, "destinations": ["grabador.local"]},
    "Cerradura inteligente": {"maxMessages": 6, "destinations": ["gateway.local"]},
    "Televisor inteligente": {"maxMessages": 20, "destinations": ["multimedia.local"]},
    "Altavoz inteligente": {"maxMessages": 12, "destinations": ["audio.local"]},
    "Robot aspirador": {"maxMessages": 10, "destinations": ["gateway.local"]},
    "Termostato": {"maxMessages": 6, "destinations": ["gateway.local"]},
    "Desconocido": {"maxMessages": 0, "destinations": []},
}

HOME = [
    (101, "Cámara principal", "Cámara IP", "Entrada"),
    (102, "Sensor de movimiento", "Sensor", "Pasaje"),
    (103, "Foco inteligente", "Iluminación", "Sala"),
    (104, "Enchufe inteligente", "Enchufe IoT", "Cocina"),
    (105, "Cámara de cochera", "Cámara IP", "Cochera"),
    (106, "Cámara de pasaje", "Cámara IP", "Pasaje"),
    (107, "Timbre con cámara", "Timbre inteligente", "Entrada"),
    (108, "Cerradura de la puerta principal", "Cerradura inteligente", "Entrada"),
    (109, "Smart TV de la sala", "Televisor inteligente", "Sala"),
    (110, "Altavoz de la sala", "Altavoz inteligente", "Sala"),
    (111, "Robot aspirador", "Robot aspirador", "Sala"),
    (112, "Termostato del dormitorio", "Termostato", "Dormitorio"),
    (113, "Sensor de apertura de ventana", "Sensor", "Dormitorio"),
    (114, "Enchufe de la cochera", "Enchufe IoT", "Cochera"),
    (150, "Dispositivo desconocido", "Desconocido", "Sin identificar"),
]
