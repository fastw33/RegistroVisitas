const { randomUUID, createHash } = require('node:crypto')
const { compress } = require('./archivo.image')
const Archivo = require('./archivo.model')
const Consentimiento = require('../consentimientos/consentimiento.model')
const Visitante = require('../visitantes/visitante.model')
const Visita = require('../visitas/visita.model')
const { requireConsent } = require('../consentimientos/consentimiento.service')
const { getStorage } = require('../../integrations/s3')
const { required, list } = require('../../utils/query')
const transaction = require('../../utils/transaction')
const { record } = require('../auditoria/auditoria.service')
const env = require('../../config/env')
const ApiError = require('../../utils/ApiError')
const privateFields = '+storageKey +storageBucket +storageVersionId'
function publicFile(row) {
  const result = row.toObject ? row.toObject() : { ...row }
  for (const field of ['storageKey', 'storageBucket', 'storageVersionId']) delete result[field]
  return result
}
async function deleteObject(row) {
  await getStorage().remove(row.storageKey, row.storageBucket, row.storageVersionId)
  await Archivo.updateOne({ _id: row._id }, { $set: { storageEliminadoEn: new Date() } })
}

async function upload(data, file, actor) {
  await requireConsent(data.visitante, data.tipo)
  const { buffer, ...image } = await compress(file, data.tipo)
  const storage = getStorage()
  const storageKey = `${env.s3.prefix}/fotos/${randomUUID()}.webp`
  storage.validate(storageKey)
  // Guardar la intención antes de subir permite recuperar cargas interrumpidas
  // sin recorrer ni borrar objetos ajenos del bucket compartido.
  const staged = await transaction(async session => {
    await required(Visitante, data.visitante, session, { activo: true })
    const consent = await requireConsent(data.visitante, data.tipo, session)
    const visit = data.visita ? await required(Visita, data.visita, session, { visitante: data.visitante }) : null
    if (['foto_vehiculo', 'foto_placa'].includes(data.tipo) && !visit?.vehiculo?.presente)
      throw new ApiError(422, 'Registre el vehículo en esta visita antes de adjuntar sus fotos', 'VEHICLE_REQUIRED')
    const [row] = await Archivo.create([{
      ...data, consentimiento: consent._id, storageKey, storageBucket: env.s3.bucket,
      storageEstado: 'pendiente', bytes: buffer.length, ...image,
      sha256: createHash('sha256').update(buffer).digest('hex'), subidoPor: actor._id,
      venceEn: new Date(Date.now() + env.photoRetentionDays * 86400000),
    }], { session })
    return row
  })
  let object
  try {
    object = await storage.put(storageKey, buffer, image.mime)
    return await transaction(async session => {
      const row = await required(Archivo, staged._id, session, { storageEstado: 'pendiente', eliminadoEn: null })
      const consent = await Consentimiento.findOneAndUpdate({ _id: row.consentimiento, revocadoEn: null }, { $set: { updatedAt: new Date() } }, { session, returnDocument: 'after' })
      if (!consent) throw new ApiError(422, 'La autorización fue revocada durante la carga', 'CONSENT_REQUIRED')
      row.storageEstado = 'disponible'; row.storageVersionId = object.versionId
      await row.save({ session }); await record(actor, 'subir', 'archivos', row._id, session)
      return publicFile(row)
    })
  } catch (error) {
    // Si falla S3, la imagen no queda visible. purge:files reintenta la eliminación.
    const failed = await Archivo.findOneAndUpdate({ _id: staged._id, storageEstado: 'pendiente' }, {
      $set: { storageEstado: 'fallido', eliminadoEn: new Date(), ...(object?.versionId ? { storageVersionId: object.versionId } : {}) },
    }, { returnDocument: 'after' }).select(privateFields)
    if (failed) await deleteObject(failed).catch(() => {})
    throw error
  }
}

async function download(id, actor, requestId) {
  const row = await Archivo.findOne({ _id: id, storageEstado: 'disponible', eliminadoEn: null, venceEn: { $gt: new Date() } }).select(privateFields)
  if (!row) throw new ApiError(404, 'Foto no encontrada o ya no disponible', 'NOT_FOUND')
  const consent = await Consentimiento.findOne({ _id: row.consentimiento, revocadoEn: null })
  if (!consent) throw new ApiError(410, 'Autorización revocada; imagen no disponible')
  const { body } = await getStorage().open(row.storageKey, row.storageBucket, row.storageVersionId)
  try { await record(actor, 'consultar_imagen', 'archivos', id, undefined, requestId) }
  catch (error) { body.destroy(); throw error }
  return { row: publicFile(row), body }
}

async function remove(id, actor) {
  const row = await transaction.read(() => Archivo.findById(id).select(privateFields))
  if (!row) throw new ApiError(404, 'Archivo no encontrado')
  if (!row.eliminadoEn) await transaction(async session => {
    await Archivo.updateOne({ _id: id }, { $set: { eliminadoEn: new Date() } }, { session })
    await record(actor, 'eliminar', 'archivos', id, session)
  })
  if (!row.storageEliminadoEn) await deleteObject(row)
  return { eliminado: true }
}

async function getAll(query) {
  const validConsents = await Consentimiento.find({ visitante: query.visitante, revocadoEn: null }).distinct('_id')
  return list(Archivo, { visitante: query.visitante, ...(query.visita ? { visita: query.visita } : {}), storageEstado: 'disponible', eliminadoEn: null, venceEn: { $gt: new Date() }, consentimiento: { $in: validConsents } }, query)
}

async function purge() {
  const revoked = await Consentimiento.find({ revocadoEn: { $ne: null } }).distinct('_id')
  const cursor = Archivo.find({ storageEliminadoEn: null, $or: [
    { venceEn: { $lte: new Date() } }, { consentimiento: { $in: revoked } }, { eliminadoEn: { $ne: null } },
    { storageEstado: 'pendiente', createdAt: { $lt: new Date(Date.now() - 3600000) } },
  ] }).select(privateFields).cursor()
  let deleted = 0
  let failed = 0
  for await (const candidate of cursor) {
    // La selección puede ser anterior a otra operación; confirmar elegibilidad
    // y ocultar la foto antes de realizar el efecto externo sobre S3.
    const row = await transaction(async session => {
      const current = await Archivo.findOne({ _id: candidate._id, storageEliminadoEn: null }).select(privateFields).session(session)
      if (!current) return null
      const expired = +current.venceEn <= Date.now() || current.eliminadoEn || (current.storageEstado === 'pendiente' && +current.createdAt < Date.now() - 3600000)
      const revokedConsent = !expired && await Consentimiento.findOne({ _id: current.consentimiento, revocadoEn: { $ne: null } }).session(session)
      if (!expired && !revokedConsent) return null
      if (!current.eliminadoEn) await Archivo.updateOne({ _id: current._id }, { $set: { eliminadoEn: new Date() } }, { session })
      return current
    })
    if (!row) continue
    try { await deleteObject(row); deleted++ }
    catch { failed++ }
  }
  return { procesados: deleted, pendientes: failed }
}
module.exports = { upload, download, remove, getAll, purge }
