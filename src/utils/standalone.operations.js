const { AsyncLocalStorage } = require('node:async_hooks')
const { randomUUID } = require('node:crypto')
const { ObjectId, EJSON } = require('mongoose').mongo.BSON
const ApiError = require('./ApiError')

// Compensaciones de aplicación para MongoDB standalone, NO transacciones ACID.
// El candado no expira: otro proceso nunca roba una operación que quizá siga viva.
// Tras una interrupción sin resolver se exige recuperación con las APIs detenidas.
const names = { control: '_visitas_control', operations: '_visitas_operaciones', undo: '_visitas_deshacer' }
const patched = Symbol('registro-visitas-standalone')
const durable = { writeConcern: { w: 1, j: true } }
function copy(value) {
  if (!value || typeof value !== 'object') return value
  if (value._bsontype || value instanceof Date || value instanceof RegExp) return value
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (typeof value.toObject === 'function') return copy(value.toObject({ depopulate: true, flattenMaps: true }))
  if (Array.isArray(value)) return Array.from(value, copy)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
}
const uncertain = error => /^Mongo(?:Network|ServerSelection|NotConnected|TopologyClosed|OperationTimeout|PoolClosed|WriteConcern)/.test(error?.name || '')

function createCoordinator(db, { waitMs = 5000, pollMs = 35 } = {}) {
  const local = new AsyncLocalStorage()
  const control = db.collection(names.control), operations = db.collection(names.operations), undo = db.collection(names.undo)
  let healthy = true
  const recoveryError = () => new ApiError(503, 'Hay una operación pendiente de recuperación. Contacte al administrador antes de volver a registrar movimientos.', 'STANDALONE_RECOVERY_REQUIRED')

  async function cleanup(owner) {
    // Si la limpieza falla se conservan el estado final y las imágenes para reintentar.
    await undo.deleteMany({ operation: owner }, durable)
    await operations.deleteOne({ _id: owner, phase: { $in: ['committed', 'rolled_back'] } }, durable)
  }
  async function release(owner) { await control.deleteOne({ _id: 'exclusive', owner }, durable) }
  async function inspect() {
    const lock = await control.findOne({ _id: 'exclusive' })
    if (!lock) return null
    const operation = await operations.findOne({ _id: lock.owner })
    return { owner: lock.owner, startedAt: lock.startedAt, heartbeat: lock.heartbeat, phase: operation?.phase || 'preparing', changes: await undo.countDocuments({ operation: lock.owner }) }
  }
  async function clearFinished(lock) {
    const operation = await operations.findOne({ _id: lock.owner })
    if (!['committed', 'rolled_back'].includes(operation?.phase)) return false
    // El contexto queda cerrado ANTES de publicar una fase final.
    await release(lock.owner)
    await cleanup(lock.owner).catch(() => {})
    return true
  }
  async function initialize() {
    await undo.createIndex({ operation: 1, collection: 1, documentId: 1 }, { unique: true })
    const lock = await control.findOne({ _id: 'exclusive' })
    if (lock && !await clearFinished(lock) && Date.now() - +lock.heartbeat > 60000) {
      healthy = false
      throw recoveryError()
    }
    // Solo registros ya terminados; nunca se purga una recuperación pendiente.
    for await (const entry of operations.find({ phase: { $in: ['committed', 'rolled_back'] } })) await cleanup(entry._id)
  }
  async function acquire() {
    const owner = randomUUID(), started = Date.now()
    for (;;) {
      try {
        const now = new Date()
        await control.insertOne({ _id: 'exclusive', owner, startedAt: now, heartbeat: now }, durable)
        return owner
      } catch (error) {
        if (error.code !== 11000) { if (uncertain(error)) healthy = false; throw error }
      }
      const lock = await control.findOne({ _id: 'exclusive' })
      if (lock && await clearFinished(lock)) continue
      if (lock && Date.now() - +lock.heartbeat > 60000) { healthy = false; throw recoveryError() }
      if (Date.now() - started >= waitMs) throw new ApiError(503, 'Otra operación está terminando. Reintente en unos segundos.', 'OPERATION_BUSY')
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }
  async function restore(owner) {
    // Una imagen por documento, anterior a su primera escritura en la operación.
    for await (const change of undo.find({ operation: owner }).sort({ order: -1 })) {
      if (change.before === null) await db.collection(change.collection).deleteOne({ _id: change.documentId }, durable)
      else await db.collection(change.collection).replaceOne({ _id: change.documentId }, change.before, { upsert: true, ...durable })
    }
    await operations.updateOne({ _id: owner }, { $set: { phase: 'rolled_back', finishedAt: new Date() } }, durable)
  }
  async function run(operation) {
    const existing = local.getStore()
    if (existing) {
      if (!existing.active) throw recoveryError()
      return operation(null)
    }
    if (!healthy) throw recoveryError()
    const owner = await acquire()
    const context = { owner, active: true, order: 0, captured: new Set(), queue: Promise.resolve() }
    let heartbeat
    try {
      await operations.insertOne({ _id: owner, phase: 'running', startedAt: new Date() }, durable)
      heartbeat = setInterval(() => {
        control.updateOne({ _id: 'exclusive', owner }, { $set: { heartbeat: new Date() } }).catch(() => {})
      }, 10000).unref()
      let result
      try {
        // Los Query de Mongoose son thenables: ejecutarlos dentro del contexto.
        result = await local.run(context, async () => await operation(null))
        await context.queue
      } catch (error) {
        await context.queue
        context.active = false
        if (context.uncertain || uncertain(error)) { healthy = false; throw recoveryError() }
        try { await restore(owner) }
        catch { healthy = false; throw recoveryError() }
        await release(owner)
        context.released = true
        await cleanup(owner).catch(() => {})
        throw error
      }
      if (context.uncertain) { context.active = false; healthy = false; throw recoveryError() }
      context.active = false
      try { await operations.updateOne({ _id: owner }, { $set: { phase: 'committed', finishedAt: new Date() } }, durable) }
      catch {
        // Resolver una confirmación ambigua antes de decidir si deshacer.
        let stored
        try { stored = await operations.findOne({ _id: owner }) }
        catch { healthy = false; throw recoveryError() }
        if (stored?.phase !== 'committed') {
          try { await restore(owner) }
          catch { healthy = false; throw recoveryError() }
          await release(owner)
          context.released = true
          await cleanup(owner).catch(() => {})
          throw new ApiError(503, 'No se pudo confirmar la operación; los cambios se revirtieron.', 'OPERATION_REVERTED')
        }
      }
      await release(owner)
      context.released = true
      await cleanup(owner).catch(() => {})
      return result
    } catch (error) {
      if (!context.released) healthy = false
      throw error
    } finally {
      context.active = false
      clearInterval(heartbeat)
      // No se libera aquí: un fallo desconocido conserva el candado y las imágenes.
    }
  }
  async function capture(context, collection, documentId, before) {
    const key = `${collection}:${EJSON.stringify(documentId, { relaxed: false })}`
    if (context.captured.has(key)) return
    await undo.insertOne({ operation: context.owner, order: context.order++, collection, documentId, before }, durable)
    context.captured.add(key)
  }
  async function prepare(context, collection, method, args) {
    const raw = db.collection(collection)
    if (method === 'insertOne' || method === 'insertMany') {
      const documents = method === 'insertOne' ? [args[0]] : args[0]
      for (const document of documents) {
        document._id ||= new ObjectId()
        await capture(context, collection, document._id, await raw.findOne({ _id: document._id }))
      }
      return
    }
    const [filter, update] = args
    const options = args[method.startsWith('delete') || method === 'findOneAndDelete' ? 1 : 2] || {}
    let cursor = raw.find(filter || {}, { ...(options.sort ? { sort: options.sort } : {}), ...(options.collation ? { collation: options.collation } : {}) })
    if (!['updateMany', 'deleteMany'].includes(method)) cursor = cursor.limit(1)
    let found = false
    for await (const document of cursor) { found = true; await capture(context, collection, document._id, document) }
    if (!found && options.upsert) {
      if (Array.isArray(update)) throw new ApiError(500, 'Pipeline upsert no soportado en modo standalone', 'UNSUPPORTED_STANDALONE_WRITE')
      const directId = filter?._id && !filter._id.$in && !filter._id.$eq ? filter._id : null
      const id = directId || update?._id || update?.$setOnInsert?._id || new ObjectId()
      if (method === 'replaceOne' || method === 'findOneAndReplace') args[1] = { ...update, _id: id }
      else args[1] = { ...update, $setOnInsert: { ...update.$setOnInsert, _id: id } }
      await capture(context, collection, id, null)
    }
  }
  function install(models) {
    for (const model of Object.values(models)) {
      const collection = model.collection
      if (collection[patched]) continue
      collection[patched] = true
      for (const method of ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
        const original = collection[method].bind(collection)
        collection[method] = (...input) => {
          const invoke = () => {
            const context = local.getStore()
            if (!context?.active || context.uncertain) throw recoveryError()
            const args = copy(input)
            const optionsIndex = ['insertOne', 'insertMany', 'deleteOne', 'deleteMany', 'findOneAndDelete'].includes(method) ? 1 : 2
            args[optionsIndex] = { ...args[optionsIndex], ...durable }
            const job = context.queue.then(async () => {
              if (!context.active || context.uncertain) throw recoveryError()
              await prepare(context, collection.name, method, args)
              return original(...args)
            })
            context.queue = job.catch(error => { if (uncertain(error)) context.uncertain = true })
            return job
          }
          return local.getStore() ? invoke() : run(invoke)
        }
      }
      // Fallar explícitamente antes de una vía de escritura no registrada.
      collection.bulkWrite = () => { throw new ApiError(500, 'bulkWrite no soportado en modo standalone', 'UNSUPPORTED_STANDALONE_WRITE') }
    }
  }
  async function recover({ apiStopped = false, retryInterruptedRecovery = false } = {}) {
    if (!apiStopped) throw new ApiError(409, 'La recuperación requiere detener todas las instancias de RegistroVisitas primero', 'STOP_API_REQUIRED')
    const lock = await control.findOne({ _id: 'exclusive' })
    if (!lock) return { recovered: false }
    if (lock.recovering && !retryInterruptedRecovery) throw new ApiError(409, 'Ya hay una recuperación iniciada. Detenga también ese proceso antes de reintentar con --retry-interrupted.', 'RECOVERY_IN_PROGRESS')
    const recoveryOwner = randomUUID()
    const claimed = await control.updateOne({ _id: 'exclusive', owner: lock.owner, ...(lock.recovering ? { recoveryOwner: lock.recoveryOwner } : { recovering: { $ne: true } }) }, { $set: { recovering: true, recoveryOwner } }, durable)
    if (!claimed.matchedCount) throw recoveryError()
    const operation = await operations.findOne({ _id: lock.owner })
    if (!['committed', 'rolled_back'].includes(operation?.phase)) await restore(lock.owner)
    await release(lock.owner)
    await cleanup(lock.owner)
    healthy = true
    return { recovered: true }
  }
  async function checkReady() {
    if (!healthy) return false
    try {
      const lock = await control.findOne({ _id: 'exclusive' })
      if (lock && Date.now() - +lock.heartbeat > 60000) {
        const operation = await operations.findOne({ _id: lock.owner })
        if (!['committed', 'rolled_back'].includes(operation?.phase)) healthy = false
      }
      return healthy
    } catch { return false }
  }
  return { run, install, initialize, inspect, recover, checkReady, ready: () => healthy }
}

module.exports = { createCoordinator, names }
