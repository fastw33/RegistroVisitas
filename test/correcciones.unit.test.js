// Service contract tests with in-memory adapters: no server, MongoDB or S3 started.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const actor = { _id: 'admin', rol: 'admin' }
const initial = { tipoDocumento: 'CC', numeroDocumento: '00123', nombres: 'Ana', apellidos: 'Prueba' }
let person, logs, visits, passes, audits, failAudit
const model = value => ({ ...value, set(data) { Object.assign(this, data) }, async save() {}, toObject() { return Object.fromEntries(Object.entries(this).filter(([, v]) => typeof v !== 'function')) } })
const reset = () => { person = model({ _id: 'v', ...initial }); logs = []; visits = ['pendiente', 'autorizada', 'dentro', 'finalizada', 'rechazada'].map(estado => ({ estado, identidad: { ...initial }, eventos: [] })); passes = [{ paseHash: 'old' }]; audits = []; failAudit = false }
const adapters = {
  '../src/modules/visitantes/visitante.model': { findOne: () => ({ session: async () => null }) },
  '../src/modules/visitantes/visitante.correccion.model': {
    findOne: ({ requestKey }) => ({ select: async () => logs.find(row => row.requestKey === requestKey) || null }),
    create: async ([data]) => { const row = model({ _id: String(logs.length + 1), ...data }); logs.push(row); return [row] },
  },
  '../src/modules/visitas/visita.model': { updateMany: async (filter, update) => { for (const row of visits.filter(row => filter.estado.$in.includes(row.estado))) { for (const [key, value] of Object.entries(update.$set)) row.identidad[key.split('.')[1]] = value; row.eventos.push(update.$push.eventos) } } },
  '../src/modules/citas/cita.model': { updateMany: async () => { passes.forEach(row => { delete row.paseHash }) } },
  '../src/utils/transaction': async callback => {
    const previous = { person: person.toObject(), logs: [...logs], visits: structuredClone(visits), passes: structuredClone(passes) }
    try { return await callback({}) } catch (error) { person = model(previous.person); logs = previous.logs; visits = previous.visits; passes = previous.passes; throw error }
  },
  '../src/utils/query': { required: async () => person, list: async () => ({ data: logs }) },
  '../src/modules/auditoria/auditoria.service': { record: async (...args) => { if (failAudit) throw new Error('audit failure'); audits.push(args) } },
}
adapters['../src/utils/transaction'].read = operation => operation(null)
for (const [file, exports] of Object.entries(adapters)) require.cache[require.resolve(file)] = { id: require.resolve(file), filename: require.resolve(file), loaded: true, exports }
const service = require('../src/modules/visitantes/visitante.correccion.service')
const payload = () => ({ anterior: { ...initial }, correccion: { ...initial, numeroDocumento: '00456', nombres: 'Ana María' }, motivo: 'Verificado con documento físico', requestKey: randomUUID() })
test('administración corrige visitas abiertas, conserva cerradas, revoca pases y guarda antes/después', async () => {
  reset(); const result = await service.correct('v', payload(), actor)
  assert.equal(result.visitante.numeroDocumento, '00456'); assert.equal(logs.length, 1); assert.deepEqual(logs[0].anterior, initial)
  for (const row of visits) assert.equal(row.identidad.numeroDocumento, ['pendiente', 'autorizada', 'dentro'].includes(row.estado) ? '00456' : '00123')
  assert.equal(passes[0].paseHash, undefined); assert.equal(audits.length, 1); assert.equal(result.correccion.requestHash, undefined); assert.equal(result.correccion.requestKey, undefined)
})
test('reintentar el mismo intento no duplica; cambiar datos o autor con la misma clave falla', async () => {
  reset(); const data = payload(); await service.correct('v', data, actor)
  assert.equal((await service.correct('v', data, actor)).reutilizada, true); assert.equal(logs.length, 1)
  await assert.rejects(service.correct('v', { ...data, motivo: 'Otro' }, actor), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(service.correct('v', data, { ...actor, _id: 'otro' }), { status: 409 })
})
test('rechaza recepción, ficha desactualizada, duplicados y cambios vacíos antes de escribir', async () => {
  reset(); await assert.rejects(service.correct('v', payload(), { ...actor, rol: 'recepcion' }), { status: 403 })
  await assert.rejects(service.history('v', {}, { ...actor, rol: 'recepcion' }), { status: 403 })
  await assert.rejects(service.correct('v', { ...payload(), anterior: { ...initial, nombres: 'Viejo' } }, actor), { code: 'VISITOR_CHANGED' })
  await assert.rejects(service.correct('v', { ...payload(), correccion: initial }, actor), { code: 'NO_CHANGES' })
  const Visitor = adapters['../src/modules/visitantes/visitante.model']; Visitor.findOne = () => ({ session: async () => ({ _id: 'duplicate' }) })
  await assert.rejects(service.correct('v', payload(), actor), { code: 'DOCUMENT_IN_USE' }); assert.equal(logs.length, 0); assert.equal(person.numeroDocumento, '00123')
  Visitor.findOne = () => ({ session: async () => null })
})
test('un fallo de auditoría revierte la operación completa en la transacción', async () => {
  reset(); failAudit = true
  await assert.rejects(service.correct('v', payload(), actor), /audit failure/)
  assert.equal(person.numeroDocumento, '00123'); assert.equal(logs.length, 0); assert.equal(passes[0].paseHash, 'old'); assert.ok(visits.every(row => row.identidad.numeroDocumento === '00123'))
})
