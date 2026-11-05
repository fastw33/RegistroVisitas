const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const { MongoClient } = require('mongoose').mongo
require('dotenv').config({ quiet: true })
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.local', 'mongo')
const dbPath = path.join(directory, 'data')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function localTarget(uri) {
  try {
    const url = new URL(uri)
    return url.protocol === 'mongodb:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '27019' && !url.username && !url.password && url.searchParams.get('replicaSet') === 'rs0'
  } catch { return false } // Las URIs con varios hosts las maneja el driver, sin iniciar servicios.
}
async function portOpen() {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: 27019 })
    const finish = open => { socket.destroy(); resolve(open) }
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false))
    socket.setTimeout(1000, () => finish(false))
  })
}
function findBinary() {
  if (process.env.MONGOD_PATH && fs.existsSync(process.env.MONGOD_PATH)) return process.env.MONGOD_PATH
  const command = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['mongod'], { encoding: 'utf8', windowsHide: true })
  if (command.status === 0) return command.stdout.trim().split(/\r?\n/)[0]
  if (process.platform === 'win32') {
    const servers = path.join(process.env.ProgramFiles || 'C:/Program Files', 'MongoDB', 'Server')
    if (fs.existsSync(servers)) {
      for (const version of fs.readdirSync(servers).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
        const binary = path.join(servers, version, 'bin', 'mongod.exe')
        if (fs.existsSync(binary)) return binary
      }
    }
  }
  throw new Error('Instale MongoDB Server/configure MONGOD_PATH o inicie docker compose up -d mongo')
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/registro_visitas?directConnection=true'
  if (!localTarget(uri)) {
    if (process.argv.includes('--stop')) throw new Error('db:stop solo administra el MongoDB local propio del puerto 27019')
    console.log('Se usará el MongoDB configurado; no se inicia ninguna instancia local.')
    return
  }
  const client = new MongoClient('mongodb://127.0.0.1:27019/?directConnection=true', { serverSelectionTimeoutMS: 2000 })
  let started = false
  try {
    if (!await portOpen()) {
      if (process.argv.includes('--stop')) { console.log('MongoDB de visitas ya está detenido.'); return }
      const binary = findBinary()
      fs.mkdirSync(dbPath, { recursive: true })
      const child = spawn(binary, ['--dbpath', dbPath, '--port', '27019', '--bind_ip', '127.0.0.1', '--replSet', 'rs0', '--oplogSize', '128', '--logpath', path.join(directory, 'mongod.log'), '--logappend'], { detached: true, stdio: 'ignore', windowsHide: true })
      const spawnResult = await new Promise(resolve => { child.once('spawn', () => resolve(null)); child.once('error', resolve) })
      if (spawnResult) throw new Error('No se pudo ejecutar mongod; revise MONGOD_PATH')
      child.unref(); started = true
      for (let attempt = 0; attempt < 40 && !await portOpen(); attempt++) await delay(250)
    }
    await client.connect()
    const admin = client.db('admin')
    if (process.argv.includes('--stop')) {
      const command = await admin.command({ getCmdLineOpts: 1 })
      // Nunca detener el MongoDB de otro proyecto o una instancia de Docker.
      if (path.resolve(command.parsed?.storage?.dbPath || '') !== path.resolve(dbPath)) throw new Error('El puerto 27019 pertenece a otra instancia; no se detuvo')
      await admin.command({ shutdown: 1 }).catch(error => { if (!['MongoNetworkError', 'MongoServerSelectionError'].includes(error.name)) throw error })
      console.log('MongoDB de desarrollo de visitas detenido.')
      return
    }
    let hello = await admin.command({ hello: 1 })
    if (!hello.setName && started) {
      await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27019' }] } })
    } else if (hello.setName !== 'rs0') {
      throw new Error('El puerto 27019 pertenece a un MongoDB sin el replica set rs0; no se modificó')
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      hello = await admin.command({ hello: 1 })
      if (hello.isWritablePrimary && hello.setName === 'rs0') {
        console.log('MongoDB de visitas listo: 127.0.0.1:27019, replica set rs0.')
        return
      }
      await delay(250)
    }
    throw new Error('MongoDB aún no tiene un primario; revise .local/mongo/mongod.log')
  } finally { await client.close() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { localTarget }
