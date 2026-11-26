import { useState } from 'react'
import './security.css'

const dateTime = value => new Date(value).toLocaleString('es-PE')
const statusOf = alert => alert.status || 'Abierta'
const lastSeen = alert => alert.lastSeen || alert.timestamp
const advice = {
  'Tráfico sospechoso': 'Comprueba si alguien estaba usando la cámara o el equipo a esa hora. Si el aumento se repite sin explicación, puedes aislarlo.',
  'Frecuencia anormal': 'Compara la cantidad de mensajes con el límite del equipo. Revisa si hubo un cambio de configuración.',
  'Destino no habitual': 'Compara el destino observado con los habituales. Si no reconoces el servicio, aísla el equipo mientras lo revisas.',
  'Posible patrón de botnet': 'El equipo envió ráfagas a un destino desconocido durante varios intervalos seguidos. Investiga su actividad y considera aislarlo.',
  'Acceso no autorizado': 'El inventario no reconoce este equipo como autorizado. Comprueba su identidad antes de permitir su uso.',
}
const risk = { Alta: 0, Media: 1, Baja: 2 }

export function PriorityPanel({ alerts, onOpen }) {
  const active = alerts.filter(a => statusOf(a) !== 'Resuelta')
    .sort((a,b) => risk[a.severity] - risk[b.severity] || lastSeen(b) - lastSeen(a))
  return <section className="panel priority-panel">
    <h2>Qué atender primero</h2><p className="case-sub">Casos abiertos por riesgo y última detección.</p>
    {active.slice(0,3).map(a => <button key={a.id} className="priority-item" onClick={() => onOpen(a.id)}>
      <span className={'severity-label severity-label-' + a.severity.toLowerCase()}>{a.severity}</span>
      <span><strong>{a.deviceName || a.title}</strong><small>{a.deviceName ? a.title : a.detail}</small></span>
      <span aria-hidden="true">→</span>
    </button>)}
    {!active.length && <p>No hay casos abiertos.</p>}
  </section>
}

export default function SecurityDesk({ alerts, devices, events, selected, setSelected, submit, busy, onMonitor }) {
  const [stage, setStage] = useState('Todos')
  const [severity, setSeverity] = useState('Todos')
  const [kind, setKind] = useState('Todos')
  const [limit, setLimit] = useState(15)
  const ordered = [...alerts].filter(a => (kind === 'Todos' || a.type === kind)
    && (severity === 'Todos' || a.severity === severity) && (stage === 'Todos' || statusOf(a) === stage))
    .sort((a,b) => lastSeen(b) - lastSeen(a))
  const item = alerts.find(a => a.id === selected)
  return <div className="case-workspace">
    {item && <CaseDetail key={item.id} alert={item} device={devices.find(d => d.id === item.deviceId)}
      events={events} submit={submit} busy={busy} onMonitor={onMonitor} onClose={() => setSelected(null)} />}
    <section className="panel">
      <div className="monitor-chart-heading"><div><h2>Bandeja de casos</h2>
        <p>{alerts.filter(a => statusOf(a) !== 'Resuelta').length} sin resolver · {alerts.filter(a => !a.read).length} sin leer</p></div>
        <button className="secondary-button" disabled={busy || !alerts.some(a => !a.read)} onClick={() => submit('read-alerts', {})}>Marcar todas como leídas</button>
      </div>
      <div className="chart-controls case-filters">
        {[['Estado del caso', stage, setStage, ['Abierta','En revisión','Resuelta']],
          ['Riesgo', severity, setSeverity, ['Alta','Media','Baja']],
          ['Tipo de alerta', kind, setKind, [...new Set(alerts.map(a => a.type))].sort()]].map(([label,value,setter,options]) =>
          <label key={label}>{label}<select value={value} onChange={e => { setter(e.target.value); setLimit(15) }}>
            {['Todos',...options].map(s => <option key={s}>{s}</option>)}</select></label>)}
      </div>
      <p className="case-sub">{Math.min(limit, ordered.length)} de {ordered.length} casos · Ordenados por actividad reciente</p>
      {ordered.slice(0,limit).map(a => <article className="case-row" key={a.id}>
        <span className={'severity-label severity-label-' + a.severity.toLowerCase()}>{a.severity}</span>
        <div><strong>{a.title}</strong><p>{a.deviceName || a.detail}</p><small>{statusOf(a)} · {a.occurrences || 1} detecciones / avisos · {dateTime(lastSeen(a))}</small></div>
        <button className="secondary-button" aria-pressed={selected === a.id} onClick={() => { setSelected(a.id); window.scrollTo(0,0) }}>Ver caso</button>
      </article>)}
      {!ordered.length && <p className="chart-empty">No hay casos que coincidan con estos filtros.</p>}
      {limit < ordered.length && <button className="secondary-button" onClick={() => setLimit(limit+25)}>Mostrar más casos</button>}
    </section>
  </div>
}

