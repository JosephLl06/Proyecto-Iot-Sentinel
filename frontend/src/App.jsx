import { useEffect, useMemo, useRef, useState } from 'react'
import './panel.css'
import SecurityDesk, { PriorityPanel } from './SecurityDesk.jsx'
import MonitoringCharts from './MonitoringCharts.jsx'

const menu = [
  {
    id: 'dashboard',
    label: 'Panel principal',
    icon: '▦',
  },
  {
    id: 'devices',
    label: 'Dispositivos IoT',
    icon: '▤',
  },
  {
    id: 'monitoring',
    label: 'Monitoreo de red',
    icon: '⌁',
  },
  {
    id: 'alerts',
    label: 'Alertas de seguridad',
    icon: '♧',
  },
  {
    id: 'history',
    label: 'Historial de eventos',
    icon: '◷',
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: '⚙',
  },
]

const defaultSettings = {

  refreshInterval: 10,

  saveInterval: 5,

  historyRetention: 30,

  dark: false,

  notifications: true,

  threshold: 5,

}

async function request(action, data, signal) {
  const response = await fetch(`/api/${action}`, data === undefined ? { signal } : {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status })
  return result
}

function App() {

const [isLoggedIn, setIsLoggedIn] = useState(false)
const [setup, setSetup] = useState(false)
const [loading, setLoading] = useState(true)
const [busy, setBusy] = useState(false)
const revision = useRef(0)
const pending = useRef(false)

const [loginEmail, setLoginEmail] = useState('')

const [loginPassword, setLoginPassword] = useState('')

const [loginError, setLoginError] = useState('')
const [authStep, setAuthStep] = useState(null)
const [verificationCode, setVerificationCode] = useState('')
const [useBackup, setUseBackup] = useState(false)
const [backupCodes, setBackupCodes] = useState([])

const [showPassword, setShowPassword] = useState(false)

const [page, setPage] = useState('dashboard')

const [devices, setDevices] = useState([])

const [alerts, setAlerts] = useState([])

const [events, setEvents] = useState([])

const [search, setSearch] = useState('')

const [filter, setFilter] = useState('Todos')

const [notice, setNotice] = useState('')

const [showForm, setShowForm] = useState(false)

const [newName, setNewName] = useState('')

const [newIp, setNewIp] = useState('')

const [newType, setNewType] = useState('Sensor')
const [newRoom, setNewRoom] = useState('')
const [checkedAt, setCheckedAt] = useState(() => Date.now())

const [settings, setSettings] = useState(defaultSettings)

const [draftSettings, setDraftSettings] = useState(defaultSettings)

const [lastUpdate, setLastUpdate] = useState(new Date())

const [transportInfo, setTransportInfo] = useState(null)
const [lastSave, setLastSave] = useState(null)

const [monitoringEnabled, setMonitoringEnabled] = useState(true)

const [selectedCase, setSelectedCase] = useState(null)
const [newAlert, setNewAlert] = useState(null)
const previousCaseIds = useRef(null)
const [monitorFocus, setMonitorFocus] = useState(null)

function openCase(id) {
  setSelectedCase(id)
  setNewAlert(null)
  setPage('alerts')
  window.scrollTo(0,0)
}

function openMonitor(id, timestamp, metric) {
  setMonitorFocus({ id, timestamp, metric })
  setPage('monitoring')
  window.scrollTo(0,0)
}

// Filtros del historial
const [historyDateFrom, setHistoryDateFrom] = useState('')
const [historyDateTo, setHistoryDateTo] = useState('')
const [historyRiskFilter, setHistoryRiskFilter] = useState('Todos')
const [historyDeviceFilter, setHistoryDeviceFilter] = useState('Todos')
const [historyUserFilter, setHistoryUserFilter] = useState('Todos')
const [historySearch, setHistorySearch] = useState('')

const connected = devices.filter(

    d => d.status === 'Conectado' && !d.blocked

  ).length

const authorized = devices.filter(

    d => d.authorized

  ).length

const pendingAlerts = alerts.filter(a => a.status !== 'Resuelta').length

const traffic = devices.reduce(

    (sum, d) => sum + (d.blocked ? 0 : d.traffic),

    0

  )

const visibleDevices = useMemo(() => devices.filter(d => {

const matchesSearch = `${d.name} ${d.ip} ${d.type} ${d.room ?? ""}`

      .toLowerCase()

      .includes(search.toLowerCase())

const matchesFilter =

      filter === 'Todos' ||

      (filter === 'Conectados' && d.status === 'Conectado' && !d.blocked) ||

      (filter === 'Desconectados' && (d.status === 'Desconectado' || d.blocked)) ||

      (filter === 'No autorizados' && !d.authorized)

    return matchesSearch && matchesFilter

  }), [devices, search, filter])

const visibleEvents = useMemo(() => {
  return [...events]
    .filter(event => {
      const eventDate = event.timestamp ? new Date(event.timestamp) : null
      const dateFrom = historyDateFrom
        ? new Date(`${historyDateFrom}T00:00:00`)
        : null
      const dateTo = historyDateTo
        ? new Date(`${historyDateTo}T23:59:59.999`)
        : null

      const matchesFrom = !dateFrom || (eventDate && eventDate >= dateFrom)
      const matchesTo = !dateTo || (eventDate && eventDate <= dateTo)
      const matchesRisk =
        historyRiskFilter === 'Todos' || event.severity === historyRiskFilter
      const matchesDevice =
        historyDeviceFilter === 'Todos' || event.deviceType === historyDeviceFilter
      const matchesUser =
        historyUserFilter === 'Todos' || event.user === historyUserFilter
      const searchableText = `${event.title} ${event.detail} ${event.user || ''}`.toLowerCase()
      const matchesSearch = searchableText.includes(historySearch.toLowerCase())

      return (
        matchesFrom && matchesTo && matchesRisk &&
        matchesDevice && matchesUser && matchesSearch
      )
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}, [
  events, historyDateFrom, historyDateTo, historyRiskFilter,
  historyDeviceFilter, historyUserFilter, historySearch,
])

const pageTitle =

    menu.find(item => item.id === page)?.label || 'Panel principal'

function notify(message) {

    if (!settings.notifications) return

    setNotice(message)

    window.setTimeout(() => setNotice(''), 3000)

  }

  function applyState(state) {
    if (previousCaseIds.current && state.settings.notifications) {
      const fresh = state.alerts.find(a => a.severity === 'Alta' && !a.read && !previousCaseIds.current.has(a.id))
      if (fresh) setNewAlert({id: fresh.id, title: fresh.title, device: fresh.deviceName})
    } else {
      setNewAlert(null)
    }
    previousCaseIds.current = new Set(state.alerts.map(a => a.id))
    setCheckedAt(Date.now())
    if (state.transportInfo) setTransportInfo(state.transportInfo)
    setDevices(state.devices)
    setAlerts(state.alerts)
    setEvents(state.events)
    setSettings(state.settings)
    setMonitoringEnabled(state.monitoringEnabled)
    setLastUpdate(new Date(state.lastUpdate))
    setLastSave(state.lastSave ? new Date(state.lastSave) : null)
  }

  useEffect(() => {
    let active = true
    async function restoreSession() {
      try {
        const session = await request('session')
        const state = session.email ? await request('state') : null
        if (!active) return
        setSetup(session.setup)
        if (state) {
          applyState(state)
          setLoginEmail(session.email)
          setDraftSettings(state.settings)
          setIsLoggedIn(true)
        }
      } catch {
        if (active) setLoginError('No se pudo conectar al servidor local.')
      } finally {
        if (active) setLoading(false)
      }
    }
    restoreSession()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!isLoggedIn) return
    let active = true
    let running = false
    const timer = window.setInterval(async () => {
      if (running || pending.current) return
      running = true
      const version = revision.current
      try {
        const state = await request('state')
        if (active && revision.current === version) applyState(state)
      } catch (error) {
        if (active && revision.current === version) {
          if (error.status === 401) {
            setIsLoggedIn(false)
            setLoginError('Inicia sesión nuevamente.')
          } else {
            setNotice('No se pudo actualizar el panel. Se reintentará.')
          }
        }
      } finally {
        running = false
      }
    }, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return
    let last = -Infinity
    const controller = new AbortController()
    function activity() {
      if (document.hidden || performance.now() - last < 60000) return
      last = performance.now()
      request('activity', {}, controller.signal).catch(() => {})
    }
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      controller.abort()
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [isLoggedIn])

  async function submit(action, data, onSuccess, onError = setNotice) {
    if (pending.current) return
    pending.current = true
    revision.current += 1
    setBusy(true)
    try {
      const result = await request(action, data)
      if (action !== 'logout' && action !== 'login' && action !== 'verify') applyState(result)
      onSuccess?.(result)
    } catch (error) {
      if (error.status === 401 && action !== 'login' && action !== 'verify') setIsLoggedIn(false)
      onError(error.message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function handleLogin(event) {
    event.preventDefault()
    setLoginError('')
    submit('login', { email: loginEmail.trim(), password: loginPassword }, result => {
      setAuthStep(result)
      setVerificationCode('')
      setUseBackup(false)
      setLoginPassword('')
    }, setLoginError)
  }

  function verifyCode(event) {
    event.preventDefault()
    setLoginError('')
    submit('verify', { code: verificationCode }, result => {
      if (result.stage === 'pair') {
        setAuthStep(result)
        setUseBackup(false)
        setVerificationCode('')
        return
      }
      previousCaseIds.current = null
      applyState(result.state)
      setDraftSettings(result.state.settings)
      setSetup(false)
      setAuthStep(null)
      setVerificationCode('')
      setBackupCodes(result.recoveryCodes ?? [])
      setIsLoggedIn(true)
      setPage('dashboard')
      if (result.recoveryUsed) setNotice('Se vinculó tu nuevo autenticador y se invalidaron los respaldos anteriores.')
    }, setLoginError)
  }

  function handleLogout() {
    submit('logout', {}, () => {
      setIsLoggedIn(false)
      setLoginError('')
      setPage('dashboard')
    })
  }

  function changePage(id) {
    setMonitorFocus(null)
    setSelectedCase(null)
    setPage(id)
    setSearch('')
    setFilter('Todos')
  }

  function toggleBlock(id) {
    submit('block', { id })
  }

  function toggleConnection(id) {
    submit('connection', { id })
  }

  function addDevice(event) {
    event.preventDefault()
    submit('device', { name: newName, ip: newIp, type: newType, room: newRoom.trim() || 'Sin asignar' }, () => {
      setNewName('')
      setNewIp('')
      setNewType('Sensor')
      setNewRoom('')
      setShowForm(false)
      notify('Dispositivo simulado agregado correctamente.')
    })
  }

  function updateDraft(key, value) {
    setDraftSettings(current => ({ ...current, [key]: value }))
  }

  function saveSettings(event) {
    event.preventDefault()
    submit('settings', draftSettings, state => {
      setDraftSettings(state.settings)
      notify('Preferencias guardadas correctamente.')
    })
  }

  function changeTheme() {
    submit('settings', { dark: !settings.dark }, state => {
      setDraftSettings(current => ({ ...current, dark: state.settings.dark }))
    })
  }

  if (isLoggedIn && backupCodes.length) {
    return <main className="login-screen">
      <section className="login-card factor-card">
        <div className="login-logo">IS</div>
        <h1>Códigos de respaldo</h1>
        <p className="factor-help">Guárdalos en un lugar privado separado de esta computadora. Cada código sirve una vez junto con tu contraseña.</p>
        <ul className="backup-codes">{backupCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
        <button type="button" className="primary-button full-button" onClick={() => setBackupCodes([])}>
          Ya guardé mis códigos
        </button>
      </section>
    </main>
  }

  if (!isLoggedIn && authStep) {
    return <main className="login-screen">
      <form className="login-card factor-card" onSubmit={verifyCode}>
        <div className="login-logo">IS</div>
        <h1>{authStep.stage === 'pair' ? 'Vincula tu autenticador' : 'Verifica tu acceso'}</h1>
        {authStep.stage === 'pair' ? <>
          {authStep.replacement && <p className="factor-help">Vincula tu nuevo autenticador para recuperar el acceso.</p>}
          <p className="factor-help">En Microsoft Authenticator, pulsa +, elige «Otra cuenta» y escanea este QR.</p>
          <img className="factor-qr" src={authStep.qr} alt="Código QR para vincular IoTSentinel" />
          <details className="factor-help">
            <summary>Mostrar clave de configuración manual</summary>
            <code className="manual-factor-key">{authStep.manualKey}</code>
          </details>
          <p className="factor-help">El QR es privado. Introduce el código que aparezca en el celular.</p>
        </> : <p className="factor-help">{useBackup ? 'Usa un código de respaldo para vincular un nuevo autenticador.' : 'Abre Microsoft Authenticator y consulta el código de IoTSentinel.'}</p>}
        <div className="field">
          <label htmlFor="factorCode">{useBackup ? 'Código de respaldo' : 'Código de 6 dígitos'}</label>
          <input id="factorCode" autoComplete="one-time-code" autoFocus
            inputMode={useBackup ? 'text' : 'numeric'} maxLength={useBackup ? 19 : 6}
            value={verificationCode} onChange={event => setVerificationCode(event.target.value)}
            pattern={useBackup ? undefined : '[0-9]{6}'} required />
        </div>
        {loginError && <p className="error-message" role="alert">{loginError}</p>}
        <button className="primary-button full-button" disabled={busy}>Verificar</button>
        {authStep.stage === 'verify' && <button type="button" className="text-button factor-action" onClick={() => {
          setUseBackup(!useBackup)
          setVerificationCode('')
          setLoginError('')
        }}>{useBackup ? 'Usar autenticador' : 'Usar un código de respaldo'}</button>}
        <button type="button" className="text-button factor-action" disabled={busy} onClick={() => {
          setAuthStep(null)
          setVerificationCode('')
          setLoginError('')
        }}>Volver al correo y contraseña</button>
      </form>
    </main>
  }

  if (!isLoggedIn) {

    return (

      <>


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

              type="submit" disabled={busy || loading}

            >

              {setup ? 'Crear cuenta local' : 'Ingresar'}

            </button>

            <p className="login-note">

              {setup ? 'Crea la cuenta de administrador local. Usa al menos 12 caracteres en la contraseña.' : 'Ingresa los datos de tu cuenta local.'}

            </p>

          </form>

        </main>

      </>

    )

  }

  return (

    <>


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

              <strong>Entorno de simulación</strong>

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

                HTTPS LOCAL

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

                Simulación local

              </div>

            </div>

            {newAlert && alerts.some(a => a.id === newAlert.id && !a.read && a.status !== 'Resuelta') && <aside className="security-flash" aria-live="polite">
              <span><strong>Nueva alerta de riesgo alto</strong> · {newAlert.device} · {newAlert.title}</span>
              <button className="small-button" onClick={() => openCase(newAlert.id)}>Revisar ahora</button>
              <button className="small-button" aria-label="Ocultar aviso" onClick={() => setNewAlert(null)}>×</button>
            </aside>}
            {page === 'dashboard' && (

              <>

                <div className="stats-grid">

                  <StatCard

                    label="Dispositivos registrados"

                    value={devices.length}

                    detail="En el inventario simulado"

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

                    label="Casos sin resolver"

                    value={pendingAlerts}

                    detail="Abiertos o en revisión"

                    icon="♧"

                  />

                </div>

                <div className="desk-overview">
                  <MonitoringCharts compact request={request} devices={devices} alerts={alerts}
                    revision={lastUpdate.getTime()} checkedAt={checkedAt} onExpand={() => changePage('monitoring')}
                    monitoring={monitoringEnabled} interval={settings.refreshInterval} />
                  <PriorityPanel alerts={alerts} onOpen={openCase} />
                </div>

                <div className="content-grid">

                  <section className="panel">

                    <PanelTitle

                      title="Estado de la red"

                      subtitle="Resumen de los dispositivos registrados"

                    />

                    <div className="connection-breakdown">
                      {[
                        ['Conectados', connected, 'online'],
                        ['Desconectados', devices.filter(d => !d.blocked && d.status !== 'Conectado').length, 'offline'],
                        ['Aislados', devices.filter(d => d.blocked).length, 'isolated'],
                      ].map(([label, value, style]) => <div key={label} className={style}>
                        <span>{label}</span><strong>{value} de {devices.length}</strong>
                        <progress value={value} max={devices.length || 1} aria-label={label} />
                      </div>)}
                    </div>
                  </section>

                  <section className="panel">

                    <PanelTitle

                      title="Actividad reciente"

                      subtitle="Últimos eventos registrados"

                    />

                    <div className="activity-list">

                      {events.slice(0,4).map(event => (

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

                        placeholder="192.0.2.160"

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

                        <option>Timbre inteligente</option>
                        <option>Cerradura inteligente</option>
                        <option>Televisor inteligente</option>
                        <option>Altavoz inteligente</option>
                        <option>Robot aspirador</option>
                        <option>Termostato</option>
                        <option>Desconocido</option>

                      </select>

                    </div>

                    <label className="field">Zona
                      <input value={newRoom} onChange={event => setNewRoom(event.target.value)}
                        maxLength={40} placeholder="Ej. Cochera" />
                    </label>

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

                    placeholder="Buscar por nombre, zona, IP o tipo…"

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

                    label="Tráfico simulado"

                    value={`${traffic.toFixed(1)} MB`}

                    detail="Volumen total por intervalo"

                    icon="⇅"

                  />

                  <StatCard

                    label="Umbral de tráfico"

                    value={`${settings.threshold} MB`}

                    detail="Configurado en preferencias"

                    icon="⚙"

                  />

                  <StatCard label="Casos sin resolver" value={pendingAlerts}
                    detail="Por revisar" icon="◇" />

                </div>

                <MonitoringCharts request={request} devices={devices} alerts={alerts}
                  revision={lastUpdate.getTime()} checkedAt={checkedAt} focus={monitorFocus} onCase={openCase}
                  monitoring={monitoringEnabled} interval={settings.refreshInterval} transport={transportInfo} />

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

                        Lecturas nuevas cada {settings.refreshInterval} segundos.

                      </p>

                    </div>

                    <button

                      className={

                        monitoringEnabled

                          ? 'secondary-button'

                          : 'primary-button'

                      }

                      onClick={() => submit('monitoring', {})}

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

                        onChange={e => submit('settings', { refreshInterval: Number(e.target.value) }, state => setDraftSettings(current => ({ ...current, refreshInterval: state.settings.refreshInterval })))}

                      >

                        <option value={5}>Cada 5 segundos</option>

                        <option value={10}>Cada 10 segundos</option>

                        <option value={30}>Cada 30 segundos</option>

                        <option value={60}>Cada 60 segundos</option>

                      </select>

                    </div>

                    <p className="muted">

                      Este intervalo se aplica al simulador local.

                    </p>

                  </div>

                </section>

              </>

            )}

            {page === 'alerts' && <SecurityDesk alerts={alerts} devices={devices} events={events}
              selected={selectedCase} setSelected={setSelectedCase} onMonitor={openMonitor} submit={submit} busy={busy} />}

            {page === 'history' && (

              <section className="panel">

                <PanelTitle

                  title="Historial de eventos"

                  subtitle={`${visibleEvents.length} de ${events.length} registros`}

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

                <div className="history-filters">
                  <div className="field">
                    <label>Fecha desde</label>
                    <input type="date" value={historyDateFrom} max={historyDateTo || undefined} onChange={e => setHistoryDateFrom(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Fecha hasta</label>
                    <input type="date" value={historyDateTo} min={historyDateFrom || undefined} onChange={e => setHistoryDateTo(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Nivel de riesgo</label>
                    <select value={historyRiskFilter} onChange={e => setHistoryRiskFilter(e.target.value)}>
                      <option value="Todos">Todos</option>
                      <option value="Alta">Alto</option>
                      <option value="Media">Medio</option>
                      <option value="Baja">Bajo</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Tipo de dispositivo</label>
                    <select value={historyDeviceFilter} onChange={e => setHistoryDeviceFilter(e.target.value)}>
                      <option value="Todos">Todos</option>
                      {[...new Set([...devices.map(d => d.type), ...events.map(e => e.deviceType).filter(Boolean)])].map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Usuario responsable</label>
                    <select value={historyUserFilter} onChange={e => setHistoryUserFilter(e.target.value)}>
                      <option value="Todos">Todos</option>
                      {[...new Set(events.map(e => e.user).filter(Boolean))].map(user => (
                        <option key={user} value={user}>{user}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Buscar evento</label>
                    <input type="search" placeholder="Buscar por evento o descripción..." value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
                  </div>
                </div>

                <div className="history-filter-footer">
                  <span>Resultados encontrados: <strong>{visibleEvents.length}</strong></span>
                  <button type="button" className="secondary-button" onClick={() => {
                    setHistoryDateFrom('')
                    setHistoryDateTo('')
                    setHistoryRiskFilter('Todos')
                    setHistoryDeviceFilter('Todos')
                    setHistoryUserFilter('Todos')
                    setHistorySearch('')
                  }}>Limpiar filtros</button>
                </div>

                <div className="history-list">

                  {visibleEvents.map(event => (

                    <article className="history-item" key={event.id}>

                      <div className="history-icon">◷</div>

                      <div className="history-details">
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                        <div className="history-metadata">
                          <span>Fecha: {event.time}</span>
                          <span>Riesgo: {event.severity || 'Sin clasificar'}</span>
                          <span>Tipo: {event.deviceType || 'Sin especificar'}</span>
                          <span>Usuario: {event.user || 'Sin especificar'}</span>
                        </div>
                      </div>

                    </article>

                  ))}

                  {visibleEvents.length === 0 && (
                    <EmptyState text="No hay eventos que coincidan con los filtros seleccionados." />
                  )}

                </div>

                <p className="footnote">

                  El historial se guarda en la base de datos local de IoTSentinel.

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

                    Bloquear un dispositivo virtual detiene la generación de sus lecturas.

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

                    <small>{device.type} · {device.room ?? 'Sin asignar'}</small>

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



export default App
