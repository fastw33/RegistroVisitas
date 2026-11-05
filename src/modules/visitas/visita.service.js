const { createHash } = require('node:crypto')
const Visita = require('./visita.model')
const Cita = require('../citas/cita.model')
const citas = require('../citas/cita.service')
const { requireConsent } = require('../consentimientos/consentimiento.service')
const transaction = require('../../utils/transaction')
const { required, list, ownScope } = require('../../utils/query')
const { event } = require('../../utils/model')
const { record } = require('../auditoria/auditoria.service')
const ApiError = require('../../utils/ApiError')
const vehicleFingerprint = require('./visita.vehiculo').fingerprint

function identity(v) { return { tipoDocumento: v.tipoDocumento, numeroDocumento: v.numeroDocumento, nombres: v.nombres, apellidos: v.apellidos, empresa: v.empresa } }
function publicVisit(row) { const value = row.toObject ? row.toObject() : { ...row }; delete value.idempotencyKey; delete value.requestHash; return value }
const create = (data, actor) => transaction(async session => {
  const visitante = await citas.references(data, session)
  const [row] = await Visita.create([{ ...data, identidad: identity(visitante), eventos: [event(actor, 'solicitar_ingreso')] }], { session })
  await record(actor, 'solicitar_ingreso', 'visitas', row._id, session); return row
})
const authorize = (id, aprobar, motivo, actor) => transaction(async session => {
  const row = await required(Visita, id, session, ownScope(actor))
  if (row.estado !== 'pendiente') throw new ApiError(409, 'La solicitud ya fue resuelta', 'INVALID_STATE')
  if (aprobar) await citas.references(row, session)
  row.estado = aprobar ? 'autorizada' : 'rechazada'; row.autorizadoPor = actor._id
  row.eventos.push(event(actor, aprobar ? 'autorizar' : 'rechazar', motivo)); await row.save({ session })
  await record(actor, aprobar ? 'autorizar' : 'rechazar', 'visitas', id, session); return row
})
const enter = (id, actor, data = {}) => transaction(async session => {
  const row = await required(Visita, id, session)
  if (row.estado === 'dentro') return row // Reintentar el mismo ingreso no duplica eventos.
  if (row.estado !== 'autorizada') throw new ApiError(409, 'La visita debe estar autorizada', 'INVALID_STATE')
  const visitante = await citas.references(row, session)
  const consent = await requireConsent(row.visitante, 'registro_visitas', session)
  row.estado = 'dentro'; row.entradaEn = new Date(); row.entradaPor = actor._id
  row.identidadVerificada = true; row.consentimientoRegistro = consent._id; row.identidad = identity(visitante)
  if (Object.prototype.hasOwnProperty.call(data, 'vehiculo')) row.vehiculo = data.vehiculo || undefined
  row.eventos.push(event(actor, 'entrada')); await row.save({ session })
  await record(actor, 'entrada', 'visitas', id, session); return row
})
function fingerprint(data, actor) {
  // req.datos ya está validado y el orden lo determina el servidor.
  const ordered = { actor: String(actor._id), cita: data.cita || null, token: data.token || null, identidadVerificada: true,
    equipos: (data.equipos || []).map(e => ({ descripcion: e.descripcion, serial: e.serial || null })), observaciones: data.observaciones || null,
    ...vehicleFingerprint(data) }
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}
async function previous(key, digest, session) {
  const row = await Visita.findOne({ idempotencyKey: key }).select('+requestHash').session(session || null)
  if (!row) return null
  if (row.requestHash !== digest) throw new ApiError(409, 'Idempotency-Key ya fue utilizada con otro contenido', 'IDEMPOTENCY_CONFLICT')
  return publicVisit(row)
}
async function enterDirect(data, key, actor) {
  const ordered = {
    operation: 'entrada_sin_cita', actor: String(actor._id), visitante: data.visitante,
    sede: data.sede || null, anfitrion: data.anfitrion || null, motivo: data.motivo, area: data.area || null,
    identidadVerificada: true, equipos: (data.equipos || []).map(e => ({ descripcion: e.descripcion, serial: e.serial || null })),
    observaciones: data.observaciones || null,
    ...vehicleFingerprint(data),
  }
  const digest = createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
  try {
    return await transaction(async session => {
      const old = await previous(key, digest, session); if (old) return old
      const fields = { ...data }
      const visitante = await citas.references(fields, session, { optionalHost: true })
      const consent = await requireConsent(fields.visitante, 'registro_visitas', session)
      const [row] = await Visita.create([{
        ...fields, estado: 'dentro', entradaEn: new Date(), entradaPor: actor._id,
        autorizadoPor: actor._id, identidadVerificada: true, identidad: identity(visitante),
        consentimientoRegistro: consent._id, idempotencyKey: key, requestHash: digest,
        // Recepción registra por su propio permiso; no se atribuye aprobación al anfitrión.
        eventos: [event(actor, 'entrada_sin_cita')],
      }], { session })
      await record(actor, 'entrada_sin_cita', 'visitas', row._id, session)
      return publicVisit(row)
    })
  } catch (error) {
    if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) {
      const old = await previous(key, digest); if (old) return old
    }
    throw error
  }
}
async function enterAppointment(data, key, actor) {
  const digest = fingerprint(data, actor)
  try {
    return await transaction(async session => {
      const old = await previous(key, digest, session); if (old) return old
      const cita = data.cita ? await required(Cita, data.cita, session) : await Cita.findOne({ paseHash: citas.hash(data.token) }).session(session)
      if (!cita) throw new ApiError(404, 'Pase inexistente, revocado o utilizado')
      const status = citas.windowStatus(cita)
      if (!status.valido) throw new ApiError(409, status.motivo, 'INVALID_APPOINTMENT')
      const visitante = await citas.references(cita, session)
      const consent = await requireConsent(cita.visitante, 'registro_visitas', session)
      const [row] = await Visita.create([{
        visitante: cita.visitante, sede: cita.sede, anfitrion: cita.anfitrion, cita: cita._id,
        motivo: cita.motivo, area: cita.area, estado: 'dentro', entradaEn: new Date(), entradaPor: actor._id,
        autorizadoPor: cita.eventos.findLast(e => e.accion === 'aprobar')?.actor,
        identidadVerificada: true, identidad: identity(visitante), consentimientoRegistro: consent._id,
        equipos: data.equipos, observaciones: data.observaciones, vehiculo: data.vehiculo, idempotencyKey: key, requestHash: digest,
        eventos: [event(actor, 'entrada_con_cita', status.avisoHorario?.mensaje)],
      }], { session })
      cita.estado = 'ingresada'; cita.paseHash = undefined; cita.eventos.push(event(actor, 'ingreso', status.avisoHorario?.mensaje))
      await cita.save({ session }); await record(actor, 'entrada_con_cita', 'visitas', row._id, session)
      return publicVisit(row)
    })
  } catch (error) {
    if (error.code === 11000 || error.hasErrorLabel?.('TransientTransactionError')) {
      const old = await previous(key, digest); if (old) return old
    }
    throw error
  }
}
const exit = (id, actor) => transaction(async session => {
  const row = await required(Visita, id, session)
  if (row.estado === 'finalizada') return row
  if (row.estado !== 'dentro') throw new ApiError(409, 'La visita no tiene una entrada activa', 'INVALID_STATE')
  row.estado = 'finalizada'; row.salidaEn = new Date(); row.salidaPor = actor._id
  row.eventos.push(event(actor, 'salida')); await row.save({ session })
  if (row.cita) {
    const cita = await required(Cita, row.cita, session); cita.estado = 'finalizada'; cita.eventos.push(event(actor, 'salida')); await cita.save({ session })
  }
  await record(actor, 'salida', 'visitas', id, session); return row
})
const getById = (id, actor) => required(Visita, id, null, ownScope(actor))
const getAll = (query, actor) => {
  const filter = { ...ownScope(actor) }
  for (const key of ['visitante', 'sede', 'estado']) if (query[key]) filter[key] = query[key]
  if (query.anfitrion && actor.rol !== 'anfitrion') filter.anfitrion = query.anfitrion
  if (query.desde || query.hasta) filter.createdAt = { ...(query.desde ? { $gte: new Date(query.desde) } : {}), ...(query.hasta ? { $lte: new Date(query.hasta) } : {}) }
  return list(Visita, filter, query)
}
async function summary(actor) {
  const rows = await Visita.aggregate([{ $match: ownScope(actor) }, { $group: { _id: '$estado', cantidad: { $sum: 1 } } }])
  return Object.fromEntries(['pendiente', 'autorizada', 'dentro', 'finalizada', 'rechazada'].map(state => [state, rows.find(r => r._id === state)?.cantidad || 0]))
}
module.exports = { create, authorize, enter, enterDirect, enterAppointment, exit, getById, getAll, summary }
