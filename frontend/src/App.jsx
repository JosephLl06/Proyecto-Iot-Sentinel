import { useEffect, useMemo, useState } from 'react'

const initialDevices = [
  { id: 1, name: 'Cámara principal', ip: '192.168.1.101', type: 'Cámara IP', status: 'Conectado', authorized: true, blocked: false, traffic: 1.2 },
  { id: 2, name: 'Sensor de movimiento', ip: '192.168.1.102', type: 'Sensor', status: 'Conectado', authorized: true, blocked: false, traffic: 0.8 },
  { id: 3, name: 'Foco inteligente', ip: '192.168.1.103', type: 'Iluminación', status: 'Conectado', authorized: true, blocked: false, traffic: 0.3 },
  { id: 4, name: 'Enchufe inteligente', ip: '192.168.1.104', type: 'Enchufe IoT', status: 'Desconectado', authorized: true, blocked: false, traffic: 0 },
  { id: 5, name: 'Dispositivo desconocido', ip: '192.168.1.150', type: 'Desconocido', status: 'Conectado', authorized: false, blocked: false, traffic: 8.7 },
]

const initialAlerts = [
  { id: 1, title: 'Dispositivo no autorizado', detail: 'Dispositivo desconocido · 192.168.1.150', severity: 'Alta', time: 'Hace 5 min', read: false },
  { id: 2, title: 'Tráfico elevado detectado', detail: 'Dispositivo desconocido · 8.7 MB', severity: 'Media', time: 'Hace 12 min', read: false },
  { id: 3, title: 'Dispositivo desconectado', detail: 'Enchufe inteligente · 192.168.1.104', severity: 'Baja', time: 'Hace 25 min', read: true },
]

const menu = [
  { id: 'dashboard', label: 'Panel principal', icon: '▦' },
  { id: 'devices', label: 'Dispositivos IoT', icon: '▤' },
  { id: 'monitoring', label: 'Monitoreo de red', icon: '⌁' },
  { id: 'alerts', label: 'Alertas de seguridad', icon: '♧' },
  { id: 'history', label: 'Historial de eventos', icon: '◷' },
  { id: 'settings', label: 'Configuración', icon: '⚙' },
]

