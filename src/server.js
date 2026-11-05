const env = require('./config/env')
const { connectDB, disconnectDB } = require('./config/db')
const app = require('./app')

async function start() {
  await connectDB()
  const server = app.listen(env.port, env.host, () => console.log(`RegistroVisitas API escuchando en puerto ${env.port}`))
  let closing = false
  async function shutdown(signal) {
    if (closing) return
    closing = true
    console.log(`Cerrando API: ${signal}`)
    const timer = setTimeout(() => { console.error('Cierre forzado por tiempo agotado'); process.exit(1) }, 10000).unref()
    server.close(async () => { await disconnectDB(); clearTimeout(timer); process.exit(0) })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  server.on('error', async error => { console.error(`No se pudo abrir el puerto: ${error.code}`); await disconnectDB(); process.exit(1) })
  return server
}
if (require.main === module) start().catch(async error => { console.error(`No se pudo iniciar la API: ${error.message}`); await disconnectDB(); process.exit(1) })
module.exports = { start }
