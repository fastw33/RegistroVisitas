const { MongoClient } = require('mongoose').mongo
const env = require('../src/config/env')
const { createCoordinator } = require('../src/utils/standalone.operations')

async function main() {
  const apply = process.argv.includes('--apply')
  if (apply && !process.argv.includes('--api-stopped')) throw new Error('Primero detenga todas las instancias de RegistroVisitas. Después use --apply --api-stopped; MongoDB y S3 permanecen encendidos.')
  const client = new MongoClient(env.mongoUri, { serverSelectionTimeoutMS: 10000 })
  try {
    await client.connect()
    const coordinator = createCoordinator(client.db())
    if (!apply) {
      const state = await coordinator.inspect()
      console.log(JSON.stringify(state ? { pendiente: true, fase: state.phase, cambios: state.changes, desde: state.startedAt } : { pendiente: false }))
      return
    }
    console.log(JSON.stringify(await coordinator.recover({ apiStopped: true, retryInterruptedRecovery: process.argv.includes('--retry-interrupted') })))
  } finally { await client.close() }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1 })
