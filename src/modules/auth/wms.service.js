const Usuario = require('../usuarios/usuario.model')
const ApiError = require('../../utils/ApiError')
function roleFromPermissions(payload) {
  let p = payload.permisos || {}
  if (typeof p === 'string') { try { p = JSON.parse(p) } catch { return null } }
  if (p.esAdmin === true || p.visitasAdministrar === true) return 'admin'
  if (p.visitasRecepcion === true) return 'recepcion'
  if (p.visitasAgendar === true) return 'anfitrion'
  return null
}
async function resolve(payload, subject, autoProvision) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(subject))) return null
  const wmsId = String(subject)
  let user = await Usuario.findOne({ wmsId })
  if (user && !user.activo) return null
  if (!autoProvision) return user
  if (payload.debe_cambiar_password) throw new ApiError(403, 'Debe cambiar su contraseña en WMS antes de acceder')
  const rol = roleFromPermissions(payload)
  if (!rol) throw new ApiError(403, 'Solicite un permiso de Control de visitas a su administrador', 'VISITAS_PERMISSION_REQUIRED')
  if (user && !user.wmsManaged) return user // Conservar asociaciones administradas explícitamente.
  const nombre = [payload.personal?.nombre, payload.personal?.apellido].filter(Boolean).join(' ').trim().slice(0, 150) || String(payload.username || `Usuario WMS ${wmsId}`).slice(0, 150)
  if (!user) {
    try { user = await Usuario.create({ wmsId, nombre, email: `wms-${wmsId.toLowerCase()}@identity.invalid`, rol, wmsManaged: true }) }
    catch (error) { if (error.code !== 11000) throw error; user = await Usuario.findOne({ wmsId }) }
  } else if (user.rol !== rol || user.nombre !== nombre) {
    user = await Usuario.findOneAndUpdate({ _id: user._id, activo: true }, { $set: { rol, nombre } }, { returnDocument: 'after', runValidators: true })
  }
  return user?.activo ? user : null
}
module.exports = { resolve, roleFromPermissions }
