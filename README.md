# IoTSentinel

Monitor de seguridad para dispositivos IoT simulados. El simulador, el broker MQTT, el backend y el panel web se ejecutan en una sola computadora. La demo funciona sin hardware, router de pruebas ni servicios externos.

## Abrir la aplicación

- **Windows x64**: extrae el paquete completo y abre `IoTSentinel.exe`. En el primer arranque, el ejecutable pide permiso para confiar en el certificado HTTPS local de esta instalación. Teclea `s` en la consola si deseas instalarlo para tu usuario. Mantén abierta la consola mientras uses el panel.
- En el primer inicio, crea un administrador local con un correo y una contraseña de al menos doce caracteres. Puedes usar un correo de prueba como `demo@example.test`.
- El sistema guarda su base de datos en `%LOCALAPPDATA%\IoTSentinel` en Windows o en `~/.local/share/IoTSentinel` en Linux. La opción `--data-dir` permite usar una carpeta distinta.

## Acceso con Microsoft Authenticator

1. Ingresa el correo y la contraseña de tu cuenta local. Si vienes de la versión anterior, usa las mismas credenciales. El inventario, historial y preferencias se conservan.
2. En el teléfono abre Microsoft Authenticator, pulsa **+ → Otra cuenta** y escanea el QR de IoTSentinel. Para completar la vinculación, introduce el código de seis dígitos que muestra el teléfono.
3. Guarda los ocho códigos de respaldo antes de continuar. El panel los muestra una sola vez. En accesos posteriores se solicita contraseña y código del autenticador. El alta y la verificación son locales y no requieren cuenta de Microsoft.
4. Si cambias o pierdes el teléfono, ingresa la contraseña, selecciona **Usar un código de respaldo** y vincula el nuevo autenticador. Al confirmar el nuevo código, se invalidan el autenticador anterior y todos los respaldos antiguos. Si pierdes tanto el autenticador como los respaldos, la aplicación no puede recuperar esa cuenta.

Configura la fecha y hora automáticas en ambos equipos. El código cambia cada 30 segundos, se acepta un intervalo de desfase y una lectura aceptada no puede reutilizarse. Después de cinco códigos incorrectos, la aplicación registra el evento y limita temporalmente los intentos. La sesión del panel solo se crea después de confirmar el segundo factor.

## Del pico a la medida

1. Abre **Panel principal**. El gráfico muestra el tráfico de los últimos cinco minutos. **Qué atender primero** ordena los casos por severidad y última detección. Un aviso permite abrir un caso nuevo de riesgo alto desde cualquier pantalla con las notificaciones activadas.
2. En **Monitoreo de red**, elige la cámara de cochera. Compara el pico con el umbral que aplicó el gateway en ese intervalo. Para el sensor de movimiento, cambia a **Mensajes**. Los puntos rosados identifican muestras con anomalías y **Abrir caso** lleva a la investigación correspondiente. La vista indica si se pausó el monitoreo o si las muestras están atrasadas.
3. En **Alertas de seguridad**, filtra por estado, tipo y severidad. Abre un caso para consultar equipo, zona en el inventario, IP, primera y última detección, volumen, mensajes y destino frente a los valores esperados. La lectura de una alerta y su resolución son decisiones independientes.
4. Selecciona **Iniciar revisión**. Si decides **Aislar equipo**, confirma el nombre. El simulador detiene las publicaciones de ese equipo. **Resolver con nota** registra tu conclusión. **Reabrir caso** reactiva su seguimiento. Para restablecer las lecturas, desbloquea el equipo en el inventario. El historial conserva usuario, hora, medida y nota.
5. Tras una actualización, los avisos antiguos del mismo tipo se agrupan cuando el nombre y el tipo identifican un único dispositivo del inventario. Los registros originales se conservan durante la retención configurada. Los avisos ambiguos mantienen su detalle y se pueden revisar o cerrar. Las decisiones y las lecturas recientes se conservan al reiniciar.

El hogar inicial tiene 15 dispositivos virtuales. Las lecturas de cada equipo pueden ser admitidas o retenidas. Cerrar un caso permite que una nueva detección abra otro. El aislamiento solo afecta a ese dispositivo en este gateway. El banco de pruebas usa telemetría JSON sintética y direcciones reservadas de ejemplo.

## HTTPS del panel

El navegador y la API usan exclusivamente HTTPS con TLS 1.3 en `127.0.0.1`. IoTSentinel crea un certificado por instalación. La raíz tiene una restricción de nombre para la dirección local y su clave privada se descarta después de firmar el certificado del panel. La cookie de sesión tiene `Secure`, `HttpOnly` y `SameSite=Strict`. La API exige que las acciones del panel provengan de su propio origen HTTPS. La sesión caduca tras 15 minutos sin interacción o cuatro horas desde el inicio. La consulta automática del panel no renueva la sesión. Tras cinco credenciales incorrectas, el servidor espera 30 segundos y registra el evento.

