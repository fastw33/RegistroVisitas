const { randomBytes, createHash, randomUUID } = require('node:crypto')
const QRCode = require('qrcode')
const Cita = require('./cita.model')
const Visitante = require('../visitantes/visitante.model')
const Sede = require('../sedes/sede.model')
const Usuario = require('../usuarios/usuario.model')
const transaction = require('../../utils/transaction')
const { record } = require('../auditoria/auditoria.service')
const { required, list, agendaScope: ownScope } = require('../../utils/query')
const { event } = require('../../utils/model')
const env = require('../../config/env')
const ApiError = require('../../utils/ApiError')
const { windowStatus } = require('./cita.horario')
const hash = token => createHash('sha256').update(token).digest('hex')
function checkDates(inicio, fin) {
  if (+inicio <= Date.now() || +fin <= +inicio || +fin - +inicio > 24 * 60 * 60 * 1000) throw new ApiError(422, 'La cita debe ser futura y durar entre 1 milisegundo y 24 horas')
}
async function references(data, session, { optionalHost = false } = {}) {
  if (!data.sede) data.sede = await require('../sedes/sede.service').currentOffice(session)
  // Escribir el visitante serializa cambios de identidad/activación con los ingresos y agendas.
  const visitante = await Visitante.findOneAndUpdate({ _id: data.visitante, activo: true }, { $set: { updatedAt: new Date() } }, { session, returnDocument: 'after' })
  if (!visitante) throw new ApiError(404, 'Visitante activo no encontrado')
  await required(Sede, data.sede, session, { activa: true })
  if (!optionalHost || data.anfitrion) await required(Usuario, data.anfitrion, session, { activo: true })
  return visitante
}
const create = (data, actor) => transaction(async session => {
  checkDates(data.inicio, data.fin)
  const visitor = await references(data, session)
  const host = await required(Usuario, data.anfitrion, session, { activo: true })
  const { repeticion, ...fields } = data
  const serieId = repeticion ? randomUUID() : undefined
  const tokens = []
  const entries = Array.from({ length: repeticion?.cantidad || 1 }, (_, index) => {
    const offset = index * (repeticion?.cadaSemanas || 1) * 7 * 86400000
    const token = randomBytes(32).toString('hex'); tokens.push(token)
    return { ...fields, inicio: new Date(+data.inicio + offset), fin: new Date(+data.fin + offset), serieId, creadoPor: actor._id, estado: 'aprobada', paseHash: hash(token), paseEmitidoEn: new Date(), eventos: [event(actor, 'crear'), event(actor, 'aprobar', 'Aprobación automática al agendar'), event(actor, 'emitir_pase')] }
  })
  const rows = await Cita.create(entries, { session, ordered: true })
  const pases = []
  for (const [index, row] of rows.entries()) {
    await record(actor, 'crear', 'citas', row._id, session)
    await record(actor, 'aprobar', 'citas', row._id, session)
    await record(actor, 'emitir_pase', 'citas', row._id, session)
    pases.push(await passResult(row, visitor, host, tokens[index]))
  }
  return { data: pases.map(pase => pase.cita), serieId, pases }
})
async function passResult(row, visitor, host, token) {
  const cita = row.toObject(); delete cita.paseHash
  return { cita, invitacion: { visitante: `${visitor.nombres} ${visitor.apellidos}`, anfitrion: host.nombre, motivo: row.motivo, inicio: row.inicio, fin: row.fin }, token, qrDataUrl: await QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 2 }), finProgramado: row.fin }
}
const displayReferences = [
  { path: 'visitante', select: 'nombres apellidos empresa' },
  { path: 'sede', select: 'codigo nombre zonaHoraria' },
  { path: 'anfitrion', select: 'nombre' },
]
const getById = async (id, actor) => (await required(Cita, id, null, ownScope(actor))).populate(displayReferences)
async function getAll(query, actor) {
  const filter = { ...ownScope(actor) }
  for (const field of ['sede', 'visitante', 'estado']) if (query[field]) filter[field] = query[field]
  if (query.anfitrion && actor.rol !== 'anfitrion') filter.anfitrion = query.anfitrion
  if (query.desde || query.hasta) filter.inicio = { ...(query.desde ? { $gte: new Date(query.desde) } : {}), ...(query.hasta ? { $lte: new Date(query.hasta) } : {}) }
  return list(Cita, filter, query, undefined, displayReferences, { inicio: 1, _id: 1 })
}
const action = (id, accion, data, actor) => transaction(async session => {
  const cita = await required(Cita, id, session, ownScope(actor))
  if (!['pendiente', 'aprobada'].includes(cita.estado)) throw new ApiError(409, 'La cita ya no permite esta operación', 'INVALID_STATE')
  if (accion === 'aprobar') {
    if (+cita.fin < Date.now()) throw new ApiError(409, 'La cita ya venció')
    await references(cita, session); cita.estado = 'aprobada'
  } else if (accion === 'cancelar') {
    cita.estado = 'cancelada'; cita.paseHash = undefined
  } else if (accion === 'no-asistio') {
    if (Date.now() <= +cita.fin + env.lateMinutes * 60000) throw new ApiError(409, 'La ventana de ingreso aún no ha terminado')
    cita.estado = 'no_asistio'; cita.paseHash = undefined
  } else if (accion === 'reprogramar') {
    checkDates(data.inicio, data.fin); cita.inicio = data.inicio; cita.fin = data.fin
    cita.estado = 'pendiente'; cita.paseHash = undefined
  }
  cita.eventos.push(event(actor, accion, data.motivo)); await cita.save({ session })
  await record(actor, accion, 'citas', id, session); return cita
})
async function issuePass(id, actor) {
  const token = randomBytes(32).toString('hex')
  const issued = await transaction(async session => {
    const row = await required(Cita, id, session, ownScope(actor))
    if (row.estado !== 'aprobada') throw new ApiError(409, 'Solo se emiten pases de citas aprobadas')
    // Serialize pass issuance with identity corrections, even if no old pass exists.
    const visitor = await Visitante.findOneAndUpdate({ _id: row.visitante, activo: true }, { $set: { updatedAt: new Date() } }, { session, returnDocument: 'after' })
    if (!visitor) throw new ApiError(404, 'Visitante activo no encontrado')
    const host = await required(Usuario, row.anfitrion, session, { activo: true })
    row.paseHash = hash(token); row.paseEmitidoEn = new Date(); row.eventos.push(event(actor, 'emitir_pase'))
    await row.save({ session }); await record(actor, 'emitir_pase', 'citas', id, session)
    return passResult(row, visitor, host, token)
  })
  return issued
}
async function resolvePass(token) {
  const cita = await Cita.findOne({ paseHash: hash(token) })
  if (!cita) throw new ApiError(404, 'Pase inexistente, revocado o ya utilizado', 'PASS_NOT_FOUND')
  const visitante = await Visitante.findById(cita.visitante).select('tipoDocumento numeroDocumento nombres apellidos activo').lean()
  const sede = await Sede.findById(cita.sede).select('activa').lean()
  const anfitrion = await Usuario.findById(cita.anfitrion).select('activo').lean()
  const status = visitante?.activo && sede?.activa && anfitrion?.activo ? windowStatus(cita) : { valido: false, motivo: 'Visitante, sede o anfitrión inactivo' }
  return { cita, visitante, ...status }
}
module.exports = { create, getById, getAll, action, issuePass, resolvePass, hash, windowStatus, references }
