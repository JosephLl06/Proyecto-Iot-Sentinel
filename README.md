# IoTSentinel

Monitor de seguridad para dispositivos IoT simulados. El simulador, el broker MQTT, el backend y el panel web se ejecutan en una sola computadora. La demo funciona sin hardware, router de pruebas ni servicios externos.

## Abrir la aplicación

- **Windows x64**: extrae el paquete completo y abre `IoTSentinel.exe`. En el primer arranque, el ejecutable pide permiso para confiar en el certificado HTTPS local de esta instalación. Teclea `s` en la consola si deseas instalarlo para tu usuario. Mantén abierta la consola mientras uses el panel.
- En el primer inicio, crea un administrador local con un correo y una contraseña de al menos ocho caracteres. Puedes usar un correo de prueba como `demo@example.test`.
- El sistema guarda su base de datos en `%LOCALAPPDATA%\IoTSentinel` en Windows o en `~/.local/share/IoTSentinel` en Linux. La opción `--data-dir` permite usar una carpeta distinta.

## Qué demostrar

1. Abre **Monitoreo de red**. El simulador genera lecturas cada cinco segundos por defecto.
2. En **Alertas de seguridad** aparecen un dispositivo desconocido, un pico de volumen, una frecuencia anormal y un destino no habitual. Espera dos ciclos si tienes la configuración por defecto.
3. En **Dispositivos IoT**, bloquea la cámara. El backend deja de generar telemetría para ese dispositivo dentro del laboratorio.
4. Abre **Historial de eventos** para ver el registro. Cierra y vuelve a ejecutar la aplicación para comprobar que el estado se conserva.

El tráfico es sintético y las alertas corresponden a reglas de simulación. El bloqueo se aplica a los dispositivos virtuales. El programa funciona en la interfaz local de la computadora y no inspecciona redes ni configura routers. La demo no atribuye un pico de tráfico a una botnet.

## HTTPS del panel

El navegador y la API usan exclusivamente HTTPS con TLS 1.3 en `127.0.0.1`. IoTSentinel crea un certificado por instalación. La raíz tiene una restricción de nombre para la dirección local y su clave privada se descarta después de firmar el certificado del panel. La cookie de sesión tiene `Secure`, `HttpOnly` y `SameSite=Strict`. La API exige que las acciones del panel provengan de su propio origen HTTPS.

En Windows, la instalación de confianza es opcional y se realiza en el almacén del usuario actual. Para retirarla, abre `certmgr.msc` y elimina la raíz **IoTSentinel Local** que corresponde a la huella de tu instalación. En Linux puedes importar el archivo público `https/iotsentinel-local.crt` en el almacén de tu navegador. La aplicación muestra la ruta en la consola. Si el certificado caduca, retira la raíz anterior y renombra la carpeta `https` con la aplicación cerrada. El siguiente inicio genera otro certificado y conserva la base de datos.

## Cómo funciona

El simulador publica las muestras en MQTT y el gateway las recibe de un broker aMQTT integrado. El transporte interno usa TLS 1.3 con certificados locales. Cada dispositivo virtual cifra sus muestras con AES-GCM y una clave de sesión independiente derivada con X25519 y HKDF. El intercambio de claves se realiza dentro del programa, entre los roles de simulador y gateway. Los esquemas IoTS-Crypt e IoTS-KEX de la propuesta original se sustituyeron en la demo por estas primitivas estándar y no se usa una conexión saliente a internet durante la ejecución.

El backend comprueba la autorización y compara el volumen, la cantidad de mensajes por intervalo y el destino con los perfiles de referencia. Los destinos se representan como etiquetas sintéticas y nunca se contactan. Guarda el estado, alertas, historial y preferencias en SQLite. El panel React consulta la API local y permite gestionar los dispositivos. La contraseña del administrador se verifica con un resumen scrypt con sal. Al reiniciar el programa hay que volver a iniciar sesión.

| Archivo | Responsabilidad |
| --- | --- |
| `main.py` | Inicia el gateway y sirve la API y el panel. |
| `backend/https_identity.py` | Certificados locales y configuración de confianza para el panel. |
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

El resultado queda en `dist/IoTSentinel.exe` en Windows y `dist/IoTSentinel` en Linux. El flujo **Compilar IoTSentinel** de GitHub Actions construye y verifica ambos formatos. Para compartir la demo, descarga el ejecutable generado por ese flujo o el ZIP portátil. El ZIP portátil necesita sus carpetas adjuntas.

## Equipo desarrollador

- [Chavez Perez Janlennart](https://github.com/janlennartchp)
- [Llaza Sanchez Joseph](https://github.com/JosephLl06)
- [Menacho Canales John](https://github.com/This-eSau01)
- [Rondan Medina Salvador](https://github.com/SalvadorRondan160506)
- [Valdivia Rodriguez Joaquin](https://github.com/JoaquinValdivia1)

Universidad Católica de Santa María · Ingeniería de Sistemas · Computación en Red III

El dossier plantea Mosquitto, un gateway físico y tráfico saliente hacia internet. Esta versión adapta ese diseño a una prueba de concepto de software con aMQTT y datos sintéticos. La validación de redes domésticas reales y el rendimiento de hardware quedan fuera de la demo.
