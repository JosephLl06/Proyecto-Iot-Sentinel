# IoTSentinel

Monitor de seguridad para dispositivos IoT simulados. El simulador, el broker MQTT, el backend y el panel web se ejecutan en una sola computadora. La demo funciona sin hardware, router de pruebas ni servicios externos.

## Abrir la aplicación

- **Windows x64**: extrae el paquete completo y abre `IoTSentinel.exe`. En el primer arranque, el ejecutable pide permiso para confiar en el certificado HTTPS local de esta instalación. Teclea `s` en la consola si deseas instalarlo para tu usuario. Una vez iniciado el gateway puedes cerrar el navegador y la consola. El proceso de simulación continúa en tu sesión de Windows. Vuelve a abrir el mismo ejecutable para consultar el panel activo.
- En el primer inicio, crea un administrador local con un correo y una contraseña de al menos doce caracteres. Puedes usar un correo de prueba como `demo@example.test`.
- El sistema guarda su base de datos en `%LOCALAPPDATA%\IoTSentinel` en Windows o en `~/.local/share/IoTSentinel` en Linux. La opción `--data-dir` permite usar una carpeta distinta.

## Simulación continua y desinstalación

Los 15 dispositivos virtuales generan telemetría a través de MQTT mientras el gateway está encendido. El intervalo inicial es de 5 segundos. En **Monitoreo de red** se ven la hora de actualización y los ciclos completados. El backend continúa si cierras sesión en el panel o el navegador. Una pausa manual se conserva al volver a abrir la aplicación. La suspensión, el apagado y el cierre de sesión de Windows interrumpen la simulación. Al reanudar se registran las nuevas lecturas y queda visible el intervalo sin actividad.

- Para ver la simulación abre **IoTSentinel/IoTSentinel.exe**. Cada ciclo combina actividad habitual con señales automáticas en distintos momentos. Por ejemplo, la cámara de cochera registra un pico, la cerradura recibe una identidad desconocida y el televisor informa de un destino fuera de su perfil. Son datos de prueba locales. Las alertas del último intervalo aparecen en el panel principal y permiten abrir el caso.
- Para quitar la aplicación, abre **Desinstalar IoTSentinel.exe**, junto a la carpeta **IoTSentinel**. Pulsa Intro para elegir esa carpeta. Para desinstalar la edición anterior que incluía los tres archivos CMD, pega la ruta completa de esa copia cuando se solicite la carpeta. Comprueba las rutas y escribe **DESINSTALAR** para eliminar la aplicación seleccionada y los datos predeterminados compartidos por las copias de este usuario. El desinstalador coordina el cierre, retira la raíz HTTPS propia y quita la entrada de inicio automático anterior. La copia de Microsoft Authenticator en el teléfono se administra desde ese teléfono.
- El ejecutable de desinstalación se distribuye por separado de los archivos que retira; al terminar puedes borrar ese ejecutable y el ZIP. La entrega académica carece de firma de editor. La ejecución en cada PC depende de sus controles de aplicaciones.
- Se conservan archivos personales añadidos, archivos de programa modificados, informes exportados y el ZIP original. Las copias extraídas en otras carpetas y los directorios personalizados usados mediante `--data-dir` quedan fuera de esta operación.

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

### Interpretar los gráficos

En **Panel principal**, localiza la hora y el valor del pico. Las barras indican cuánto aportaron los tres equipos principales al total del hogar en ese mismo intervalo. Pulsa un nombre para consultar su perfil y los umbrales históricos. La mediana resume el nivel central observado cuando existen tres o más intervalos. Un pico puede ocurrir aunque todas las lecturas sean admitidas.

En **Monitoreo de red**, selecciona un equipo, el indicador y una ventana de 5, 15 o 30 minutos. Al filtrar un equipo, el instante del pico corresponde a su serie individual. Los porcentajes de aporte siguen referidos al hogar en ese instante. La segunda gráfica divide la ventana en seis tramos: muestra las lecturas retenidas frente a todas las evaluadas para la selección. “Sin datos” indica falta de decisiones registradas. Una lectura retenida cuenta cada vez que el gateway la detecta, aunque pertenezca a un caso ya abierto.

## HTTPS del panel