En Windows, la instalación de confianza es opcional y se realiza en el almacén del usuario actual. Para retirarla, abre `certmgr.msc` y elimina la raíz **IoTSentinel Local** que corresponde a la huella de tu instalación. En Linux puedes importar el archivo público `https/iotsentinel-local.crt` en el almacén de tu navegador. La aplicación muestra la ruta en la consola. Si el certificado caduca, retira la raíz anterior y renombra la carpeta `https` con la aplicación cerrada. El siguiente inicio genera otro certificado y conserva la base de datos.

## Cómo funciona

El paquete Windows incluye **Eclipse Mosquitto 2.1.4**. El simulador publica en MQTT y el gateway se suscribe al tema de telemetría. El broker escucha en un puerto local, usa TLS 1.3, exige certificados de cliente y restringe las operaciones por rol. Las credenciales del broker, del publicador y del suscriptor se generan por arranque. En Linux el arranque básico utiliza el broker integrado aMQTT. Para usar Mosquitto instalado, ejecuta `python main.py --mosquitto /usr/sbin/mosquitto`.

**IoTS-KEX v1** implementa el emparejamiento de los roles simulados mediante X25519 y HKDF-SHA256. Cada dispositivo recibe una clave independiente por sesión. **IoTS-Crypt v1** define un formato de mensaje versionado con ChaCha20-Poly1305, nonce de 96 bits, identificador de lote, tema y dispositivo autenticados. El gateway comprueba el lote y la identidad antes de procesar el JSON. Estas son decisiones de implementación del esquema descrito en el dossier. El emparejamiento ocurre dentro del simulador.

El detector evalúa la autorización, el destino y los límites de frecuencia y volumen. Tras 12 lecturas admitidas, calcula el límite personal con la mediana y la desviación absoluta mediana de las últimas 36 muestras normales. El umbral global fija el máximo. Dos intervalos consecutivos con frecuencia excesiva hacia un destino desconocido generan una señal de **posible patrón de botnet**. Una sola señal requiere investigación. La misma regla y el mismo dispositivo actualizan el caso abierto y su contador. Las lecturas retenidas se excluyen del aprendizaje y del reenvío.

SQLite conserva estado, casos, medidas, preferencias y hasta 360 intervalos de las últimas 24 horas. El gráfico de cada dispositivo usa los límites históricos guardados con la muestra. Los datos anteriores a esta edición conservan las métricas disponibles. La sesión se protege con una contraseña verificada mediante scrypt y un segundo factor.

### Salida opcional por HTTPS

Por defecto todos los datos quedan en el equipo. Para enviar telemetría admitida a un receptor propio se debe configurar explícitamente `--relay-url https://mi-receptor.example/lecturas`. Con una autoridad privada, agrega `--relay-ca ruta/al/ca.pem`. En el ZIP se pueden pasar estas opciones con `runtime\python.exe main.py` desde su carpeta. El destino es fijo, requiere un certificado válido para el nombre y TLS 1.3. La aplicación envía por POST el instante y las lecturas admitidas, muestra lotes entregados, fallidos y omitidos en Monitoreo. Los registros anómalos permanecen locales. El reenvío es de mejor esfuerzo, sin redirecciones ni reintentos automáticos.

| Archivo | Responsabilidad |
| --- | --- |
| `main.py` | Inicia el gateway y sirve la API y el panel. |
| `backend/authenticator.py` | TOTP, códigos de respaldo y cifrado del secreto con una clave derivada de la contraseña. |
| `backend/https_identity.py` | Certificados locales y configuración de confianza para el panel. |
| `backend/mqtt_link.py` | Broker, publicación, suscripción y cifrado de telemetría. |
| `backend/home.py` | Inventario, zonas y perfiles del hogar simulado. |
| `frontend/src/MonitoringCharts.jsx` | Tendencia, ranking y severidad a partir de la API. |
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

## Validación del dossier

Desde la raíz, `python scripts/check_demo.py` comprueba acceso, TLS, alertas, acciones y persistencia. `python -m scripts.check_gateway --mosquitto /ruta/al/mosquitto` ejecuta el flujo con un receptor HTTPS local y verifica qué lecturas le llegan. `python -m scripts.measure_gateway` mide la mediana y el percentil 95 del cifrado, descifrado y detección por lectura en el equipo de ejecución. Excluye red, serialización y almacenamiento de la medición. Para la validación de desempeño que propone el dossier se debe repetir en el hardware de bajos recursos seleccionado. El prototipo de escritorio cubre los dispositivos simulados y la telemetría que atraviesa su gateway. La integración con un router doméstico, cámaras físicas o flujos multimedia requiere un despliegue específico.

## Relación con los manuales

Se conservan el panel principal, el inventario, el monitoreo, las alertas, el historial y la configuración. La validación de acceso descrita en el manual de usuario se amplía con una cuenta verificada por el backend y un segundo factor. El arranque portátil y el flujo de compilación concretan el despliegue local descrito en el manual. Las señales y perfiles se generan en software para demostrar el análisis sin acceder a la red doméstica.
