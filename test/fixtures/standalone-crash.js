// Proceso auxiliar propio de la prueba. Nunca abre un servidor ni usa una base real.
const mongoose = require('mongoose')
async function main() {
  const uri = process.env.VISITAS_TEST_STANDALONE_URI, parsed = new URL(uri)
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/visitas_standalone_test_[a-f0-9]{32}$/.test(parsed.pathname)) throw new Error('Destino de prueba inválido')
  await mongoose.connect(uri)
  const Model = mongoose.model('Crash', new mongoose.Schema({ value: String }), 'test_crash')
  const coordinator = require('../../src/utils/standalone.operations').createCoordinator(mongoose.connection.db)
  await coordinator.initialize(); coordinator.install({ Model })
  await coordinator.run(async () => { await Model.create({ value: 'incompleto' }); process.exit(23) })
}
if (require.main === module && process.env.VISITAS_TEST_STANDALONE_URI) main().catch(() => process.exit(24))
