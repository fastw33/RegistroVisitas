const { before, after, test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { Readable } = require('node:stream')

// Solo una instancia LOCAL YA ENCENDIDA. Nunca inicia MongoDB, API, HTTP ni S3.
// Cada ejecución usa una base nueva con nombre aleatorio y elimina solo esa base.
const target = process.env.VISITAS_TEST_STANDALONE_URI
const enabled = Boolean(target)
const database = `visitas_standalone_test_${randomUUID().replaceAll('-', '')}`
let mongoose, db, transaction, models, services, actor, host, originalConfiguration
const images = new Map()
const check = (name, fn) => test(name, { skip: !enabled, timeout: 30000 }, fn)
before(async () => {
  if (!enabled) return
  const parsed = new URL(target)
  assert.equal(parsed.protocol, 'mongodb:')
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'Solo MongoDB local')
  assert.equal(parsed.port || '27017', '27017')
  assert.ok(!parsed.username && !parsed.password, 'No usar credenciales de producción')
  parsed.pathname = `/${database}`; parsed.search = '?directConnection=true'
  Object.assign(process.env, {
    MONGODB_URI: parsed.href, NODE_ENV: 'test', JWT_SECRET: 'test-only-standalone-config-with-at-least-32-characters',
    AUTH_MODE: 'both', WMS_JWT_SECRET: 'test-only-wms-key', WMS_AUTO_PROVISION: 'true',
    S3_BUCKET: 'bucket-test', S3_PREFIX: 'registro-visitas', S3_ENDPOINT: '',
    PRIVACY_RESPONSIBLE: 'Empresa de prueba', PRIVACY_CONTACT: 'datos@example.test',
  })
  const storage = {
    validate() {}, async put(key, buffer) { images.set(key, buffer); return { versionId: 'test' } },
    async remove(key) { images.delete(key) }, async open(key) { return { body: Readable.from([images.get(key)]) } },
  }
  require('../src/integrations/s3').getStorage = () => storage
  const config = require('../src/config/db'); mongoose = config.mongoose
  await config.connectDB(); db = mongoose.connection.db
  assert.equal(db.databaseName, database)
  assert.equal((await db.admin().command({ hello: 1 })).setName, undefined)
  originalConfiguration = await db.admin().command({ getCmdLineOpts: 1 })
  transaction = require('../src/utils/transaction')
  assert.equal(transaction.isStandalone(), true)
  models = Object.fromEntries(['Usuario', 'Visitante', 'Consentimiento', 'Cita', 'Visita', 'Archivo', 'Auditoria', 'CorreccionVisitante'].map(name => [name, mongoose.models[name]]))
  services = {
    visitantes: require('../src/modules/visitantes/visitante.service'), citas: require('../src/modules/citas/cita.service'),
    visitas: require('../src/modules/visitas/visita.service'), consent: require('../src/modules/consentimientos/consentimiento.service'),
    correcciones: require('../src/modules/visitantes/visitante.correccion.service'), archivos: require('../src/modules/archivos/archivo.service'),
  }
  actor = await models.Usuario.create({ nombre: 'Administración prueba', email: 'admin@example.test', rol: 'admin' })
  host = await models.Usuario.create({ nombre: 'Anfitrión prueba', email: 'host@example.test', rol: 'anfitrion' })
})
after(async () => {
  if (!mongoose) return
  try {
    if (db) {
      const current = await db.admin().command({ getCmdLineOpts: 1 })
      assert.deepEqual(current.argv, originalConfiguration.argv)
      assert.deepEqual(current.parsed, originalConfiguration.parsed)
      assert.equal(db.databaseName, database)
      assert.match(database, /^visitas_standalone_test_[a-f0-9]{32}$/)
      await db.dropDatabase()
    }
  } finally { await mongoose.disconnect() }
})
let counter = 70000000
async function person() {
  const row = await services.visitantes.create({ tipoDocumento: 'CC', numeroDocumento: String(counter++), nombres: 'ANA', apellidos: 'PRUEBA' }, actor)
  await grant(row._id, 'registro_visitas')
  return row
}
async function grant(visitante, finalidad) {
  return services.consent.create({ visitante, finalidad, version: '1.0', aceptado: true, medio: 'casilla', evidencia: 'Autorización ficticia para pruebas aisladas' }, actor)
}
function appointment(visitor, extra = {}) {
  return services.citas.create({ visitante: String(visitor._id), anfitrion: String(host._id), motivo: 'Prueba', inicio: new Date(Date.now() + 3600000), fin: new Date(Date.now() + 7200000), ...extra }, actor)
}

