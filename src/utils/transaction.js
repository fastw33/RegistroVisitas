const mongoose = require('mongoose')
// Cada reintento carga documentos nuevos dentro del callback. Usar la sesión del driver
// evita restaurar instancias Mongoose descartadas y conserva el error original al abortar.
// No ejecutar efectos externos (archivos, correo) dentro del callback.
module.exports = async operation => {
  const session = await mongoose.startSession()
  try { return await session.withTransaction(() => operation(session)) }
  finally { await session.endSession() }
}
