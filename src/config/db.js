const mongoose = require('mongoose')
const env = require('./env')
mongoose.set('strictQuery', true)
mongoose.set('bufferCommands', false)
async function connectDB() {
  try { await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, autoIndex: false }) }
  catch (error) {
    if (error.name === 'MongoServerSelectionError') throw new Error('MongoDB no está disponible. Revise MONGODB_URI, la red y las credenciales; la API no inicia ni reconfigura el servicio compartido.')
    throw error
  }
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  require('../model')
  await require('../utils/transaction').configure(mongoose.connection.db, hello, mongoose.models)
  // createIndexes agrega índices; nunca elimina índices existentes.
  await Promise.all(Object.values(mongoose.models).map(model => model.createIndexes()))
  await require('../modules/sedes/sede.service').ensureDefault()
}
module.exports = { mongoose, connectDB, disconnectDB: () => mongoose.disconnect() }