check('standalone arranca, prepara oficina por upsert y valida sesiones WMS sin cambiar MongoDB', async () => {
  assert.equal(await mongoose.models.Sede.countDocuments({ codigo: 'PRINCIPAL' }), 1)
  const jwt = require('jsonwebtoken'), auth = require('../src/middlewares/auth.middleware')
  const token = jwt.sign({ id_usuario: 'TEST-WMS', username: 'Prueba', permisos: { visitasRecepcion: true } }, process.env.WMS_JWT_SECRET, { expiresIn: '1h' })
  const req = { headers: { authorization: `Bearer ${token}` } }; let calls = 0
  await auth(req, {}, () => calls++)
  assert.equal(calls, 1); assert.equal(req.usuario.rol, 'recepcion')
  assert.equal(await models.Usuario.countDocuments({ wmsId: 'TEST-WMS' }), 1)
  await assert.rejects(auth({ headers: {} }, {}, () => assert.fail('Sin acceso')), { status: 401 })
  await assert.rejects(auth({ headers: { authorization: 'Bearer invalido' } }, {}, () => assert.fail('Sin acceso')), { status: 401 })
  assert.equal(await db.collection('_visitas_control').countDocuments(), 0)
})

check('entradas concurrentes, reintento idempotente, cita consumida una vez y vehículo conservado al salir', async () => {
  const visitor = await person(), result = await appointment(visitor), cita = result.data[0]
  const data = { cita: String(cita._id), identidadVerificada: true, vehiculo: { placa: 'ABC123', descripcion: 'Moto' } }, key = randomUUID()
  const [one, two] = await Promise.all([services.visitas.enterAppointment(data, key, actor), services.visitas.enterAppointment(data, key, actor)])
  assert.equal(String(one._id), String(two._id)); assert.equal(await models.Visita.countDocuments({ cita: cita._id }), 1)
  await assert.rejects(services.visitas.enterAppointment({ ...data, vehiculo: { placa: 'XYZ987' } }, key, actor), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal((await models.Cita.findById(cita._id)).estado, 'ingresada')
  await assert.rejects(services.citas.resolvePass(result.pases[0].token), { code: 'PASS_NOT_FOUND' })
  const exited = await services.visitas.exit(String(one._id), actor)
  assert.equal(exited.estado, 'finalizada'); assert.equal(exited.vehiculo.placa, 'ABC123')
})

check('fallo de auditoría revierte una serie, sus pases y registros ya insertados', async () => {
  const visitor = await person(), before = await models.Auditoria.countDocuments()
  const original = models.Auditoria.collection.insertOne
  let count = 0
  models.Auditoria.collection.insertOne = async function (...args) {
    const result = await original(...args)
    if (++count === 3) throw new Error('audit-test-failure')
    return result
  }
  try { await assert.rejects(appointment(visitor, { repeticion: { cantidad: 3, cadaSemanas: 1 } }), /audit-test-failure/) }
  finally { models.Auditoria.collection.insertOne = original }
  assert.equal(await models.Cita.countDocuments({ visitante: visitor._id }), 0)
  assert.equal(await models.Auditoria.countDocuments(), before)
  assert.equal(await db.collection('_visitas_deshacer').countDocuments(), 0)
})

check('entrada con cita, salida y corrección fallidas conservan datos, pase e historial', async () => {
  const visitor = await person()
  const old = await services.visitas.enterDirect({ visitante: String(visitor._id), motivo: 'Visita histórica', identidadVerificada: true }, randomUUID(), actor)
  await services.visitas.exit(String(old._id), actor)
  const result = await appointment(visitor), cita = result.data[0], future = await appointment(visitor)
  const original = models.Auditoria.collection.insertOne
  models.Auditoria.collection.insertOne = async () => { throw new Error('audit-test-failure') }
  const key = randomUUID(), data = { cita: String(cita._id), identidadVerificada: true }
  try { await assert.rejects(services.visitas.enterAppointment(data, key, actor), /audit-test-failure/) }
  finally { models.Auditoria.collection.insertOne = original }
  assert.equal(await models.Visita.countDocuments({ cita: cita._id }), 0)
  assert.equal((await models.Cita.findById(cita._id)).estado, 'aprobada')
  assert.equal((await services.citas.resolvePass(result.pases[0].token)).valido, true)
  const visit = await services.visitas.enterAppointment(data, key, actor)
  const before = { tipoDocumento: visitor.tipoDocumento, numeroDocumento: visitor.numeroDocumento, nombres: visitor.nombres, apellidos: visitor.apellidos }
  const correction = { anterior: before, correccion: { ...before, nombres: 'NOMBRE CORREGIDO' }, motivo: 'Prueba', requestKey: randomUUID() }
  models.Auditoria.collection.insertOne = async () => { throw new Error('audit-test-failure') }
  try {
    await assert.rejects(services.correcciones.correct(String(visitor._id), correction, actor), /audit-test-failure/)
    await assert.rejects(services.visitas.exit(String(visit._id), actor), /audit-test-failure/)
  } finally { models.Auditoria.collection.insertOne = original }
  assert.equal((await models.Visitante.findById(visitor._id)).nombres, before.nombres)
  assert.equal((await models.Visita.findById(visit._id)).identidad.nombres, before.nombres)
  assert.equal((await models.Visita.findById(visit._id)).estado, 'dentro')
  assert.equal((await models.Cita.findById(cita._id)).estado, 'ingresada')
  assert.equal((await services.citas.resolvePass(future.pases[0].token)).valido, true)
  const changed = await services.correcciones.correct(String(visitor._id), correction, actor)
  assert.equal(changed.visitante.nombres, 'NOMBRE CORREGIDO')
  assert.equal((await services.correcciones.correct(String(visitor._id), correction, actor)).reutilizada, true)
  await assert.rejects(services.citas.resolvePass(future.pases[0].token), { code: 'PASS_NOT_FOUND' })
  assert.equal((await models.Visita.findById(old._id)).identidad.nombres, before.nombres)
  const exit = await services.visitas.exit(String(visit._id), actor)
  assert.equal(exit.estado, 'finalizada')
})

check('lecturas de API esperan y no observan un cambio que luego se revierte', async () => {
  const visitor = await person(); let entered, finish
  const written = new Promise(resolve => { entered = resolve }), proceed = new Promise(resolve => { finish = resolve })
  const writing = transaction(async () => { await models.Visitante.updateOne({ _id: visitor._id }, { $set: { nombres: 'NO CONFIRMADO' } }); entered(); await proceed; throw new Error('rollback-test') })
  await written
  let delivered = false
  const reading = transaction.read(async () => { const row = await models.Visitante.findById(visitor._id); delivered = true; return row.nombres })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(delivered, false); finish()
  await assert.rejects(writing, /rollback-test/)
  assert.equal(await reading, 'ANA')
})

check('fotos opcionales usan solo el adaptador S3 de prueba y revocación funciona sin replica set', async () => {
  const visitor = await person(), data = { visitante: String(visitor._id), motivo: 'Prueba', identidadVerificada: true, vehiculo: { placa: 'ABC123' } }, key = randomUUID()
  const [first, again] = await Promise.all([services.visitas.enterDirect(data, key, actor), services.visitas.enterDirect(data, key, actor)])
  assert.equal(String(first._id), String(again._id))
  const consent = await grant(visitor._id, 'foto_placa')
  const image = await require('sharp')({ create: { width: 40, height: 20, channels: 3, background: '#ccc' } }).jpeg().toBuffer()
  const uploaded = await services.archivos.upload({ visitante: String(visitor._id), visita: String(first._id), tipo: 'foto_placa' }, { buffer: image }, actor)
  assert.equal(uploaded.storageEstado, 'disponible'); assert.equal(uploaded.storageKey, undefined); assert.equal(images.size, 1)
  const { body } = await transaction.read(() => services.archivos.download(String(uploaded._id), actor, 'test'))
  body.destroy()
  await services.consent.revoke(String(consent._id), 'Prueba', actor)
  await assert.rejects(transaction.read(() => services.archivos.download(String(uploaded._id), actor, 'test')), { status: 410 })
  assert.equal((await services.archivos.purge()).procesados, 1); assert.equal(images.size, 0)
  const exited = await services.visitas.exit(String(first._id), actor)
  assert.equal(exited.vehiculo.placa, 'ABC123')
})

check('confirmación de operación con respuesta perdida se resuelve sin revertir un éxito confirmado', async () => {
  const Collection = require('mongoose').mongo.Collection, original = Collection.prototype.updateOne
  let injected = false
  Collection.prototype.updateOne = async function (filter, update, ...args) {
    const result = await original.call(this, filter, update, ...args)
    if (!injected && this.collectionName === '_visitas_operaciones' && update.$set?.phase === 'committed') {
      injected = true; throw new (require('mongoose').mongo.MongoNetworkError)('respuesta perdida de prueba')
    }
    return result
  }
  let visitor
  try { visitor = await person() }
  finally { Collection.prototype.updateOne = original }
  assert.ok(injected); assert.equal((await models.Visitante.findById(visitor._id)).nombres, 'ANA')
  assert.equal(await db.collection('_visitas_control').countDocuments(), 0)
})

check('una interrupción real deja un diario recuperable y no permite robar el candado', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/standalone-crash.js')], {
    env: { ...process.env, VISITAS_TEST_STANDALONE_URI: process.env.MONGODB_URI }, windowsHide: true, stdio: 'pipe',
  })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  assert.equal(code, 23)
  const { createCoordinator } = require('../src/utils/standalone.operations')
  const recovery = createCoordinator(db, { waitMs: 100 })
  assert.equal((await recovery.inspect()).phase, 'running')
  await assert.rejects(recovery.run(async () => {}), { code: 'OPERATION_BUSY' })
  await db.collection('_visitas_control').updateOne({ _id: 'exclusive' }, { $set: { heartbeat: new Date(Date.now() - 120000) } })
  assert.equal(await recovery.checkReady(), false)
  await assert.rejects(recovery.initialize(), { code: 'STANDALONE_RECOVERY_REQUIRED' })
  await assert.rejects(recovery.recover(), { code: 'STOP_API_REQUIRED' })
  assert.equal((await recovery.recover({ apiStopped: true })).recovered, true)
  assert.equal(await db.collection('test_crash').countDocuments(), 0)
  assert.equal(await db.collection('_visitas_deshacer').countDocuments(), 0)
  assert.equal(await db.collection('_visitas_control').countDocuments(), 0)
  assert.equal((await person()).nombres, 'ANA')
})

check('una escritura con resultado ambiguo bloquea nuevas operaciones hasta recuperar, sin borrar su diario', async () => {
  const visitor = await person(), original = models.Visitante.collection.updateOne
  models.Visitante.collection.updateOne = async (...args) => { await original(...args); throw new (require('mongoose').mongo.MongoNetworkError)('respuesta perdida de prueba') }
  try { await assert.rejects(transaction(() => models.Visitante.updateOne({ _id: visitor._id }, { $set: { nombres: 'INCIERTO' } })), { code: 'STANDALONE_RECOVERY_REQUIRED' }) }
  finally { models.Visitante.collection.updateOne = original }
  assert.equal(transaction.ready(), false)
  await assert.rejects(transaction.read(() => models.Visitante.findById(visitor._id)), { code: 'STANDALONE_RECOVERY_REQUIRED' })
  const recovery = require('../src/utils/standalone.operations').createCoordinator(db)
  assert.ok((await recovery.inspect()).changes > 0)
  await recovery.recover({ apiStopped: true })
  assert.equal((await models.Visitante.findById(visitor._id)).nombres, 'ANA')
  assert.equal(await db.collection('_visitas_control').countDocuments(), 0)
})
