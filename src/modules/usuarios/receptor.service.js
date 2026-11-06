const Usuario = require('./usuario.model')
const directory = require('../../integrations/wms-personal')
const transaction = require('../../utils/transaction')
const { record } = require('../auditoria/auditoria.service')
const ApiError = require('../../utils/ApiError')

// Los asociados a WMS solo se incluyen después de verificar su estado remoto.
const localPeople = () => Usuario.find({ activo: true, soloDirectorio: { $ne: true }, $or: [{ wmsId: { $exists: false } }, { wmsId: null }, { wmsId: '' }] }).select('_id nombre wmsId').sort({ nombre: 1 }).lean()
async function list(token) {
  const local = await transaction.read(localPeople)
  if (!token) return { data: local.map(({ _id, nombre }) => ({ _id, nombre })) }
  let remote
  try { remote = await directory.getPersonal(token) }
  catch (error) {
    if (error.code !== 'WMS_DIRECTORY_UNAVAILABLE') throw error
    return { data: local.map(({ _id, nombre }) => ({ _id, nombre })), warning: error.message }
  }
  const existing = await transaction.read(async () => Usuario.find({ wmsId: { $in: remote.map(row => row.wmsId) } }).select('_id nombre wmsId activo').lean())
  const byWms = new Map(existing.map(row => [row.wmsId, row]))
  const merged = new Map(local.map(row => [String(row._id), { _id: row._id, nombre: row.nombre }]))
  for (const row of remote) {
    const account = byWms.get(row.wmsId)
    if (account && !account.activo) continue
    const _id = account?._id || row._id
    merged.set(String(_id), { _id, nombre: row.nombre })
  }
  return { data: [...merged.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) }
}
// Se crea solo el receptor seleccionado, nunca una cuenta con permiso de acceso.
async function resolve(id, token, actor) {
  if (!id) return id
  const current = await transaction.read(() => Usuario.findById(id))
  if (current && !current.soloDirectorio && !current.wmsId) return id
  if (!token) {
    if (current?.wmsId) throw new ApiError(503, 'Se requiere una sesión de WMS para validar que el receptor siga activo', 'WMS_DIRECTORY_UNAVAILABLE')
    throw new ApiError(404, 'Persona que recibe no encontrada', 'NOT_FOUND')
  }
  const people = await directory.getPersonal(token)
  const selected = people.find(row => row._id === String(id) || (current?.wmsId && row.wmsId === current.wmsId))
  if (!selected) throw new ApiError(404, 'La persona seleccionada ya no está en el personal disponible de WMS', 'NOT_FOUND')
  try { return await transaction(async session => {
    let user = await Usuario.findOne({ wmsId: selected.wmsId }).session(session)
    if (user) {
      if (!user.activo) throw new ApiError(404, 'La persona seleccionada está desactivada', 'NOT_FOUND')
      if (user.soloDirectorio && user.nombre !== selected.nombre) { user.nombre = selected.nombre; await user.save({ session }) }
      return String(user._id)
    }
    ;[user] = await Usuario.create([{ _id: selected._id, wmsId: selected.wmsId, nombre: selected.nombre, email: `wms-${selected.wmsId}@identity.invalid`, rol: 'anfitrion', wmsManaged: true, soloDirectorio: true }], { session })
    await record(actor, 'registrar_receptor_wms', 'usuarios', user._id, session)
    return String(user._id)
  }) } catch (error) {
    if (error.code !== 11000) throw error
    // Otra petición pudo asociar la misma persona mientras se consultaba WMS.
    const user = await transaction.read(() => Usuario.findOne({ wmsId: selected.wmsId, activo: true }))
    if (!user) throw error
    return String(user._id)
  }
}
module.exports = { list, resolve }
