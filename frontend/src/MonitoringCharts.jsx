import { useEffect, useState } from 'react'
import './monitoring.css'

const hour = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const amount = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
const windows = [5, 15, 30]

export default function MonitoringCharts({ request, devices, alerts, revision, checkedAt, focus, onCase, compact, onExpand, monitoring, interval, transport }) {
  const [samples, setSamples] = useState([])
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [minutes, setMinutes] = useState(5)
  const [selected, setSelected] = useState(focus?.id || '')
  const [anchor, setAnchor] = useState(focus?.timestamp || null)
  const [metric, setMetric] = useState(focus?.metric || 'traffic')

  useEffect(() => {
    const controller = new AbortController()
    async function update() {
      try {
        const data = await request('metrics', undefined, controller.signal)
        setSamples(data.samples)
        setUnavailable(false)
      } catch {
        if (!controller.signal.aborted) setUnavailable(true)
      } finally {
        if (!controller.signal.aborted) setReady(true)
      }
    }
    update()
    return () => controller.abort()
  }, [request, revision])

  const latest = samples.at(-1)?.timestamp ?? 0
  const end = anchor ? anchor + Math.min(60000, minutes * 15000) : latest
  const since = end - minutes * 60000
  const points = samples.filter(sample => sample.timestamp >= since && sample.timestamp <= end)
    .map(sample => ({
      timestamp: sample.timestamp,
      flags: (sample.flags ?? []).filter(flag => !selected || flag.deviceId === selected),
      limit: selected ? (sample.limits?.[selected]?.[metric === 'traffic' ? 0 : 1] ?? (metric === 'traffic' ? sample.threshold : undefined)) : undefined,
      value: selected ? sample.devices[selected]?.[metric === 'traffic' ? 0 : 1] : sample[metric],
    }))
  const last = points.at(-1)?.value
  const values = points.filter(point => point.value !== undefined)
  const peak = values.length ? Math.max(...values.map(point => point.value)) : undefined
  const flagged = points.flatMap(point => point.flags.map(flag => ({ ...flag, timestamp: point.timestamp })))
  const unit = metric === 'traffic' ? 'MB' : 'mensajes'
  const describe = value => `${amount.format(value)} ${metric === 'messages' && value === 1 ? 'mensaje' : unit}`
  const ledger = ['Alta', 'Media', 'Baja'].map(severity => ({
    severity,
    count: alerts.filter(alert => alert.severity === severity && alert.timestamp >= checkedAt - 3600000).length,
  }))
  const count = ledger.reduce((total, entry) => total + entry.count, 0)
  const ranked = [...devices].filter(device => !device.blocked && device.status === 'Conectado')
    .sort((a, b) => b.traffic - a.traffic).slice(0, 6)
  const top = ranked[0]?.traffic || 1

  const health = !monitoring ? 'Monitoreo pausado' : !latest ? 'Esperando la primera lectura' :
    checkedAt - latest > (interval * 2 + 3) * 1000 ? 'Datos atrasados' : 'Recibiendo lecturas'
  if (compact) return <section className="panel overview-chart">
    <div className="monitor-chart-heading"><div><h2>Tráfico del hogar</h2><p>Últimos 5 minutos · MB por intervalo</p></div>
      <span className="monitor-readout">{health}</span></div>
    {unavailable && <p role="status">Error al actualizar la telemetría.</p>}
    {values.length ? <><Trend points={points} unit={unit} /><p className="case-sub">Pico {describe(peak)} · {flagged.length} detecciones · Última muestra {hour.format(latest)}</p></> : <p className="chart-empty">Esperando telemetría del gateway.</p>}
    <button className="secondary-button" onClick={onExpand}>Ver gráficos de monitoreo</button>
  </section>

  return (
    <div className="monitoring-charts">
      <section className="panel trend-panel" aria-label="Tendencia de actividad">
        <div className="monitor-chart-heading">
          <div>
            <h2>Tendencia de actividad</h2>
            <p>{health} · Intervalo configurado de {interval} s.</p>
          </div>
          <span className="monitor-readout">{values.length} {values.length === 1 ? 'lectura' : 'lecturas'}</span>
        </div>
        {anchor && <p className="case-confirm">Ventana de la detección del {new Date(anchor).toLocaleString('es-PE')}. <button className="secondary-button" onClick={() => setAnchor(null)}>Volver al directo</button></p>}
        <div className="chart-controls">
          <label><span id="monitor-selected-label">Dispositivo</span>
            <select aria-labelledby="monitor-selected-label" value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">Todo el hogar</option>
              {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
          </label>
          <label><span id="monitor-metric-label">Indicador</span>
            <select aria-labelledby="monitor-metric-label" value={metric} onChange={event => setMetric(event.target.value)}>
              <option value="traffic">Volumen (MB)</option>
              <option value="messages">Mensajes</option>
            </select>
          </label>
          <label><span id="monitor-minutes-label">Ventana</span>
            <select aria-labelledby="monitor-minutes-label" value={minutes} onChange={event => setMinutes(Number(event.target.value))}>
              {windows.map(window => <option key={window} value={window}>{window} min</option>)}
            </select>
          </label>
        </div>
        {unavailable && <p role="status" className="chart-status">No se pudieron actualizar las lecturas.</p>}
        {values.length > 0 ? <>
          <div className="chart-indicators">
            <span>Último intervalo <strong>{last === undefined ? 'Sin lectura' : describe(last)}</strong></span>
            <span>Pico de la ventana <strong>{describe(peak)}</strong></span>
            <span>Detecciones en la ventana <strong>{flagged.length}</strong></span>
            <span>Última muestra <strong>{hour.format(points.at(-1).timestamp)}</strong></span>
          </div>
          <Trend points={points} unit={unit} />
          <p className="chart-legend"><span className="anomaly-dot" /> Lectura con anomalía
            {points.some(point => point.limit !== undefined) && <span className="threshold-label">— Umbral por dispositivo</span>}
          </p>
          {flagged.length > 0 && <section className="chart-incidents" aria-label="Lecturas con alerta">
            <h3>Lecturas con alerta</h3>
            <ul>{flagged.slice(-6).reverse().map((flag, index) =>
              <li key={`${flag.timestamp}-${flag.deviceId}-${index}`}>
                <time>{hour.format(flag.timestamp)}</time>
                <strong>{flag.reason}</strong>
                <span>{flag.detail}{flag.caseId && alerts.some(a => a.id === flag.caseId) && <><br/><button className="small-button" onClick={() => onCase(flag.caseId)}>Abrir caso</button></>}</span>
              </li>
            )}</ul>
          </section>}
          <details className="chart-details">
            <summary>Ver las últimas 12 lecturas</summary>
            <table>
              <thead><tr><th>Hora</th><th>Lectura ({unit})</th></tr></thead>
              <tbody>{values.slice(-12).reverse().map(point => <tr key={point.timestamp}>
                <td>{hour.format(point.timestamp)}</td><td>{amount.format(point.value)}</td>
              </tr>)}</tbody>
            </table>
          </details>
        </> : <p className="chart-empty">{ready ? 'Sin lecturas guardadas para este equipo y esta ventana.' : 'Cargando lecturas…'}</p>}
      </section>

      <section className="panel"><div className="monitor-chart-heading"><div><h2>Decisión del gateway</h2>
        <p>{transport?.broker || "MQTT"} · Último intervalo recibido de todo el hogar · {latest ? hour.format(latest) : 'Sin muestra'}</p></div></div>
        {samples.at(-1)?.admitted !== undefined ? <div className="chart-indicators">
          <span>Lecturas admitidas<strong>{samples.at(-1).admitted}</strong></span>
          <span>Retenidas por anomalía<strong>{samples.at(-1).flags.length}</strong></span>
          <span>Equipos aislados actualmente<strong>{devices.filter(d => d.blocked).length}</strong></span>
        </div> : <p className="chart-empty">A la espera de un intervalo con decisiones registradas.</p>}
        {transport && <p className="case-sub">{transport.relay.enabled
          ? `Reenvío HTTPS · Lotes entregados: ${transport.relay.sent} · Fallidos: ${transport.relay.failed} · Omitidos por cola llena: ${transport.relay.dropped}`
          : 'Reenvío externo desactivado. Las lecturas permanecen en este equipo.'}</p>}
      </section>
      <div className="monitor-grid">
        <section className="panel">
          <div className="monitor-chart-heading">
            <div><h2>Mayor actividad</h2><p>Volumen por dispositivo en el último intervalo.</p></div>
          </div>
          {ranked.length ? <ul className="rank-list">{ranked.map(device => <li key={device.id}>
            <div><strong>{device.name}</strong><span>{amount.format(device.traffic)} MB</span></div>
            <progress value={device.traffic} max={top} aria-label={`Volumen de ${device.name}`} />
          </li>)}</ul> : <p className="chart-empty">No hay dispositivos activos.</p>}
        </section>
        <section className="panel">
          <div className="monitor-chart-heading">
            <div><h2>Alertas por severidad</h2><p>Casos creados durante la última hora.</p></div>
            <span className="monitor-readout">{count} en total</span>
          </div>
          <ul className="rank-list severity-list">{ledger.map(entry => <li key={entry.severity} className={`chart-severity-${entry.severity.toLowerCase()}`}>
            <div><strong>{entry.severity}</strong><span>{entry.count}</span></div>
            <progress value={entry.count} max={count || 1} aria-label={`Alertas de severidad ${entry.severity}`} />
          </li>)}</ul>
        </section>
      </div>
    </div>
  )
}

function Trend({ points, unit }) {
  const width = 720
  const height = 218
  const left = 54
  const right = width - 28
  const top = 14
  const bottom = height - 34
  const start = points[0].timestamp
  const end = points.at(-1).timestamp
  const peak = Math.max(...points.map(point => Math.max(point.value ?? 0, point.limit ?? 0)))
  const max = unit === 'mensajes' ? Math.max(4, Math.ceil(peak / 4) * 4) : Math.max(1, Math.ceil(peak))
  const x = timestamp => right - (end - timestamp) / Math.max(1, end - start) * (right - left)
  const y = value => bottom - value / max * (bottom - top)
  const segments = []
  let segment = null
  let previous = null
  for (const point of points) {
    if (point.value === undefined || (previous !== null && point.timestamp - previous > 125000)) segment = null
    if (point.value !== undefined) {
      if (!segment) {
        segment = []
        segments.push(segment)
      }
      segment.push(point)
    }
    previous = point.timestamp
  }
  const thresholds = points.filter(point => point.limit !== undefined)
  const thresholdPath = thresholds.length === 1
    ? `${left},${y(thresholds[0].limit)} ${right},${y(thresholds[0].limit)}`
    : thresholds.map(point => `${x(point.timestamp)},${y(point.limit)}`).join(' ')
  const tickTimes = points.length < 2 ? [end] : [start, start + (end - start) / 2, end]
  return <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolución por intervalo en ${unit}`}>
    {[0, 1, 2, 3, 4].map(tick => {
      const value = max * tick / 4
      return <g key={tick}><line x1={left} x2={right} y1={y(value)} y2={y(value)} />
        <text x={left - 9} y={y(value) + 4} textAnchor="end">{amount.format(value)}</text></g>
    })}
    {tickTimes.map((timestamp, index) => <text key={timestamp} x={x(timestamp)} y={height - 9}
      textAnchor={index === 0 && tickTimes.length > 1 ? 'start' : timestamp === end ? 'end' : 'middle'}>{hour.format(timestamp)}</text>)}
    {thresholdPath && <polyline className="trend-threshold" points={thresholdPath} />}
    {segments.map(values => <g key={values[0].timestamp}>
      <polyline points={values.map(point => `${x(point.timestamp)},${y(point.value)}`).join(' ')} />
      {values.length <= 40 && values.map(point => <circle key={point.timestamp} cx={x(point.timestamp)} cy={y(point.value)} r="3.3">
        <title>{hour.format(point.timestamp)} · {amount.format(point.value)} {unit}</title>
      </circle>)}
    </g>)}
    {points.filter(point => point.flags.length && point.value !== undefined).map(point =>
      <circle className="trend-alert" key={point.timestamp} cx={x(point.timestamp)} cy={y(point.value)} r="5.5">
        <title>{point.flags.map(flag => `${flag.device}: ${flag.reason}`).join(' · ')}</title>
      </circle>)}
  </svg>
}
