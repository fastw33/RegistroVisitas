// Configuración y guardas con adaptadores aislados: no inicia ni reinicia MongoDB.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const uri = 'mongodb://127.0.0.1:27017/registro_visitas?directConnection=true'
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('la configuración predeterminada usa el MongoDB compartido y respeta otro destino explícito', () => {
  for (const selected of [undefined, 'mongodb://db.example.test:27017/visitas_qa']) {
    const module = { exports: {} }
    vm.runInNewContext(source('src/config/env.js'), { module, process: { env: { JWT_SECRET: 'test-only-config-with-at-least-32-characters', ...(selected ? { MONGODB_URI: selected } : {}) } }, require: () => ({ config() {} }), URL })
    assert.equal(module.exports.mongoUri, selected || uri)
  }
})

test('predev no inicia procesos ni abre conexiones administrativas para el MongoDB compartido', async () => {
  for (const selected of [undefined, uri]) {
    const module = { exports: {} }, messages = []
    const context = { module, __dirname: path.join(__dirname, '../scripts'), URL, setTimeout,
      process: { env: selected ? { MONGODB_URI: selected } : {}, argv: ['node', 'mongo-dev.js'] },
      console: { log: message => messages.push(message) },
      require(name) {
        if (name === 'node:path') return path
        if (name === 'node:fs' || name === 'node:net') return {}
        if (name === 'dotenv') return { config() {} }
        if (name === 'node:child_process') return { spawn() { assert.fail('No debe iniciar mongod') }, spawnSync() { assert.fail('No debe buscar un binario') } }
        if (name === 'mongoose') return { mongo: { MongoClient: class { constructor() { assert.fail('No debe administrar el MongoDB compartido') } } } }
        throw new Error(`Módulo inesperado: ${name}`)
      },
    }
    vm.runInNewContext(source('scripts/mongo-dev.js'), context)
    await context.main()
    assert.match(messages[0], /no se inicia ninguna instancia/)
    assert.equal(module.exports.localTarget(uri), false)
    context.process.argv.push('--stop')
    await assert.rejects(context.main(), /solo administra el MongoDB local propio/)
  }
})

test('standalone se configura en la aplicación sin reconfigurar ni desconectar el servicio compartido', async () => {
  const events = [], module = { exports: {} }
  const mongoose = {
    models: {},
    set() {},
    async connect(value) { assert.equal(value, uri); events.push('connect') },
    async disconnect() { events.push('disconnect') },
    connection: { db: { admin: () => ({ command: async () => ({ isWritablePrimary: true }) }) } },
  }
  vm.runInNewContext(source('src/config/db.js'), { module, require(name) {
    if (name === 'mongoose') return mongoose
    if (name === './env') return { mongoUri: uri }
    if (name === '../model') return {}
    if (name === '../utils/transaction') return { async configure(db, hello, models) { assert.equal(hello.isWritablePrimary, true); assert.equal(models, mongoose.models); events.push('configure') } }
    if (name === '../modules/sedes/sede.service') return { async ensureDefault() { events.push('office') } }
    assert.fail('Módulo inesperado')
  } })
  await module.exports.connectDB()
  assert.deepEqual(events, ['connect', 'configure', 'office'])
})

test('replica set conserva las transacciones del driver y cierra la sesión cuando falla el callback', async () => {
  const module = { exports: {} }, events = []
  const session = { async withTransaction(callback) { events.push('transaction'); return callback() }, async endSession() { events.push('end') } }
  vm.runInNewContext(source('src/utils/transaction.js'), { module, require(name) {
    assert.equal(name, 'mongoose')
    return { async startSession() { events.push('session'); return session } }
  } })
  const tx = module.exports
  await tx.configure({}, { setName: 'existing' }, {})
  assert.equal(tx.isStandalone(), false)
  await assert.rejects(tx(async current => { assert.equal(current, session); throw new Error('audit-test') }), /audit-test/)
  assert.deepEqual(events, ['session', 'transaction', 'end'])
})
