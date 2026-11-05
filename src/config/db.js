const mongoose = require('mongoose')
const env = require('./env')
mongoose.set('strictQuery', true)
mongoose.set('bufferCommands', false)
async function connectDB() {
  try { await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, autoIndex: false }) }
  catch (error) {
    if (error.name === 'MongoServerSelectionError') throw new Error('MongoDB no está disponible. Para la instancia local ejecute npm run db:dev; para otro servidor revise MONGODB_URI y su replica set.')
    throw error
  }
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    await mongoose.disconnect()
    throw new Error('MongoDB debe ejecutarse como replica set para garantizar transacciones. Use compose.yaml.')
  }
  require('../model')
  // createIndexes agrega índices; nunca elimina índices existentes.
  await Promise.all(Object.values(mongoose.models).map(model => model.createIndexes()))
  await require('../modules/sedes/sede.service').ensureDefault()
}
module.exports = { mongoose, connectDB, disconnectDB: () => mongoose.disconnect() }
