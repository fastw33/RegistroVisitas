const Auditoria = require('./auditoria.model')
const { list } = require('../../utils/query')
async function record(user, accion, entidad, entidadId, session, requestId) {
  await Auditoria.create([{ actor: user._id, accion, entidad, entidadId: String(entidadId), requestId }], { session })
}
const getAll = query => list(Auditoria, {
  ...(query.entidad ? { entidad: query.entidad } : {}),
  ...(query.entidadId ? { entidadId: query.entidadId } : {}),
}, query)
module.exports = { record, getAll }
