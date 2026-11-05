const bcrypt = require('bcryptjs')
const Usuario = require('./usuario.model')
const transaction = require('../../utils/transaction')
const { record } = require('../auditoria/auditoria.service')
const { required, list } = require('../../utils/query')
const ApiError = require('../../utils/ApiError')
function publicUser(user) { const data = user.toObject ? user.toObject() : { ...user }; delete data.passwordHash; return data }
async function create(data, actor) {
  const { password, ...fields } = data
  if (password) fields.passwordHash = await bcrypt.hash(password, 12)
  return transaction(async session => {
    const [user] = await Usuario.create([fields], { session })
    await record(actor, 'crear', 'usuarios', user._id, session)
    return publicUser(user)
  })
}
async function update(id, data, actor) {
  if (String(actor._id) === id && (data.activo === false || (data.rol && data.rol !== 'admin'))) throw new ApiError(409, 'No puede desactivar o quitar el rol de su propio administrador')
  const { password, ...fields } = data
  if (password) fields.passwordHash = await bcrypt.hash(password, 12)
  return transaction(async session => {
    const user = await required(Usuario, id, session)
    user.set(fields); await user.save({ session })
    await record(actor, 'actualizar', 'usuarios', id, session)
    return publicUser(user)
  })
}
const getAll = query => list(Usuario, {}, query)
const anfitriones = () => Usuario.find({ activo: true, rol: { $in: ['admin', 'anfitrion'] } }).select('_id nombre').sort({ nombre: 1 }).limit(500).lean()
module.exports = { create, update, getAll, anfitriones, publicUser }
