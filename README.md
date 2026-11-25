# IoTSentinel

Monitor de seguridad para dispositivos IoT simulados. El simulador, el broker MQTT, el backend y el panel web se ejecutan en una sola computadora. La demo funciona sin hardware, router de pruebas ni servicios externos.

## Abrir la aplicación

- **Windows x64**: extrae el paquete completo y abre `IoTSentinel.exe`. El navegador se abre automáticamente. Mantén abierta la consola mientras uses el panel.
- En el primer inicio, crea un administrador local con un correo y una contraseña de al menos ocho caracteres. Puedes usar un correo de prueba como `demo@example.test`.
- El sistema guarda su base de datos en `%LOCALAPPDATA%\IoTSentinel` en Windows o en `~/.local/share/IoTSentinel` en Linux. La opción `--data-dir` permite usar una carpeta distinta.

## Qué demostrar

1. Abre **Monitoreo de red**. El simulador genera lecturas cada cinco segundos por defecto.
2. En **Alertas de seguridad** aparecen el dispositivo desconocido y el aumento de tráfico de la cámara cuando se supera el umbral de 5 MB.
3. En **Dispositivos IoT**, bloquea la cámara. El backend deja de generar telemetría para ese dispositivo dentro del laboratorio.
4. Abre **Historial de eventos** para ver el registro. Cierra y vuelve a ejecutar la aplicación para comprobar que el estado se conserva.

El tráfico es sintético y las alertas corresponden a reglas de simulación. El bloqueo se aplica a los dispositivos virtuales. El programa funciona en la interfaz local de la computadora y no inspecciona redes ni configura routers. La demo no atribuye un pico de tráfico a una botnet.

## Cómo funciona

El simulador publica las muestras en MQTT y el gateway las recibe de un broker aMQTT integrado. El transporte interno usa TLS 1.3 con certificados locales. El contenido de las muestras también se cifra con AES-GCM y claves de sesión derivadas con X25519 y HKDF. El intercambio de claves se realiza dentro del programa, entre los roles de simulador y gateway. Los esquemas IoTS-Crypt e IoTS-KEX de la propuesta original se sustituyeron en la demo por estas primitivas estándar y no se usa una conexión saliente a internet durante la ejecución.

El backend compara las muestras con el umbral y verifica la autorización de cada dispositivo. Guarda el estado, alertas, historial y preferencias en SQLite. El panel React consulta la API local y permite gestionar los dispositivos. La contraseña del administrador se verifica con un resumen scrypt con sal. Al reiniciar el programa hay que volver a iniciar sesión.

| Archivo | Responsabilidad |
| --- | --- |
| `main.py` | Inicia el gateway y sirve la API y el panel. |
| `backend/mqtt_link.py` | Broker, publicación, suscripción y cifrado de telemetría. |
| `backend/state.py` | Dispositivos virtuales, reglas, preferencias y almacenamiento. |
| `frontend/src/App.jsx` | Pantallas del panel y llamadas a la API. |
| `scripts/check_demo.py` | Comprueba el recorrido desde el arranque hasta la persistencia. |

## Ejecutar desde el código

Requiere Python 3.12 y Node.js 24 para compilar. Ejecuta desde la carpeta del repositorio.

```bash
python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
python main.py
```

Para producir un ejecutable autónomo de un solo archivo, ejecuta estos comandos en el sistema operativo objetivo.

```bash
python -m pip install -r requirements-build.txt
python scripts/build_executable.py
```

El resultado queda en `dist/IoTSentinel.exe` en Windows y `dist/IoTSentinel` en Linux. El flujo **Compilar IoTSentinel** de GitHub Actions también construye y verifica ambos formatos.

## Equipo desarrollador

- [Chavez Perez Janlennart](https://github.com/janlennartchp)
- [Llaza Sanchez Joseph](https://github.com/JosephLl06)
- [Menacho Canales John](https://github.com/This-eSau01)
- [Rondan Medina Salvador](https://github.com/SalvadorRondan160506)
- [Valdivia Rodriguez Joaquin](https://github.com/JoaquinValdivia1)

Universidad Católica de Santa María · Ingeniería de Sistemas · Computación en Red III
