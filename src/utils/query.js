const ApiError = require('./ApiError')
function pagination(query) {
  return { page: Number(query.page || 1), limit: Number(query.limit || 25) }
}
async function list(Model, filter, query, select, populate, sort = { createdAt: -1, _id: -1 }) {
  const { page, limit } = pagination(query)
  const [data, total] = await Promise.all([
    Model.find(filter).select(select || '').populate(populate || []).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Model.countDocuments(filter),
  ])
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
}
async function required(Model, id, session, filter = {}) {
  const item = await Model.findOne({ _id: id, ...filter }).session(session || null)
  if (!item) throw new ApiError(404, 'Registro no encontrado', 'NOT_FOUND')
  return item
}
function ownScope(user) { return user.rol === 'anfitrion' ? { anfitrion: user._id } : {} }
function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
module.exports = { list, required, ownScope, escaped }
