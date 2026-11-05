// Regresión contra un replica set LOCAL YA ENCENDIDO, sin iniciar procesos/servidores.
const { before, after, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const target = process.env.VISITAS_TEST_REPLICA_URI
let mongoose, db, models, actor, host, visitors, appointments, visits
const name = `visitas_native_test_${randomUUID().replaceAll('-', '')}`
before(async () => {
  if (!target) return
  const parsed = new URL(target)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname)); assert.equal(parsed.port, '27019')
  assert.ok(!parsed.username && !parsed.password)
  parsed.pathname = `/${name}`; parsed.search = '?directConnection=true'
  Object.assign(process.env, { MONGODB_URI: parsed.href, JWT_SECRET: 'test-only-native-transaction-secret-over-32-characters', AUTH_MODE: 'local', PRIVACY_RESPONSIBLE: 'Empresa prueba', PRIVACY_CONTACT: 'datos@example.test' })
  const config = require('../src/config/db'); mongoose = config.mongoose
  await config.connectDB(); db = mongoose.connection.db
  assert.ok((await db.admin().command({ hello: 1 })).setName)
  models = mongoose.models
  actor = await models.Usuario.create({ nombre: 'Admin prueba', email: 'admin@example.test', rol: 'admin' })
  host = await models.Usuario.create({ nombre: 'Host prueba', email: 'host@example.test', rol: 'anfitrion' })
  visitors = require('../src/modules/visitantes/visitante.service')
  appointments = require('../src/modules/citas/cita.service')
  visits = require('../src/modules/visitas/visita.service')
})
after(async () => {
  if (!mongoose) return
  try { if (db) { assert.equal(db.databaseName, name); assert.match(name, /^visitas_native_test_[a-f0-9]{32}$/); await db.dropDatabase() } }
  finally { await mongoose.disconnect() }
})
test('replica set mantiene el flujo de cita y rollback nativo sin diario standalone', { skip: !target }, async () => {
  assert.equal(require('../src/utils/transaction').isStandalone(), false)
  const person = await visitors.create({ tipoDocumento: 'CC', numeroDocumento: '9990001234', nombres: 'ANA', apellidos: 'PRUEBA' }, actor)
  await require('../src/modules/consentimientos/consentimiento.service').create({ visitante: person._id, finalidad: 'registro_visitas', version: '1.0', aceptado: true, medio: 'casilla', evidencia: 'Prueba aislada' }, actor)
  const result = await appointments.create({ visitante: String(person._id), anfitrion: String(host._id), motivo: 'Prueba', inicio: new Date(Date.now() + 3600000), fin: new Date(Date.now() + 7200000) }, actor)
  const cita = result.data[0], original = models.Auditoria.collection.insertOne
  models.Auditoria.collection.insertOne = async () => { throw new Error('native-audit-failure') }
  const key = randomUUID(), data = { cita: String(cita._id), identidadVerificada: true }
  try { await assert.rejects(visits.enterAppointment(data, key, actor), /native-audit-failure/) }
  finally { models.Auditoria.collection.insertOne = original }
  assert.equal(await models.Visita.countDocuments({ cita: cita._id }), 0)
  assert.equal((await models.Cita.findById(cita._id)).estado, 'aprobada')
  const entered = await visits.enterAppointment(data, key, actor)
  assert.equal(entered.estado, 'dentro'); assert.equal((await visits.exit(String(entered._id), actor)).estado, 'finalizada')
  assert.equal(await db.collection('_visitas_operaciones').countDocuments(), 0)
})