const defaultSettings = {
  refreshInterval: 10,
  saveInterval: 5,
  historyRetention: 30,
  dark: false,
  notifications: true,
  threshold: 5,
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('iotsentinel-settings')
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

function loadHistory() {
  try {
    const saved = localStorage.getItem('iotsentinel-history')
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [page, setPage] = useState('dashboard')
  const [devices, setDevices] = useState(initialDevices)
  const [alerts, setAlerts] = useState(initialAlerts)
  const [events, setEvents] = useState(loadHistory)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('Todos')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIp, setNewIp] = useState('')
  const [newType, setNewType] = useState('Sensor')

  const [settings, setSettings] = useState(loadSettings)
  const [draftSettings, setDraftSettings] = useState(loadSettings)
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [lastSave, setLastSave] = useState(null)
  const [monitoringEnabled, setMonitoringEnabled] = useState(true)

  const connected = devices.filter(
    d => d.status === 'Conectado' && !d.blocked
  ).length

  const authorized = devices.filter(
    d => d.authorized && !d.blocked
  ).length

  const pendingAlerts = alerts.filter(a => !a.read).length

  const traffic = devices.reduce(
    (sum, d) => sum + (d.blocked ? 0 : d.traffic),
    0
  )

  const visibleDevices = useMemo(() => devices.filter(d => {
    const matchesSearch = `${d.name} ${d.ip} ${d.type}`
      .toLowerCase()
      .includes(search.toLowerCase())

    const matchesFilter =
      filter === 'Todos' ||
      (filter === 'Conectados' && d.status === 'Conectado' && !d.blocked) ||
      (filter === 'Desconectados' && (d.status === 'Desconectado' || d.blocked)) ||
      (filter === 'No autorizados' && !d.authorized)

    return matchesSearch && matchesFilter
  }), [devices, search, filter])

  const pageTitle =
    menu.find(item => item.id === page)?.label || 'Panel principal'

  function notify(message) {
    if (!settings.notifications) return
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  function addEvent(title, detail) {
    const now = Date.now()

    const event = {
      id: now,
      title,
      detail,
      time: new Date(now).toLocaleString('es-PE'),
      timestamp: now,
    }

    setEvents(current => {
      const cutoff =
        now - settings.historyRetention * 24 * 60 * 60 * 1000

      const updated = [...current, event].filter(item =>
        !item.timestamp || item.timestamp >= cutoff
      )

      try {
        localStorage.setItem(
          'iotsentinel-history',
          JSON.stringify(updated)
        )
      } catch {
        // Los eventos permanecen disponibles durante la sesión.
      }

      return updated
    })
  }

  // Actualiza la hora mostrada en el monitoreo.
  useEffect(() => {
    if (!monitoringEnabled) return

    const intervalId = window.setInterval(() => {
      setLastUpdate(new Date())
    }, settings.refreshInterval * 1000)

    return () => window.clearInterval(intervalId)
  }, [settings.refreshInterval, monitoringEnabled])

  // Guarda periódicamente un registro de actividad.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now()

      const record = {
        id: now,
        title: 'Registro periódico de actividad',
        detail: `Dispositivos conectados: ${connected}. Tráfico registrado: ${traffic.toFixed(1)} MB.`,
        time: new Date(now).toLocaleString('es-PE'),
        timestamp: now,
      }

      setEvents(current => {
        const cutoff =
          now - settings.historyRetention * 24 * 60 * 60 * 1000

        const updated = [...current, record].filter(item =>
          !item.timestamp || item.timestamp >= cutoff
        )

        try {
          localStorage.setItem(
            'iotsentinel-history',
            JSON.stringify(updated)
          )
        } catch {
          // El registro permanece en el estado de la aplicación.
        }

        return updated
      })

      setLastSave(new Date())
    }, settings.saveInterval * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [
    settings.saveInterval,
    settings.historyRetention,
    connected,
    traffic,
  ])

  function handleLogin(event) {
    event.preventDefault()

    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError('Completa tu correo y contraseña.')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim())) {
      setLoginError('Ingresa un correo electrónico válido.')
      return
    }

    setLoginError('')
    setIsLoggedIn(true)
    setPage('dashboard')

    addEvent(
      'Inicio de sesión',
      `Sesión iniciada con ${loginEmail.trim()}.`
    )
  }

  function handleLogout() {
    setIsLoggedIn(false)
    setLoginPassword('')
    setLoginError('')
    setPage('dashboard')
  }

  function changePage(id) {
    setPage(id)
    setSearch('')
    setFilter('Todos')
  }

  // Bloquea o desbloquea un dispositivo dentro de la aplicación.
  function toggleBlock(id) {
    const device = devices.find(d => d.id === id)
    if (!device) return

    const nextBlocked = !device.blocked

    setDevices(current => current.map(d =>
      d.id === id
        ? {
            ...d,
            blocked: nextBlocked,
            authorized: nextBlocked ? false : d.authorized,
          }
        : d
    ))

    const title = nextBlocked
      ? 'Dispositivo bloqueado'
      : 'Dispositivo desbloqueado'

    const detail = `${device.name} · ${device.ip}`

    setAlerts(current => [{
      id: Date.now(),
      title,
      detail,
      severity: nextBlocked ? 'Alta' : 'Media',
      time: 'Ahora',
      read: false,
    }, ...current])

    addEvent(title, detail)

    notify(
      nextBlocked
        ? `${device.name} ha sido bloqueado en la aplicación.`
        : `${device.name} ha sido desbloqueado en la aplicación.`
    )
  }

  function toggleConnection(id) {
    const device = devices.find(d => d.id === id)
    if (!device) return

    if (device.blocked) {
      notify('Desbloquea primero el dispositivo.')
      return
    }

    const nextStatus = device.status === 'Conectado'
      ? 'Desconectado'
      : 'Conectado'

    setDevices(current => current.map(d =>
      d.id === id ? { ...d, status: nextStatus } : d
    ))

    addEvent(
      nextStatus === 'Conectado'
        ? 'Dispositivo conectado'
        : 'Dispositivo desconectado',
      `${device.name} · ${device.ip}`
    )

    notify(`${device.name}: ${nextStatus.toLowerCase()}.`)
  }

  function addDevice(event) {
    event.preventDefault()

    if (!newName.trim() || !newIp.trim()) {
      notify('Completa el nombre y la dirección IP.')
      return
    }

    if (devices.some(d => d.ip === newIp.trim())) {
      notify('Ya existe un dispositivo con esa dirección IP.')
      return
    }

    const device = {
      id: Date.now(),
      name: newName.trim(),
      ip: newIp.trim(),
      type: newType,
      status: 'Conectado',
      authorized: true,
      blocked: false,
      traffic: 0,
    }

    setDevices(current => [...current, device])

    addEvent(
      'Dispositivo agregado',
      `${device.name} · ${device.ip}`
    )

    setNewName('')
    setNewIp('')
    setNewType('Sensor')
    setShowForm(false)

    notify('Dispositivo agregado correctamente.')
  }

  function markAlertsRead() {
    setAlerts(current => current.map(a => ({
      ...a,
      read: true,
    })))

    notify('Todas las alertas se marcaron como leídas.')
  }

  function updateDraft(key, value) {
    setDraftSettings(current => ({
      ...current,
      [key]: value,
    }))
  }

  function saveSettings(event) {
    event.preventDefault()

    try {
      localStorage.setItem(
        'iotsentinel-settings',
        JSON.stringify(draftSettings)
      )
    } catch {
      notify('No se pudieron guardar las preferencias.')
      return
    }

    setSettings({ ...draftSettings })

    addEvent(
      'Configuración actualizada',
      'Se actualizaron las preferencias del sistema.'
    )

    notify('Preferencias guardadas correctamente.')
  }

  function changeTheme() {
    const updated = {
      ...settings,
      dark: !settings.dark,
    }

    setSettings(updated)
    setDraftSettings(current => ({
      ...current,
      dark: updated.dark,
    }))

    try {
      localStorage.setItem(
        'iotsentinel-settings',
        JSON.stringify(updated)
      )
    } catch {
      // El tema permanece aplicado durante la sesión.
    }
  }

  if (!isLoggedIn) {
    return (
      <>
        <style>{styles}</style>

        <main className="login-screen">
          <form className="login-card" onSubmit={handleLogin}>
            <div className="login-logo">IS</div>
            <p className="eyebrow">SEGURIDAD PARA EL HOGAR</p>
            <h1>IoTSentinel</h1>
            <p className="muted">IoT Security Monitor</p>

            <div className="field">
              <label htmlFor="loginEmail">Correo electrónico</label>
              <input
                id="loginEmail"
                type="email"
                placeholder="admin@iotsentinel.com"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="loginPassword">Contraseña</label>

              <div className="password-field">
                <input
                  id="loginPassword"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Ingresa tu contraseña"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  required
                />

                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowPassword(v => !v)}
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            {loginError && (
              <p className="error-message">{loginError}</p>
            )}

            <button
              className="primary-button full-button"
              type="submit"
            >
              Ingresar
            </button>

            <p className="login-note">
              Ingresa tu correo y contraseña para continuar.
            </p>
          </form>
        </main>
      </>
    )
  }

  return (
    <>
      <style>{styles}</style>

      <div className={`app-shell ${settings.dark ? 'dark-theme' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo">IS</div>

            <div>
              <h2>IoTSentinel</h2>
              <p>IoT Security Monitor</p>
            </div>
          </div>

          <p className="menu-heading">MENÚ PRINCIPAL</p>

          <nav className="navigation">
            {menu.map(item => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => changePage(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>

                {item.id === 'alerts' && pendingAlerts > 0 && (
                  <span className="nav-count">{pendingAlerts}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <div className="gateway-card">
              <p>
                <span className="green-dot" />
                Gateway de seguridad
              </p>
              <strong>Sistema de seguridad</strong>
              <small>Monitoreo de dispositivos IoT</small>
            </div>

            <div className="profile">
              <div className="profile-avatar">AD</div>

              <div className="profile-info">
                <strong>Administrador</strong>
                <small>{loginEmail}</small>
              </div>

              <button
                className="logout-button"
                onClick={handleLogout}
                title="Cerrar sesión"
              >
                ↪
              </button>
            </div>
          </div>
        </aside>

        <main className="main-area">
          <header className="topbar">
            <div className="breadcrumb">
              <span>IoTSentinel</span>
              <span>/</span>
              <strong>{pageTitle}</strong>
            </div>

            <div className="top-actions">
              <span className="system-badge">
                <span className="green-dot" />
                ACTIVO
              </span>

              <button
                className="icon-button"
                onClick={changeTheme}
                title="Cambiar tema"
              >
                {settings.dark ? '☀' : '☾'}
              </button>

              <div className="top-avatar">AD</div>
            </div>
          </header>

          <section className="page-content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">CENTRO DE SEGURIDAD IOT</p>
                <h1>{pageTitle}</h1>
                <p className="page-description">
                  {getDescription(page)}
                </p>
              </div>

              <div className="environment">
                <span className="green-dot" />
                Sistema de monitoreo IoT
              </div>
            </div>

            {page === 'dashboard' && (
              <>
                <div className="stats-grid">
                  <StatCard
                    label="Dispositivos registrados"
                    value={devices.length}
                    detail="En el inventario de la red"
                    icon="▤"
                  />

                  <StatCard
                    label="Dispositivos conectados"
                    value={connected}
                    detail={`${devices.length - connected} desconectados o bloqueados`}
                    icon="⌁"
                  />

                  <StatCard
                    label="Dispositivos autorizados"
                    value={authorized}
                    detail={`${devices.length - authorized} sin autorización`}
                    icon="✓"
                  />

                  <StatCard
                    label="Alertas pendientes"
                    value={pendingAlerts}
                    detail="Requieren revisión"
                    icon="♧"
                  />
                </div>

                <div className="content-grid">
                  <section className="panel">
                    <PanelTitle
                      title="Estado de la red"
                      subtitle="Resumen de los dispositivos registrados"
                    />

                    <div className="network-summary">
                      <div
                        className="network-circle"
                        style={{
                          '--percentage': `${
                            devices.length
                              ? (connected / devices.length) * 100
                              : 0
                          }%`,
                        }}
                      >
                        <strong>
                          {devices.length
                            ? Math.round(
                                (connected / devices.length) * 100
                              )
                            : 0}%
                        </strong>
                        <span>conectados</span>
                      </div>

                      <div className="legend">
                        <p>
                          <span className="legend-dot green" />
                          Conectados
                          <strong>{connected}</strong>
                        </p>

                        <p>
                          <span className="legend-dot orange" />
                          Desconectados
                          <strong>
                            {devices.filter(
                              d => d.status === 'Desconectado' && !d.blocked
                            ).length}
                          </strong>
                        </p>

                        <p>
                          <span className="legend-dot red" />
                          Sin autorización
                          <strong>
                            {devices.filter(
                              d => !d.authorized || d.blocked
                            ).length}
                          </strong>
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="panel">
                    <PanelTitle
                      title="Actividad reciente"
                      subtitle="Últimos eventos registrados"
                    />

                    <div className="activity-list">
                      {[...events].slice(-4).reverse().map(event => (
                        <div className="activity-item" key={event.id}>
                          <span className="activity-dot" />
                          <div>
                            <strong>{event.title}</strong>
                            <p>{event.detail}</p>
                            <small>{event.time}</small>
                          </div>
                        </div>
                      ))}

                      {events.length === 0 && (
                        <EmptyState text="Todavía no hay eventos registrados." />
                      )}
                    </div>
                  </section>
                </div>

                <section className="panel">
                  <PanelTitle
                    title="Dispositivos de la red"
                    subtitle="Vista rápida del inventario"
                    action={
                      <button
                        className="secondary-button"
                        onClick={() => changePage('devices')}
                      >
                        Ver dispositivos →
                      </button>
                    }
                  />

                  <DeviceTable
                    devices={devices.slice(0, 4)}
                    onBlock={toggleBlock}
                    onConnection={toggleConnection}
                  />
                </section>
              </>
            )}

            {page === 'devices' && (
              <section className="panel">
                <PanelTitle
                  title="Inventario de dispositivos"
                  subtitle={`${devices.length} dispositivos registrados`}
                  action={
                    <button
                      className="primary-button"
                      onClick={() => setShowForm(v => !v)}
                    >
                      {showForm ? 'Cancelar' : '+ Agregar dispositivo'}
                    </button>
                  }
                />

                {showForm && (
                  <form className="add-device-form" onSubmit={addDevice}>
                    <div className="field">
                      <label>Nombre del dispositivo</label>
                      <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="Ej. Sensor de puerta"
                        required
                      />
                    </div>

                    <div className="field">
                      <label>Dirección IP</label>
                      <input
                        value={newIp}
                        onChange={e => setNewIp(e.target.value)}
                        placeholder="192.168.1.110"
                        required
                      />
                    </div>

                    <div className="field">
                      <label>Tipo de dispositivo</label>
                      <select
                        value={newType}
                        onChange={e => setNewType(e.target.value)}
                      >
                        <option>Sensor</option>
                        <option>Cámara IP</option>
                        <option>Iluminación</option>
                        <option>Enchufe IoT</option>
                        <option>Desconocido</option>
                      </select>
                    </div>

                    <button className="primary-button" type="submit">
                      Registrar
                    </button>
                  </form>
                )}

                <div className="toolbar">
                  <input
                    className="search-input"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar por nombre, IP o tipo..."
                  />

                  <select
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    aria-label="Filtrar dispositivos"
                  >
                    <option>Todos</option>
                    <option>Conectados</option>
                    <option>Desconectados</option>
                    <option>No autorizados</option>
                  </select>
                </div>

                <DeviceTable
                  devices={visibleDevices}
                  onBlock={toggleBlock}
                  onConnection={toggleConnection}
                />

                <p className="footnote">
                  Administra los dispositivos registrados en tu red.
                </p>
              </section>
            )}

            {page === 'monitoring' && (
              <>
                <div className="stats-grid">
                  <StatCard
                    label="Dispositivos conectados"
                    value={connected}
                    detail="Estado de conexión"
                    icon="⌁"
                  />

                  <StatCard
                    label="Tráfico registrado"
                    value={`${traffic.toFixed(1)} MB`}
                    detail="Tráfico por dispositivo"
                    icon="⇅"
                  />

                  <StatCard
                    label="Umbral de tráfico"
                    value={`${settings.threshold} MB`}
                    detail="Configurado en preferencias"
                    icon="⚙"
                  />
                </div>

                <section className="panel">
                  <PanelTitle
                    title="Monitoreo de red"
                    subtitle="Estado y actualización del monitoreo"
                  />

                  <div className="monitoring-control">
                    <div>
                      <span
                        className={`status-pill ${
                          monitoringEnabled
                            ? 'status-connected'
                            : 'status-disconnected'
                        }`}
                      >
                        {monitoringEnabled
                          ? '● Monitoreo activo'
                          : '● Monitoreo pausado'}
                      </span>

                      <p className="muted">
                        Última actualización: {lastUpdate.toLocaleTimeString('es-PE')}
                      </p>

                      <p className="muted">
                        Actualización cada {settings.refreshInterval} segundos.
                      </p>
                    </div>

                    <button
                      className={
                        monitoringEnabled
                          ? 'secondary-button'
                          : 'primary-button'
                      }
                      onClick={() => setMonitoringEnabled(v => !v)}
                    >
                      {monitoringEnabled
                        ? 'Pausar monitoreo'
                        : 'Reanudar monitoreo'}
                    </button>
                  </div>

                  <div className="monitoring-options">
                    <div className="field">
                      <label>Frecuencia de actualización</label>
                      <select
                        value={draftSettings.refreshInterval}
                        onChange={e =>
                          updateDraft(
                            'refreshInterval',
                            Number(e.target.value)
                          )
                        }
                      >
                        <option value={5}>Cada 5 segundos</option>
                        <option value={10}>Cada 10 segundos</option>
                        <option value={30}>Cada 30 segundos</option>
                        <option value={60}>Cada 60 segundos</option>
                      </select>
                    </div>

                    <p className="muted">
                      Puedes cambiar este intervalo desde Configuración.
                    </p>
                  </div>
                </section>

                <section className="panel">
                  <PanelTitle
                    title="Actividad por dispositivo"
                    subtitle="Tráfico registrado por dispositivo"
                  />

                  {devices.map(device => (
                    <div className="traffic-row" key={device.id}>
                      <div className="traffic-label">
                        <strong>{device.name}</strong>
                        <span>
                          {(device.blocked ? 0 : device.traffic).toFixed(1)} MB
                        </span>
                      </div>

                      <div className="traffic-track">
                        <div
                          className="traffic-fill"
                          style={{
                            width: `${
                              device.blocked
                                ? 0
                                : Math.min(
                                    (device.traffic /
                                      Math.max(settings.threshold, 1)) *
                                      100,
                                    100
                                  )
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </section>
              </>
            )}

            {page === 'alerts' && (
              <section className="panel">
                <PanelTitle
                  title="Alertas de seguridad"
                  subtitle={`${pendingAlerts} alertas pendientes de revisión`}
                  action={
                    <button
                      className="secondary-button"
                      onClick={markAlertsRead}
                    >
                      Marcar todas como leídas
                    </button>
                  }
                />

                {alerts.length === 0 ? (
                  <EmptyState text="No hay alertas registradas." />
                ) : (
                  <div className="alert-list">
                    {alerts.map(alert => (
                      <article
                        className={`alert-item ${alert.read ? 'alert-read' : ''}`}
                        key={alert.id}
                      >
                        <div
                          className={`severity-dot severity-${alert.severity.toLowerCase()}`}
                        />

                        <div className="alert-body">
                          <div className="alert-heading">
                            <strong>{alert.title}</strong>
                            <span
                              className={`severity-label severity-label-${alert.severity.toLowerCase()}`}
                            >
                              {alert.severity}
                            </span>
                          </div>

                          <p>{alert.detail}</p>
                          <small>{alert.time}</small>
                        </div>

                        {!alert.read && (
                          <button
                            className="secondary-button"
                            onClick={() =>
                              setAlerts(current =>
                                current.map(a =>
                                  a.id === alert.id
                                    ? { ...a, read: true }
                                    : a
                                )
                              )
                            }
                          >
                            Marcar leída
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {page === 'history' && (
              <section className="panel">
                <PanelTitle
                  title="Historial de eventos"
                  subtitle={`${events.length} registros guardados`}
                />

                <div className="history-summary">
                  <div>
                    <span>Frecuencia de guardado</span>
                    <strong>Cada {settings.saveInterval} min</strong>
                  </div>

                  <div>
                    <span>Conservación del historial</span>
                    <strong>{settings.historyRetention} días</strong>
                  </div>

                  <div>
                    <span>Último registro periódico</span>
                    <strong>
                      {lastSave
                        ? lastSave.toLocaleTimeString('es-PE')
                        : 'Pendiente'}
                    </strong>
                  </div>
                </div>

                <div className="history-list">
                  {[...events].reverse().map(event => (
                    <article className="history-item" key={event.id}>
                      <div className="history-icon">◷</div>

                      <div>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                        <small>{event.time}</small>
                      </div>
                    </article>
                  ))}

                  {events.length === 0 && (
                    <EmptyState text="Todavía no hay eventos registrados." />
                  )}
                </div>

                <p className="footnote">
                  El historial se guarda en este navegador. Para compartir
                  registros entre equipos, necesitarás una base de datos.
                </p>
              </section>
            )}

            {page === 'settings' && (
              <form className="panel settings-panel" onSubmit={saveSettings}>
                <PanelTitle
                  title="Preferencias de la aplicación"
                  subtitle="Personaliza la apariencia y el funcionamiento del sistema."
                />

                <SettingRow
                  title="Tema oscuro"
                  description="Cambia la apariencia visual de la interfaz."
                >
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={draftSettings.dark}
                      onChange={e => updateDraft('dark', e.target.checked)}
                    />
                    <span className="switch-slider" />
                  </label>
                </SettingRow>

                <SettingRow
                  title="Notificaciones visuales"
                  description="Permite mostrar mensajes al realizar acciones."
                >
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={draftSettings.notifications}
                      onChange={e =>
                        updateDraft('notifications', e.target.checked)
                      }
                    />
                    <span className="switch-slider" />
                  </label>
                </SettingRow>

                <SettingRow
                  title="Umbral de tráfico de referencia"
                  description="Valor utilizado para destacar el tráfico de los dispositivos."
                >
                  <div className="number-control">
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={draftSettings.threshold}
                      onChange={e =>
                        updateDraft(
                          'threshold',
                          Math.max(1, Number(e.target.value))
                        )
                      }
                    />
                    <span>MB</span>
                  </div>
                </SettingRow>

                <div className="info-box">
                  <span>ⓘ</span>
                  <p>
                    Personaliza la interfaz y los parámetros del monitoreo.
                  </p>
                </div>

                <div className="settings-section-heading">
                  <div className="settings-section-icon">◷</div>
                  <div>
                    <h3>Monitoreo y almacenamiento</h3>
                    <p>
                      Configura los intervalos de actualización, guardado
                      y conservación de los registros.
                    </p>
                  </div>
                </div>

                <SettingRow
                  title="Frecuencia de actualización del monitoreo"
                  description="Cada cuánto se actualiza la hora del monitoreo en pantalla."
                >
                  <select
                    className="setting-select"
                    value={draftSettings.refreshInterval}
                    onChange={e =>
                      updateDraft(
                        'refreshInterval',
                        Number(e.target.value)
                      )
                    }
                  >
                    <option value={5}>Cada 5 segundos</option>
                    <option value={10}>Cada 10 segundos</option>
                    <option value={30}>Cada 30 segundos</option>
                    <option value={60}>Cada 60 segundos</option>
                  </select>
                </SettingRow>

                <SettingRow
                  title="Frecuencia de guardado de información"
                  description="Cada cuánto se crea un registro periódico de actividad."
                >
                  <select
                    className="setting-select"
                    value={draftSettings.saveInterval}
                    onChange={e =>
                      updateDraft(
                        'saveInterval',
                        Number(e.target.value)
                      )
                    }
                  >
                    <option value={1}>Cada 1 minuto</option>
                    <option value={5}>Cada 5 minutos</option>
                    <option value={15}>Cada 15 minutos</option>
                    <option value={30}>Cada 30 minutos</option>
                    <option value={60}>Cada hora</option>
                  </select>
                </SettingRow>

                <SettingRow
                  title="Tiempo de conservación del historial"
                  description="Cuánto tiempo se conservan los registros antes de eliminar los antiguos."
                >
                  <select
                    className="setting-select"
                    value={draftSettings.historyRetention}
                    onChange={e =>
                      updateDraft(
                        'historyRetention',
                        Number(e.target.value)
                      )
                    }
                  >
                    <option value={7}>7 días</option>
                    <option value={30}>30 días</option>
                    <option value={90}>90 días</option>
                  </select>
                </SettingRow>

                <div className="info-box">
                  <span>ⓘ</span>
                  <p>
                    Las preferencias y el historial se guardan en el
                    navegador. Para bloquear dispositivos de forma real
                    se necesita conectar el sistema a un router o gateway
                    compatible.
                  </p>
                </div>

                <div className="settings-footer">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDraftSettings({ ...settings })}
                  >
                    Descartar cambios
                  </button>

                  <button className="primary-button" type="submit">
                    Guardar cambios
                  </button>
                </div>
              </form>
            )}

            <footer className="page-footer">
              <span>IoTSentinel © 2026</span>
              <span>Computación en Red III</span>
              <span>
                <span className="green-dot" />
                Seguridad de la red IoT
              </span>
            </footer>
          </section>
        </main>

        {notice && <div className="toast">{notice}</div>}
      </div>
    </>
  )
}

function getDescription(page) {
  const descriptions = {
    dashboard: 'Resumen general del estado de tu red IoT.',
    devices: 'Consulta y administra los dispositivos de tu red.',
    monitoring: 'Consulta el estado y el tráfico de los dispositivos.',
    alerts: 'Revisa los eventos que requieren tu atención.',
    history: 'Consulta los eventos registrados en el sistema.',
    settings: 'Personaliza los parámetros de la aplicación.',
  }

  return descriptions[page] || ''
}

function StatCard({ label, value, detail, icon }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <div className="stat-icon">{icon}</div>
      </div>
      <strong className="stat-value">{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

function PanelTitle({ title, subtitle, action }) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

function SettingRow({ title, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-description">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function DeviceTable({ devices, onBlock, onConnection }) {
  if (!devices.length) {
    return <EmptyState text="No se encontraron dispositivos." />
  }

  return (
    <div className="table-wrap">
      <table className="device-table">
        <thead>
          <tr>
            <th>DISPOSITIVO</th>
            <th>DIRECCIÓN IP</th>
            <th>ESTADO</th>
            <th>AUTORIZACIÓN</th>
            <th>TRÁFICO</th>
            <th>ACCIONES</th>
          </tr>
        </thead>

        <tbody>
          {devices.map(device => (
            <tr key={device.id}>
              <td>
                <div className="device-name-cell">
                  <span className="device-icon">▤</span>
                  <div>
                    <strong>{device.name}</strong>
                    <small>{device.type}</small>
                  </div>
                </div>
              </td>

              <td>
                <span className="ip-address">{device.ip}</span>
              </td>

              <td>
                <span
                  className={`status-pill ${
                    device.blocked
                      ? 'status-unauthorized'
                      : device.status === 'Conectado'
                        ? 'status-connected'
                        : 'status-disconnected'
                  }`}
                >
                  {device.blocked
                    ? 'Bloqueado'
                    : device.status}
                </span>
              </td>

              <td>
                <span
                  className={`status-pill ${
                    device.authorized && !device.blocked
                      ? 'status-connected'
                      : 'status-unauthorized'
                  }`}
                >
                  {device.blocked
                    ? 'Bloqueado'
                    : device.authorized
                      ? 'Autorizado'
                      : 'No autorizado'}
                </span>
              </td>

              <td>
                {(device.blocked ? 0 : device.traffic).toFixed(1)} MB
              </td>

              <td>
                <div className="table-actions">
                  <button
                    className="small-button"
                    onClick={() => onBlock(device.id)}
                  >
                    {device.blocked ? 'Desbloquear' : 'Bloquear'}
                  </button>

                  <button
                    className="small-button"
                    disabled={device.blocked}
                    onClick={() => onConnection(device.id)}
                  >
                    {device.blocked
                      ? 'Bloqueado'
                      : device.status === 'Conectado'
                        ? 'Desconectar'
                        : 'Conectar'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>
}

const styles = `
*{box-sizing:border-box}
body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#253047;background:#f3f6fc}
button,input,select{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
.app-shell{--bg:#f3f6fc;--panel:#fff;--text:#253047;--muted:#8190ab;--border:#e0e7f3;--field:#fff;display:flex;min-height:100vh;background:var(--bg);color:var(--text)}
.sidebar{width:282px;background:#101b2d;color:#c0cadc;padding:28px 18px 16px;display:flex;flex-direction:column;flex-shrink:0}
.brand{display:flex;align-items:center;gap:14px;padding:0 8px 34px}
.brand-logo,.login-logo{width:48px;height:48px;border-radius:13px;background:linear-gradient(135deg,#7566f5,#5144d9);display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px}
.brand h2{margin:0;color:#f8faff;font-size:21px;letter-spacing:-.5px}
.brand p{margin:5px 0 0;font-size:11px;color:#8d9ab2}
.menu-heading{font-size:10px;letter-spacing:1.7px;font-weight:800;color:#76859e;margin:0 11px 15px}
.navigation{display:grid;gap:5px}
.nav-item{border:1px solid transparent;background:transparent;color:#a8b4c9;border-radius:11px;display:flex;align-items:center;gap:14px;text-align:left;padding:14px 13px;min-height:48px;font-size:13px}
.nav-item:hover,.nav-item.active{background:linear-gradient(110deg,rgba(119,102,245,.22),rgba(119,102,245,.08));border-color:rgba(127,113,250,.25);color:#c5bfff}
.nav-icon{width:21px;text-align:center;font-size:16px}
.nav-count{margin-left:auto;background:#f06a77;color:white;border-radius:7px;padding:4px 8px;font-size:11px}
.sidebar-bottom{margin-top:auto}
.gateway-card{border:1px solid #293850;background:#17243a;border-radius:13px;padding:16px;margin-bottom:17px}
.gateway-card p{margin:0 0 15px;font-size:11px;display:flex;align-items:center;gap:8px}
.gateway-card strong,.gateway-card small{display:block}
.gateway-card strong{font-size:12px;color:#e0e6f1;margin-bottom:7px}
.gateway-card small{font-size:11px;color:#8190a7}
.green-dot{display:inline-block;width:8px;height:8px;background:#31c99d;border-radius:50%;flex-shrink:0}
.profile{border-top:1px solid #293850;padding:16px 4px 0;display:flex;align-items:center;gap:10px}
.profile-avatar,.top-avatar{width:40px;height:40px;border-radius:12px;background:#343060;color:#d2ccff;display:grid;place-items:center;font-weight:700;font-size:12px}
.profile-info{min-width:0;flex:1}
.profile-info strong,.profile-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.profile-info strong{font-size:12px;color:#e4e9f2;margin-bottom:5px}
.profile-info small{font-size:10px;color:#8c9ab1}
.logout-button,.icon-button{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:10px;width:38px;height:38px;font-size:20px}
.logout-button{background:transparent;border-color:#34435a;color:#c2cce0}
.main-area{min-width:0;flex:1}
.topbar{height:81px;background:var(--panel);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 38px}
.breadcrumb,.top-actions{display:flex;align-items:center;gap:15px}
.breadcrumb{font-size:12px}
.breadcrumb span{color:#8a98b0}
.breadcrumb strong{font-weight:650}
.top-actions{gap:14px}
.system-badge{display:flex;align-items:center;gap:8px;border:1px solid #c9f0e4;border-radius:8px;padding:8px 12px;color:#269d7d;background:#f0fcf8;font-size:10px;font-weight:800;letter-spacing:.7px}
.system-badge .green-dot{width:7px;height:7px}
.top-avatar{width:38px;height:38px}
.page-content{padding:34px 38px 24px;max-width:1800px;margin:auto}
.page-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:28px}
.eyebrow{font-size:10px;letter-spacing:2px;color:#8c7cff;font-weight:800;margin:0 0 14px}
.page-heading h1{font-size:29px;letter-spacing:-.7px;margin:0 0 8px}
.page-description{font-size:13px;color:var(--muted);margin:0}
.environment{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:8px;margin-bottom:5px;white-space:nowrap}
.panel,.stat-card{background:var(--panel);border:1px solid var(--border);border-radius:15px;box-shadow:0 3px 12px rgba(31,51,84,.025)}
.panel{padding:25px;margin-bottom:20px;min-width:0}
.panel-title{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}
.panel-title h2{font-size:16px;margin:0 0 7px;letter-spacing:-.2px}
.panel-title p{font-size:12px;color:var(--muted);margin:0}
.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-bottom:20px}
.stat-card{padding:22px}
.stat-top{display:flex;justify-content:space-between;align-items:center;gap:10px;color:#7686a1;font-size:12px}
.stat-icon{width:36px;height:36px;border-radius:10px;background:#f1efff;color:#7668f5;display:grid;place-items:center;font-size:18px}
.stat-value{display:block;font-size:29px;letter-spacing:-.8px;margin:16px 0 6px}
.stat-card p{font-size:11px;color:var(--muted);margin:0}
.content-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
.network-summary{display:flex;align-items:center;justify-content:center;gap:36px;padding:12px;min-height:280px}
.network-circle{--percentage:0%;width:276px;height:276px;border-radius:50%;background:conic-gradient(#7867f5 0%,#7867f5 var(--percentage),#e9e6ff var(--percentage),#e9e6ff 100%);display:flex;align-items:center;justify-content:center;flex-direction:column;position:relative;flex-shrink:0}
.network-circle::before{content:"";position:absolute;inset:12px;background:var(--panel);border-radius:50%}
.network-circle strong,.network-circle span{position:relative;z-index:1}
.network-circle strong{font-size:36px;color:var(--text)}
.network-circle span{font-size:15px;color:var(--muted)}
.legend{min-width:200px}
.legend p{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--muted);margin:20px 0}
.legend strong{color:var(--text);margin-left:auto}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.legend-dot.green{background:#2bc69a}
.legend-dot.orange{background:#f2a23b}
.legend-dot.red{background:#ef6471}
.activity-list{display:grid;gap:19px}
.activity-item{display:flex;gap:12px}
.activity-dot{width:9px;height:9px;border-radius:50%;background:#7969f6;margin-top:5px;flex-shrink:0}
.activity-item strong{font-size:12px}
.activity-item p{font-size:11px;color:var(--muted);margin:5px 0}
.activity-item small,.history-item small{font-size:10px;color:#9aa6ba}
.toolbar{display:flex;gap:12px;margin-bottom:20px}
.search-input{flex:1;min-width:0}
input,select{border:1px solid var(--border);border-radius:8px;background:var(--field);color:var(--text);padding:11px 12px;font-size:12px;outline:none}
input:focus,select:focus{border-color:#8b7dff;box-shadow:0 0 0 3px rgba(119,102,245,.1)}
.primary-button,.secondary-button,.small-button{border-radius:9px;padding:11px 14px;font-size:11px;font-weight:650;white-space:nowrap}
.primary-button{background:#7667f5;color:white;border:1px solid #7667f5}
.primary-button:hover{background:#6353e6}
.secondary-button,.small-button{background:var(--panel);color:var(--text);border:1px solid var(--border)}
.secondary-button:hover,.small-button:hover{border-color:#9d92ff}
.table-wrap{overflow-x:auto;width:100%}
.device-table{border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}
.device-table th{text-align:left;font-size:9px;letter-spacing:.6px;color:#8190ab;background:#f7f8fc;padding:15px 12px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.device-table th:first-child{border-radius:8px 0 0 0}
.device-table th:last-child{border-radius:0 8px 0 0}
.device-table td{padding:13px 12px;border-bottom:1px solid var(--border)}
.device-table tr:last-child td{border-bottom:0}
.device-name-cell{display:flex;align-items:center;gap:11px}
.device-name-cell strong,.device-name-cell small{display:block}
.device-name-cell strong{font-size:11px;margin-bottom:5px}
.device-name-cell small{font-size:10px;color:var(--muted)}
.device-icon{width:34px;height:34px;background:#f6f5ff;color:#8275ff;border-radius:10px;display:grid;place-items:center;font-size:16px}
.ip-address{color:#7b6aff}
.status-pill{display:inline-flex;align-items:center;gap:6px;border-radius:6px;padding:7px 9px;font-size:10px;font-weight:650}
.status-connected{background:#e4f8f0;color:#16966e}
.status-disconnected{background:#fff1dd;color:#bd781c}
.status-unauthorized{background:#ffebed;color:#d94e5b}
.table-actions{display:flex;gap:5px}
.small-button{padding:7px 9px;font-size:10px}
.footnote{font-size:11px;color:#8997ae;margin:18px 0 0;line-height:1.6}
.add-device-form{display:grid;grid-template-columns:1fr 1fr 1fr auto;align-items:end;gap:12px;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:18px}
.field{display:grid;gap:8px;min-width:0}
.field label{font-size:11px;font-weight:650}
.password-field{display:flex;gap:6px}
.password-field input{min-width:0;flex:1}
.text-button{border:0;background:transparent;color:#7566ef;font-size:11px}
.monitoring-control{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:16px;background:var(--bg);border-radius:11px}
.monitoring-control .muted{margin:10px 0 0;font-size:11px}
.muted{color:var(--muted)}
.monitoring-options{margin-top:20px;max-width:500px}
.monitoring-options .muted{font-size:11px;line-height:1.6}
.traffic-row{margin:22px 0}
.traffic-label{display:flex;justify-content:space-between;font-size:12px;margin-bottom:9px}
.traffic-label span{color:var(--muted)}
.traffic-track{height:8px;background:#eceffa;border-radius:10px;overflow:hidden}
.traffic-fill{height:100%;border-radius:10px;background:linear-gradient(90deg,#8a7bff,#5f52e4)}
.alert-list,.history-list{display:grid}
.alert-item{display:flex;align-items:flex-start;gap:13px;padding:18px 0;border-bottom:1px solid var(--border)}
.alert-item:last-child,.history-item:last-child{border-bottom:0}
.alert-read{opacity:.65}
.severity-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;flex-shrink:0}
.severity-alta{background:#ed5c6c}
.severity-media{background:#efa43f}
.severity-baja{background:#2bc69a}
.alert-body{flex:1;min-width:0}
.alert-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.alert-heading strong{font-size:13px}
.alert-body p{font-size:12px;color:var(--muted);margin:8px 0}
.alert-body small{font-size:10px;color:#9aa6ba}
.severity-label{font-size:10px;padding:4px 7px;border-radius:5px}
.severity-label-alta{background:#ffebed;color:#d94e5b}
.severity-label-media{background:#fff1dd;color:#bd781c}
.severity-label-baja{background:#e4f8f0;color:#16966e}
.history-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.history-summary>div{background:var(--bg);padding:16px;border-radius:9px}
.history-summary span,.history-summary strong{display:block}
.history-summary span{font-size:11px;color:var(--muted);margin-bottom:8px}
.history-summary strong{font-size:13px}
.history-item{display:flex;gap:13px;padding:17px 0;border-bottom:1px solid var(--border)}
.history-icon{width:34px;height:34px;display:grid;place-items:center;background:#f1efff;color:#7667f5;border-radius:9px;flex-shrink:0}
.history-item strong{font-size:12px}
.history-item p{font-size:11px;color:var(--muted);margin:6px 0}
.setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:23px 0;border-bottom:1px solid var(--border)}
.setting-description{min-width:0}
.setting-description strong{font-size:13px}
.setting-description p{font-size:11px;line-height:1.5;color:var(--muted);margin:8px 0 0}
.setting-control{display:flex;justify-content:flex-end;align-items:center;flex-shrink:0;min-width:200px}
.setting-select{width:205px}
.number-control{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:11px}
.number-control input{width:84px}
.switch{position:relative;display:inline-block;width:48px;height:28px}
.switch input{opacity:0;width:0;height:0}
.switch-slider{position:absolute;inset:0;cursor:pointer;background:#cbd3e0;border-radius:20px;transition:.2s}
.switch-slider:before{content:"";position:absolute;width:20px;height:20px;left:4px;top:4px;background:white;border-radius:50%;transition:.2s;box-shadow:0 1px 3px #0002}
.switch input:checked+.switch-slider{background:#7667f5}
.switch input:checked+.switch-slider:before{transform:translateX(20px)}
.info-box{display:flex;gap:11px;align-items:flex-start;background:#eef4ff;border:1px solid #d8e5ff;border-radius:10px;padding:14px 17px;margin-top:18px;color:#617698}
.info-box>span{font-size:17px;color:#7796ff}
.info-box p{font-size:11px;line-height:1.7;margin:2px 0}
.settings-section-heading{display:flex;align-items:center;gap:13px;margin-top:34px;padding-bottom:10px}
.settings-section-icon{width:40px;height:40px;border-radius:10px;background:#f0edff;color:#7768f6;display:grid;place-items:center;font-size:20px}
.settings-section-heading h3{font-size:16px;margin:0 0 6px}
.settings-section-heading p{font-size:11px;color:var(--muted);margin:0;line-height:1.5}
.settings-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}
.page-footer{display:flex;justify-content:space-between;gap:16px;font-size:10px;color:#8b99b0;padding:24px 0 4px}
.page-footer span:last-child{display:flex;align-items:center;gap:7px}
.page-footer .green-dot{width:6px;height:6px}
.toast{position:fixed;right:24px;bottom:24px;z-index:10;background:#17243a;color:#fff;padding:14px 19px;border-radius:10px;box-shadow:0 8px 30px #0002;font-size:12px}
.empty-state{text-align:center;padding:38px;color:var(--muted);font-size:13px}
.login-screen{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(135deg,#101b2d,#22204d)}
.login-card{width:min(100%,420px);background:#fff;border-radius:18px;padding:38px;box-shadow:0 20px 70px #0003}
.login-logo{margin-bottom:25px;width:56px;height:56px}
.login-card h1{font-size:29px;margin:0 0 5px;color:#253047}
.login-card>.muted{margin:0 0 30px;font-size:13px}
.login-card .eyebrow{margin-bottom:12px}
.login-card .field{margin:18px 0}
.login-card .field input{width:100%;padding:13px}
.login-card .password-field input{width:0}
.full-button{width:100%;padding:14px;margin-top:8px}
.login-note{font-size:11px;line-height:1.6;color:#8997ae;margin:18px 0 0}
.error-message{color:#d94e5b;font-size:12px}
.dark-theme{--bg:#111a2b;--panel:#182438;--text:#e3eaf5;--muted:#9ba9c0;--border:#2b3950;--field:#111c2f;color:var(--text)}
.dark-theme .device-table th{background:#202c42;color:#b3bfd2}
.dark-theme .device-icon,.dark-theme .stat-icon,.dark-theme .history-icon,.dark-theme .settings-section-icon{background:#2d2b52;color:#bcb4ff}
.dark-theme .info-box{background:#202e49;border-color:#334766;color:#c2d0e8}
.dark-theme .network-circle::before{background:var(--panel)}
.dark-theme .traffic-track{background:#303c52}
.dark-theme .monitoring-control,.dark-theme .history-summary>div,.dark-theme .add-device-form{background:#111c2f}
.dark-theme .system-badge{background:#18392f;border-color:#285c4c;color:#6fe0ba}
@media(max-width:1100px){.sidebar{width:235px}.page-content{padding:28px 22px}.topbar{padding:0 22px}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.content-grid{grid-template-columns:1fr}.add-device-form{grid-template-columns:1fr 1fr}.network-circle{width:220px;height:220px}}
@media(max-width:900px){.network-summary{flex-wrap:wrap;gap:20px}.legend{width:100%;max-width:300px}}
@media(max-width:700px){.sidebar{width:68px;padding:20px 8px}.brand{padding:0 2px 28px}.brand>div:last-child,.menu-heading,.nav-item>span:not(.nav-icon),.gateway-card,.profile-info,.logout-button{display:none}.brand-logo{width:46px;height:46px}.nav-item{justify-content:center;padding:12px 0}.nav-icon{width:auto}.profile{justify-content:center;padding:14px 0 0}.profile-avatar{width:36px;height:36px}.topbar{height:65px;padding:0 13px}.breadcrumb{gap:8px;font-size:10px}.top-actions{gap:6px}.system-badge{padding:7px;font-size:8px}.top-avatar{width:32px;height:32px}.page-content{padding:24px 12px}.page-heading{align-items:flex-start;flex-direction:column}.page-heading h1{font-size:25px}.environment{white-space:normal}.stats-grid{grid-template-columns:1fr 1fr;gap:9px}.stat-card{padding:14px}.stat-top{font-size:10px}.stat-value{font-size:24px}.panel{padding:16px}.panel-title{align-items:flex-start}.setting-row{align-items:flex-start;flex-direction:column;gap:14px}.setting-control{width:100%;justify-content:flex-start}.setting-select{width:100%}.settings-footer{flex-wrap:wrap}.history-summary{grid-template-columns:1fr}.page-footer{flex-direction:column;gap:10px}.add-device-form{grid-template-columns:1fr}.monitoring-control{align-items:flex-start;flex-direction:column}.toolbar{flex-direction:column}.login-card{padding:27px 22px}.network-circle{width:190px;height:190px}.network-circle strong{font-size:30px}}
`

export default App
