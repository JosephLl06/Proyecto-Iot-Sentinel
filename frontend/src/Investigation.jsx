import { useState } from 'react'

const stamp = t => t ? new Date(t).toLocaleString('es-PE') : 'Sin registro'

export function DeviceProfile({device, threshold, now}) {
  if (!device) return null
  const count = device.normalVolumes?.length || 0
  const typical = device.typicalVolume
  const limit = device.volumeLimit ?? threshold
  return <section className="profile-card"><h3>Perfil de {device.name}</h3>
    <p>{device.room} · {device.ip} · Última lectura recibida {stamp(device.lastReadingAt)}</p>
    <dl className="case-evidence">
      <div><dt>Volumen habitual</dt><dd>{typical != null ? typical.toFixed(2)+' MB' : 'Sin muestras'}</dd><small>{count} muestras normales · {count >= 12 ? 'Perfil aprendido' : 'Aprendizaje inicial'}</small></div>
      <div><dt>Umbral actual</dt><dd>{limit.toFixed(2)} MB</dd><small>Hasta {device.profile?.maxMessages} mensajes por intervalo</small></div>
      <div><dt>Destinos habituales</dt><dd>{device.profile?.destinations?.join(', ') || 'Ninguno autorizado'}</dd></div>
    </dl>
    {device.blocked && <p>Equipo aislado{device.isolatedAt ? ' desde '+stamp(device.isolatedAt)+' · '+Math.max(0,Math.floor((now-device.isolatedAt)/1000))+' s transcurridos' : ''}.</p>}
    {!device.blocked && device.restoredAt && <p>Restablecido el {stamp(device.restoredAt)}. {device.recurrenceAt ? 'Se detectó otra anomalía el '+stamp(device.recurrenceAt) : device.lastReadingAt > device.restoredAt ? 'Las lecturas recibidas desde entonces siguen dentro del perfil.' : 'Esperando la primera lectura posterior.'}</p>}
  </section>
}

export function Comparison({comparison}) {
  if (!comparison) return <p>Todavía no hay una comparación guardada para este caso. Se captura al aislar el equipo desde la alerta.</p>
  const groups = [['Antes del caso',comparison.before],['Durante el caso',comparison.during],['Después de aislar',comparison.after]]
  const peak = Math.max(0.01,...groups.flatMap(([,rows]) => rows.map(r => r[1] ?? 0)))
  return <section className="profile-card"><h3>Resultado del aislamiento</h3>
    <p>Medida aplicada el {stamp(comparison.at)}. Se conservan hasta 12 intervalos por etapa.</p>
    <div className="phase-grid">{groups.map(([label,rows]) => {
      const readings = rows.filter(r => r[1] !== null)
      const max = readings.length ? Math.max(...readings.map(r=>r[1])) : null
      return <div key={label}><strong>{label}</strong><p>{max !== null ? 'Pico '+max+' MB' : rows.length ? 'Sin lecturas del equipo' : 'Sin intervalos disponibles'}</p>
        {max !== null && <progress max={peak} value={max} aria-label={'Pico de volumen '+label} />}
        <small>{readings.length} lecturas en {rows.length} intervalos observados</small></div>
    })}</div>
  </section>
}

export function ScenarioPanel({devices, submit, busy, monitoring, events, onCase}) {
  const active = devices.filter(d=>d.authorized && !d.blocked && d.status==='Conectado')
  const [id,setId] = useState('')
  const [kind,setKind] = useState('volume')
  const [message,setMessage] = useState('')
  const device = active.find(d=>d.id===id) || active[0]
  return <section className="panel"><h2>Pruebas controladas</h2>
    <p>Genera una lectura sintética en el siguiente intervalo y comprueba qué decisión toma el gateway.</p>
    <div className="chart-controls"><label>Equipo de prueba<select aria-label="Equipo de prueba" value={device?.id || ''} onChange={e=>setId(e.target.value)}>
    {active.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label>Escenario<select aria-label="Escenario" value={kind} onChange={e=>setKind(e.target.value)}><option value="volume">Pico de volumen</option><option value="destination">Destino desconocido</option><option value="identity">Identidad no autorizada</option></select></label></div>
    <button className="secondary-button" disabled={busy || !monitoring || !device || !!device.scenario} onClick={()=>submit('scenario',{id:device.id,kind},()=>setMessage('Prueba programada para '+device.name),setMessage)}>Ejecutar prueba</button>
    <span role="status"> {device?.scenario ? 'Pendiente de recepción' : message}</span>
    {events.filter(e=>e.testId).slice(0,3).map(e=><p key={e.id}>{e.detail} · {e.deviceName} · {stamp(e.timestamp)} <button className="small-button" onClick={()=>onCase(e.caseId)}>Ver resultado</button></p>)}
  </section>
}