El navegador y la API usan exclusivamente HTTPS con TLS 1.3 en `127.0.0.1`. IoTSentinel crea un certificado por instalación. La raíz tiene una restricción de nombre para la dirección local y su clave privada se descarta después de firmar el certificado del panel. La cookie de sesión tiene `Secure`, `HttpOnly` y `SameSite=Strict`. La API exige que las acciones del panel provengan de su propio origen HTTPS. La sesión caduca tras 15 minutos sin interacción o cuatro horas desde el inicio. La consulta automática del panel no renueva la sesión. Tras cinco credenciales incorrectas, el servidor espera 30 segundos y registra el evento.

En Windows, la instalación de confianza es opcional y se realiza en el almacén del usuario actual. Para retirarla, abre `certmgr.msc` y elimina la raíz **IoTSentinel Local** que corresponde a la huella de tu instalación. En Linux puedes importar el archivo público `https/iotsentinel-local.crt` en el almacén de tu navegador. La aplicación muestra la ruta en la consola. Si el certificado caduca, retira la raíz anterior y renombra la carpeta `https` con la aplicación cerrada. El siguiente inicio genera otro certificado y conserva la base de datos.

## Cómo funciona

En Windows y Linux, el broker aMQTT se inicia dentro del proceso del backend. El paquete portátil prescinde de mosquitto.exe, el componente señalado por el evento 3077 de Windows. Extrae la actualización en una carpeta nueva con la versión anterior cerrada y conserva los datos de tu usuario. La política de ejecución de tu equipo sigue vigente y puede evaluar otros componentes. El broker escucha en la interfaz local, exige TLS 1.3 y certificados de cliente emitidos en cada arranque. En el tema de telemetría solo el simulador puede publicar y solo el gateway puede suscribirse y recibir. El dossier especifica Mosquitto. Para demostrar esa configuración, usa una instalación autorizada y pásale su ruta al backend, por ejemplo desde la carpeta extraída en PowerShell: `.\runtime\python.exe main.py --mosquitto "C:\Program Files\mosquitto\mosquitto.exe"`. El panel muestra cuál está activo en Monitoreo de red.

El [informe técnico](docs/IoTSentinel_Informe_Tecnico.pdf) incluye una lectura comentada de los gráficos en su última página.

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

## Investigación, evidencia y pruebas de esta edición

En **Monitoreo de red**, selecciona un equipo para consultar la mediana de volumen, las muestras normales acumuladas, los destinos y el límite de mensajes. **Estado de protección** muestra el estado del broker, el último intercambio confirmado y los contadores de fallos desde el arranque. Usa **Pruebas controladas** para generar un pico, un destino desconocido o una identidad no autorizada en la siguiente lectura de un equipo virtual activo. El historial vincula la programación con la detección y su caso.

Al aislar desde un caso se guardan hasta 12 lecturas anteriores al inicio, hasta 12 entre la detección y la medida, y los 12 primeros ciclos observados después. Una ausencia de lectura queda identificada como tal. Al desbloquear el dispositivo en el inventario se conserva la hora de restablecimiento y se registra la primera anomalía posterior. En Monitoreo y en el detalle del caso se puede exportar la vista mediante el botón de PDF y la opción **Guardar como PDF** del navegador.

Para validar el paquete de escritorio en Windows x64, ejecuta desde la raíz del repositorio el comando `runtime\python.exe -m scripts.check_windows_portable`. La prueba inicia el lanzador incluido desde otra carpeta, crea datos temporales, comprueba HTTPS, TOTP, aMQTT y lecturas de 15 equipos, y cierra los procesos de la prueba. GitHub Actions también ejecuta esta comprobación en el trabajo Windows.

## Entrega CR3

Los manuales de usuario y despliegue y el documento de propuesta y demostración están en `docs`. La guía de despliegue incluye la edición reproducible con Git y la conexión entre dos computadoras. Al iniciar el receptor optativo, intercambia exclusivamente certificados públicos; guarda las claves privadas de cada identidad en su equipo. La lectura de CPU del proceso y el tamaño y la huella de cada lote se miden durante el envío. La red privada de enseñanza debe permitir la conexión entre los dos equipos.

En la pantalla de ingreso, **Olvidé mi contraseña** requiere el correo, la clave de recuperación de contraseña de 64 caracteres y un código nuevo del autenticador. El cambio invalida las sesiones y respaldos anteriores. En el siguiente acceso se generan los nuevos respaldos. Las cuentas de ediciones anteriores reciben la clave de recuperación al completar una autenticación válida en esta edición.
