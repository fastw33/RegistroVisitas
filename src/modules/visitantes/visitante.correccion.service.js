const { createHash } = require('node:crypto')
const Visitante = require('./visitante.model')
const Correccion = require('./visitante.correccion.model')
const Visita = require('../visitas/visita.model')
const Cita = require('../citas/cita.model')
const transaction = require('../../utils/transaction')
const { required, list } = require('../../utils/query')
const { record } = require('../auditoria/auditoria.service')
const { event } = require('../../utils/model')
const ApiError = require('../../utils/ApiError')
const keys = ['tipoDocumento', 'numeroDocumento', 'nombres', 'apellidos']
const snapshot = value => Object.fromEntries(keys.map(key => [key, String(value[key] || '').trim().normalize('NFC')]))
function admin(actor) { if (actor.rol !== 'admin') throw new ApiError(403, 'Solo administración puede corregir la identidad') }
async function previous(key, digest) {
  const old = await Correccion.findOne({ requestKey: key }).select('+requestHash')
  if (!old) return null
  if (old.requestHash !== digest) throw new ApiError(409, 'El intento de corrección ya se utilizó con otros datos', 'IDEMPOTENCY_CONFLICT')
  const object = old.toObject(); delete object.requestHash; delete object.requestKey
  return { visitante: await required(Visitante, old.visitante), correccion: object, reutilizada: true }
}
async function correct(id, data, actor) {
  admin(actor)
  const anterior = snapshot(data.anterior), correccion = snapshot(data.correccion)
  correccion.numeroDocumento = correccion.numeroDocumento.toUpperCase()
  const motivo = data.motivo.trim()
  const digest = createHash('sha256').update(JSON.stringify({ id: String(id), actor: String(actor._id), anterior, correccion, motivo })).digest('hex')
  const old = await previous(data.requestKey, digest); if (old) return old
  try {
    return await transaction(async session => {
      const row = await required(Visitante, id, session)
      if (JSON.stringify(snapshot(row)) !== JSON.stringify(anterior)) throw new ApiError(409, 'La ficha cambió. Carga la ficha actual y revisa la corrección.', 'VISITOR_CHANGED')
      if (JSON.stringify(anterior) === JSON.stringify(correccion)) throw new ApiError(422, 'No hay cambios de identidad para guardar', 'NO_CHANGES')
      const duplicate = await Visitante.findOne({ tipoDocumento: correccion.tipoDocumento, numeroDocumento: correccion.numeroDocumento, _id: { $ne: id } }).session(session)
      if (duplicate) throw new ApiError(409, 'Ese documento ya pertenece a otra ficha. No se pueden fusionar visitantes desde esta corrección.', 'DOCUMENT_IN_USE')
      row.set(correccion); await row.save({ session })
      const [change] = await Correccion.create([{ visitante: id, anterior, correccion, motivo, registradoPor: actor._id, requestKey: data.requestKey, requestHash: digest }], { session })
      const fields = Object.fromEntries(keys.map(key => [`identidad.${key}`, correccion[key]]))
      await Visita.updateMany({ visitante: id, estado: { $in: ['pendiente', 'autorizada', 'dentro'] } }, { $set: fields, $push: { eventos: event(actor, 'corregir_identidad', motivo) } }, { session, runValidators: true })
      await Cita.updateMany({ visitante: id, paseHash: { $exists: true } }, { $unset: { paseHash: 1, paseEmitidoEn: 1 }, $push: { eventos: event(actor, 'revocar_pase_por_correccion', motivo) } }, { session })
      await record(actor, 'corregir_identidad', 'visitantes', id, session)
      const object = change.toObject(); delete object.requestKey; delete object.requestHash
      return { visitante: row, correccion: object }
    })
  } catch (error) {
    if (error.code === 11000) {
      const result = await previous(data.requestKey, digest); if (result) return result
      throw new ApiError(409, 'Ese documento ya pertenece a otra ficha', 'DOCUMENT_IN_USE')
    }
    throw error
  }
}
async function history(id, query, actor) {
  admin(actor); await required(Visitante, id)
  return list(Correccion, { visitante: id }, query, '', { path: 'registradoPor', select: 'nombre' })
}
module.exports = { correct, history, snapshot }
