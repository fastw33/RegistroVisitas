const Consentimiento = require('./consentimiento.model')
const Visitante = require('../visitantes/visitante.model')
const transaction = require('../../utils/transaction')
const { record } = require('../auditoria/auditoria.service')
const { list, required } = require('../../utils/query')
const ApiError = require('../../utils/ApiError')
const defaults = require('../../config/privacy')
const texts = Object.freeze({
  datos_documento: 'El visitante autoriza guardar los datos opcionales de esta sección para complementar su ficha de visitas, incluido el RH como dato sensible de salud. Puede ingresar sin autorizarlos y solicitar su eliminación.',
  registro_visitas: 'Autorizo el tratamiento de mis datos de identificación y de mis visitas para gestionar la agenda, verificar el acceso y registrar entradas y salidas de las oficinas. Puedo consultar, actualizar y solicitar la supresión de mis datos conforme a la política de tratamiento y a las obligaciones legales aplicables.',
  foto_rostro: 'Autorizo de manera expresa y voluntaria la captura y conservación temporal de una fotografía de mi rostro para verificación visual por recepción. No incluye reconocimiento facial automático. Entiendo que es un dato sensible y que puedo ingresar mediante verificación documental sin autorizar esta fotografía.',
  foto_documento: 'Autorizo de manera expresa y voluntaria conservar temporalmente una imagen de mi documento para soporte de verificación de identidad de la visita. Puedo optar por verificación visual del documento sin conservar su imagen.',
})
function policy() {
  const responsable = (process.env.PRIVACY_RESPONSIBLE || '').trim() || defaults.responsable
  // No asignar el contacto de Fastwaysas a otra empresa configurada por entorno.
  const contacto = (process.env.PRIVACY_CONTACT || '').trim() || (responsable.toLowerCase() === defaults.responsable.toLowerCase() ? defaults.contacto : '')
  return { version: '1.0', responsable, contacto, finalidades: texts, aviso: 'Texto base que el responsable debe revisar y acompañar con su política de tratamiento antes de uso real.' }
}
async function requireConsent(visitante, finalidad, session) {
  const filter = { visitante, finalidad, revocadoEn: null }
  const consent = session
    ? await Consentimiento.findOneAndUpdate(filter, { $set: { updatedAt: new Date() } }, { sort: { createdAt: -1 }, session, returnDocument: 'after' })
    : await Consentimiento.findOne(filter).sort({ createdAt: -1 })
  if (!consent) throw new ApiError(422, `Falta autorización vigente para ${finalidad}`, 'CONSENT_REQUIRED')
  return consent
}
const create = (data, actor) => transaction(async session => {
  const p = policy()
  if (!p.responsable || !p.contacto) throw new ApiError(503, 'Configure responsable y contacto de protección de datos antes de registrar autorizaciones')
  if (data.version !== p.version) throw new ApiError(409, 'Debe presentar la versión vigente del texto de autorización')
  await required(Visitante, data.visitante, session, { activo: true })
  const { aceptado, ...fields } = data
  const [row] = await Consentimiento.create([{ ...fields, texto: texts[data.finalidad], responsable: p.responsable, contacto: p.contacto, registradoPor: actor._id }], { session })
  await record(actor, 'otorgar', 'consentimientos', row._id, session); return row
})
const revoke = (id, motivo, actor) => transaction(async session => {
  const row = await required(Consentimiento, id, session)
  if (row.revocadoEn) return row
  row.revocadoEn = new Date(); row.revocadoPor = actor._id; row.motivoRevocacion = motivo
  if (row.finalidad === 'datos_documento') {
    await Visitante.updateOne({ _id: row.visitante, consentimientoDocumento: row._id }, { $unset: { datosDocumento: 1, consentimientoDocumento: 1 } }, { session })
  }
  await row.save({ session }); await record(actor, 'revocar', 'consentimientos', id, session)
  return row
})
const getAll = query => list(Consentimiento, { visitante: query.visitante }, query)
module.exports = { policy, requireConsent, create, revoke, getAll }
