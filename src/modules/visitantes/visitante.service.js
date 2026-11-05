const Visitante = require('./visitante.model')
const transaction = require('../../utils/transaction')
const { list, required, escaped } = require('../../utils/query')
const { record } = require('../auditoria/auditoria.service')
const Consentimiento = require('../consentimientos/consentimiento.model')
const { policy } = require('../consentimientos/consentimiento.service')
const ApiError = require('../../utils/ApiError')
const getAll = query => list(Visitante, {
  ...(query.documento ? { numeroDocumento: query.documento.toUpperCase() } : {}),
  ...(query.q ? { $or: ['nombres', 'apellidos', 'empresa'].map(key => ({ [key]: { $regex: escaped(query.q), $options: 'i' } })) } : {}),
}, query)
const getById = id => required(Visitante, id)
const identity = query => Visitante.findOne({ tipoDocumento: query.tipoDocumento, numeroDocumento: query.numeroDocumento.toUpperCase(), activo: true }).select('_id tipoDocumento numeroDocumento nombres apellidos empresa').lean()
const create = (data, actor) => transaction(async session => {
  const [row] = await Visitante.create([{ ...data, creadoPor: actor._id }], { session })
  await record(actor, 'crear', 'visitantes', row._id, session); return row
})
const update = (id, data, actor) => transaction(async session => {
  const row = await required(Visitante, id, session); row.set(data); await row.save({ session })
  await record(actor, 'actualizar', 'visitantes', id, session); return row
})
const saveDocument = (id, data, actor) => transaction(async session => {
  const p = policy()
  if (!p.responsable || !p.contacto) throw new ApiError(503, 'Falta configurar responsable y contacto')
  if (data.aceptado !== true) throw new ApiError(422, 'Se requiere autorización expresa', 'CONSENT_REQUIRED')
  if (data.version !== p.version) throw new ApiError(409, 'Debe presentar la versión vigente del texto de autorización')
  const row = await required(Visitante, id, session, { activo: true })
  let consent = await Consentimiento.findOne({ visitante: id, finalidad: 'datos_documento', revocadoEn: null }).session(session)
  if (!consent) {
    ;[consent] = await Consentimiento.create([{
      visitante: id, finalidad: 'datos_documento', version: p.version, texto: p.finalidades.datos_documento,
      responsable: p.responsable, contacto: p.contacto, medio: 'casilla',
      evidencia: 'Autorización expresa y voluntaria del visitante para guardar los datos opcionales del documento, incluido el RH como dato sensible; el ingreso puede realizarse sin estos datos.',
      registradoPor: actor._id,
    }], { session })
    await record(actor, 'otorgar', 'consentimientos', consent._id, session)
  }
  row.datosDocumento = data.datosDocumento
  row.consentimientoDocumento = consent._id
  await row.save({ session })
  await record(actor, 'actualizar_datos_documento', 'visitantes', id, session)
  const result = row.toObject(); delete result.consentimientoDocumento
  return result
})
module.exports = { getAll, getById, create, update, identity, saveDocument }
