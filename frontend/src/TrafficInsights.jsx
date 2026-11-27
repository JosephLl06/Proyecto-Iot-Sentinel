const number = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
const clock = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function PeakPanel({ rows, metric, selected, names, onInspect }) {
  const index = metric === 'traffic' ? 0 : 1
  const unit = metric === 'traffic' ? 'MB' : 'mensajes'
  const valueOf = row => selected ? row.devices?.[selected]?.[index] : row[metric]
  const available = rows.filter(row => Number.isFinite(valueOf(row)))
  const peak = available.reduce((best, row) => !best || valueOf(row) >= valueOf(best) ? row : best, null)
  const ordered = available.map(valueOf).sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  const median = (ordered[middle] + ordered[Math.floor((ordered.length - 1) / 2)]) / 2
  const contributors = Object.entries(peak?.devices ?? {})
    .filter(([, pair]) => Number.isFinite(pair[index]) && pair[index] > 0)
    .sort(([, a], [, b]) => b[index] - a[index]).slice(0, 3)
  return <section className="panel insights-panel">
    <h2>¿Qué equipos aportaron al pico?</h2>
    <p>{selected ? 'Intervalo de mayor actividad de ' + (names.get(selected) || selected) : 'Intervalo de mayor actividad del hogar'}</p>
    {peak ? <>
      <div className="peak-facts"><div><small>Pico observado</small><strong>{number.format(valueOf(peak))} {unit}</strong></div>
        <div><small>Hora del pico</small><b>{clock.format(peak.timestamp)}</b></div>
        {ordered.length >= 3 && <div><small>Mediana por intervalo</small><b>{number.format(median)} {unit}</b></div>}
      </div>
      {contributors.length > 0 && <>
        <p>Mayor aporte al total del hogar en ese instante</p>
        <ul className="rank-list peak-list">{contributors.map(([id, pair]) => <li key={id}>
          <div><button className="device-link" onClick={() => onInspect(id, peak.timestamp, metric)}>{names.get(id) || id}</button>
            <span>{number.format(pair[index])} {unit} · {number.format(100 * pair[index] / peak[metric])} %</span></div>
          <progress value={pair[index]} max={peak[metric]} aria-label={'Aporte de ' + (names.get(id) || id)}/>
        </li>)}</ul></>}
      {Array.isArray(peak.flags) && <p className="peak-note">{peak.flags.length
        ? 'El gateway retuvo ' + peak.flags.length + (peak.flags.length === 1 ? ' lectura del hogar' : ' lecturas del hogar') + ' en ese intervalo.'
        : 'El gateway no registró anomalías en ese intervalo.'}</p>}
    </> : <p className="chart-empty">Sin lecturas para identificar el pico.</p>}
  </section>
}

function DecisionsPanel({ rows, since, end, selected, names }) {
  const width = (end - since) / 6
  const bins = Array.from({ length: 6 }, (_, i) => ({ start: since + i * width, passed: 0, held: 0, measured: 0 }))
  let measured = 0
  for (const row of rows) {
    if (!Number.isInteger(row.admitted) || !Array.isArray(row.flags)) continue
    if (selected && !row.devices?.[selected]) continue
    const held = selected ? Number(row.flags.some(flag => flag.deviceId === selected)) : row.flags.length
    const bin = bins[Math.min(5, Math.floor((row.timestamp - since) / width))]
    bin.held += held
    bin.passed += selected ? 1 - held : row.admitted
    bin.measured++
    measured++
  }
  const total = bins.reduce((sum, bin) => sum + bin.held + bin.passed, 0)
  const retained = bins.reduce((sum, bin) => sum + bin.held, 0)
  return <section className="panel insights-panel">
    <h2>¿Cuándo se retuvieron lecturas?</h2>
    <p>{names.get(selected) || 'Todo el hogar'} · {measured} intervalos con decisiones registradas</p>
    {measured > 0 ? <>
      <div className="decision-total"><strong>{retained} de {total}</strong> lecturas retenidas</div>
      <div className="decision-key"><span>Admitidas</span><span>Retenidas</span></div>
      <table className="decision-table"><thead><tr><th>Desde</th><th>Distribución</th><th>Retenidas / total</th></tr></thead>
        <tbody>{bins.map(bin => {
          const count = bin.passed + bin.held
          return <tr key={bin.start}><th scope="row">{clock.format(bin.start)}</th>
            <td>{count > 0 && <div className="decision-bar" aria-hidden="true">
              <i style={{width: (100 * bin.passed / count) + '%'}}/></div>}</td>
            <td>{count ? bin.held + ' / ' + count : bin.measured ? '0 / 0' : 'Sin datos'}</td></tr>
        })}</tbody></table>
    </> : <p className="chart-empty">Todavía no hay decisiones registradas para esta selección.</p>}
  </section>
}

export default function TrafficInsights({ rows, metric, selected, devices, since, end, onInspect }) {
  const names = new Map(devices.map(device => [device.id, device.name]))
  return <>
    <PeakPanel rows={rows} metric={metric} selected={selected} names={names} onInspect={onInspect}/>
    <DecisionsPanel rows={rows} since={since} end={end} selected={selected} names={names}/>
  </>
}
