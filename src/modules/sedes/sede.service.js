const Sede = require('./sede.model')
const transaction = require('../../utils/transaction')
const { record } = require('../auditoria/auditoria.service')
const { list, required } = require('../../utils/query')
// La instalación opera en una sola oficina. Prepararla automáticamente elimina
// la configuración del flujo de recepción y mantiene las referencias históricas.
const ensureDefault = () => transaction.read(async () => {
  const current = await Sede.findOne({ activa: true }).sort({ createdAt: 1, _id: 1 })
  if (current) return current
  return Sede.findOneAndUpdate({ codigo: 'PRINCIPAL' }, {
    $setOnInsert: { nombre: 'Oficina actual', zonaHoraria: 'America/Bogota', activa: true },
  }, { upsert: true, returnDocument: 'after', runValidators: true })
})
async function currentOffice(session) {
  const row = await Sede.findOne({ activa: true }).sort({ createdAt: 1, _id: 1 }).session(session || null)
  if (!row) throw new (require('../../utils/ApiError'))(503, 'No se pudo preparar la oficina actual; reinicie la API')
  return row._id
}
const getAll = (query, user) => list(Sede, user.rol === 'admin' ? {} : { activa: true }, query)
const create = (data, actor) => transaction(async session => {
  const [sede] = await Sede.create([data], { session }); await record(actor, 'crear', 'sedes', sede._id, session); return sede
})
const update = (id, data, actor) => transaction(async session => {
  const sede = await required(Sede, id, session); sede.set(data); await sede.save({ session })
  await record(actor, 'actualizar', 'sedes', id, session); return sede
})
module.exports = { getAll, create, update, ensureDefault, currentOffice }