function CaseDetail({ alert, device, events, submit, busy, onMonitor, onClose }) {
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [feedback, setFeedback] = useState('')
  const state = statusOf(alert)
  const evidence = alert.lastEvidence || alert.evidence
  const actions = events.filter(e => e.caseId === alert.id)
  function respond(action) {
    submit('respond-alert', { id: alert.id, action, note }, () => {
      setConfirm(false); setNote(''); setFeedback('Medida registrada en el historial del caso.')
    }, setFeedback)
  }
  return <section className="panel case-detail" aria-label="Detalle del caso">
    <div className="monitor-chart-heading"><div><span className={'severity-label severity-label-' + alert.severity.toLowerCase()}>Severidad {alert.severity.toLowerCase()}</span>
      <h2>{alert.title}</h2><p>{device?.name || alert.deviceName || alert.deviceType} · {state}{alert.ip && ' · ' + alert.ip}</p></div>
      <button className="secondary-button" onClick={onClose}>Cerrar detalle</button></div>
    <p>{advice[alert.type] || 'Revisa el evento y registra las medidas que tomaste.'}</p>
    <p className="case-sub">Primera detección {dateTime(alert.firstSeen || alert.timestamp)} · Última {dateTime(lastSeen(alert))} · Registros {alert.occurrences || 1}</p>
    {evidence ? <dl className="case-evidence">
      <div><dt>Volumen observado</dt><dd>{evidence.traffic} MB</dd><small>Límite {evidence.volumeLimit} MB</small></div>
      <div><dt>Mensajes recibidos</dt><dd>{evidence.messages}</dd><small>Límite {evidence.messageLimit} por intervalo</small></div>
      <div><dt>Destino observado</dt><dd>{evidence.destination}</dd><small>Habitual: {evidence.expectedDestinations.join(', ') || 'ninguno autorizado'}</small></div>
    </dl> : <p>{alert.detail}</p>}
    {alert.evidence && alert.lastEvidence && <details><summary>Lectura inicial del caso</summary>
      <p>{alert.evidence.traffic} MB · {alert.evidence.messages} mensajes · {alert.evidence.destination}</p>
    </details>}
    {device && <button className="secondary-button" onClick={() => onMonitor(device.id, lastSeen(alert), alert.type === 'Posible patrón de botnet' || alert.type === 'Frecuencia anormal' ? 'messages' : 'traffic')}>Ver lecturas del equipo</button>}
    <label className="case-note">Nota de seguimiento <textarea rows="2" maxLength={350} value={note} onChange={e => setNote(e.target.value)} placeholder="¿Qué comprobaste o qué medida tomaste?" /></label>
    <div className="case-buttons">
      {!alert.read && <button className="secondary-button" disabled={busy} onClick={() => submit('read-alerts',{id:alert.id})}>Marcar leída</button>}
      {state === 'Abierta' && <button className="primary-button" disabled={busy} onClick={() => respond('investigate')}>Iniciar revisión</button>}
      {device && state !== 'Resuelta' && !device.blocked && <button className="secondary-button" disabled={busy} onClick={() => setConfirm(true)}>Aislar equipo</button>}
      {state !== 'Resuelta' && <button className="secondary-button" disabled={busy || !note.trim()} onClick={() => respond('resolve')}>Resolver con nota</button>}
      {state === 'Resuelta' && <button className="secondary-button" disabled={busy} onClick={() => respond('reopen')}>Reabrir caso</button>}
    </div>
    {confirm && !device?.blocked && state !== 'Resuelta' && <div className="case-confirm"><p>El gateway dejará de recibir lecturas de <strong>{device.name}</strong>. Puedes restablecerlas en Dispositivos IoT.</p>
      <button className="primary-button" disabled={busy} onClick={() => respond('isolate')}>Confirmar aislamiento</button> <button className="secondary-button" onClick={() => setConfirm(false)}>Cancelar</button></div>}
    {device?.blocked && <p>Equipo aislado en el gateway.</p>}
    {feedback && <p role="status">{feedback}</p>}
    {!!actions.length && <details open><summary>Historial de medidas ({actions.length})</summary>
      <ul>{actions.map(e => <li key={e.id}><strong>{e.title}</strong> · {e.user} · {dateTime(e.timestamp)}{e.note && <p>{e.note}</p>}</li>)}</ul></details>}
  </section>
}
