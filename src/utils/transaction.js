const mongoose = require('mongoose')
let standalone
// Cada reintento carga documentos nuevos dentro del callback. Usar la sesión del driver
// evita restaurar instancias Mongoose descartadas y conserva el error original al abortar.
// No ejecutar efectos externos (archivos, correo) dentro del callback.
async function transaction(operation) {
  if (standalone) return standalone.run(operation)
  const session = await mongoose.startSession()
  try { return await session.withTransaction(() => operation(session)) }
  finally { await session.endSession() }
}
transaction.configure = async (db, hello, models) => {
  if (hello.setName || hello.msg === 'isdbgrid') return
  standalone = require('./standalone.operations').createCoordinator(db)
  await standalone.initialize()
  standalone.install(models)
}
transaction.read = operation => standalone ? standalone.run(operation) : operation(null)
transaction.isStandalone = () => Boolean(standalone)
transaction.ready = () => !standalone || standalone.ready()
transaction.checkReady = () => standalone ? standalone.checkReady() : Promise.resolve(true)
module.exports = transaction
