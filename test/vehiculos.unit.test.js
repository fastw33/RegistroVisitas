// Validadores/modelos reales y servicios con adaptadores en memoria; sin servidores.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const { validationResult, matchedData } = require('express-validator')
const VisitaModel = require('../src/modules/visitas/visita.model')
const visitValidators = require('../src/modules/visitas/visita.validator')
const fileValidators = require('../src/modules/archivos/archivo.validator')
const ConsentModel = require('../src/modules/consentimientos/consentimiento.model')
const ArchivoModel = require('../src/modules/archivos/archivo.model')
const ids = { visitor: '111111111111111111111111', office: '222222222222222222222222', actor: '333333333333333333333333', cita: '444444444444444444444444', consent: '555555555555555555555555' }
const actor = { _id: ids.actor, rol: 'recepcion' }
const visitor = { _id: ids.visitor, nombres: 'ANA', apellidos: 'PRUEBA', tipoDocumento: 'CC', numeroDocumento: '9990001234' }
const payload = () => ({ visitante: ids.visitor, sede: ids.office, motivo: 'Prueba', identidadVerificada: true })
async function validate(chains, body) {
  const req = { body, query: {}, params: { id: ids.cita }, headers: { 'idempotency-key': randomUUID() } }
  for (const chain of chains.slice(0, -1)) await chain.run(req)
  return { errors: validationResult(req).array(), data: matchedData(req, { locations: ['body'], includeOptionals: false }) }
}

test('vehículo opcional: normaliza placa, rechaza estructuras y campos ajenos, permite datos incompletos', async () => {
  const legacy = await validate(visitValidators.directEntry, payload())
  assert.deepEqual(legacy.errors, []); assert.equal(legacy.data.vehiculo, undefined)
  const normalized = await validate(visitValidators.directEntry, { ...payload(), vehiculo: { placa: ' ab-c123 ', descripcion: ' Moto negra ' } })
  assert.deepEqual(normalized.errors, []); assert.deepEqual(normalized.data.vehiculo, { placa: 'ABC123', descripcion: 'Moto negra' })
  for (const vehiculo of [{}, { descripcion: 'Bicicleta' }, { placa: 'ABC123' }]) {
    assert.deepEqual((await validate(visitValidators.directEntry, { ...payload(), vehiculo })).errors, [])
  }
  for (const vehiculo of [null, [], 'ABC123', { placa: '<script>' }, { placa: 'AB' }, { placa: 'A'.repeat(13) }, { descripcion: 'x'.repeat(151) }, { foto: 'no-permitido' }, { presente: false }]) {
    assert.ok((await validate(visitValidators.directEntry, { ...payload(), vehiculo })).errors.length)
  }
  assert.deepEqual((await validate(visitValidators.fromAppointment, { cita: ids.cita, identidadVerificada: true, vehiculo: {} })).errors, [])
  assert.deepEqual((await validate(visitValidators.entry, { identidadVerificada: true, vehiculo: { placa: 'abc123' } })).errors, [])
})

test('el modelo conserva presencia sin exigir placa ni descripción; visitas antiguas no adquieren vehículo', async () => {
  const base = { ...payload(), anfitrion: ids.actor }
  const old = new VisitaModel(base), vehicle = new VisitaModel({ ...base, vehiculo: {} })
  assert.equal(old.vehiculo, undefined); await vehicle.validate()
  assert.deepEqual(vehicle.toObject().vehiculo, { presente: true })
  for (const tipo of ['foto_vehiculo', 'foto_placa']) {
    assert.ok(ArchivoModel.schema.path('tipo').enumValues.includes(tipo))
    assert.ok(ConsentModel.schema.path('finalidad').enumValues.includes(tipo))
  }
})

test('las fotos de vehículo y placa requieren visita y finalidad válida', async () => {
  for (const tipo of ['foto_vehiculo', 'foto_placa']) {
    assert.ok((await validate(fileValidators.upload, { visitante: ids.visitor, tipo })).errors.length)
    assert.deepEqual((await validate(fileValidators.upload, { visitante: ids.visitor, visita: ids.cita, tipo })).errors, [])
  }
})

let rows = [], cita
function reset() {
  rows = []
  cita = { _id: ids.cita, visitante: ids.visitor, sede: ids.office, anfitrion: ids.actor, motivo: 'Cita', estado: 'aprobada', eventos: [], async save() {} }
}
const Visits = {
  findOne: filter => ({ select() { return this }, async session() { return rows.find(row => row.idempotencyKey === filter.idempotencyKey) || null } }),
  async create([data]) { const row = new VisitaModel(data); await row.validate(); row.save = async () => {}; rows.push(row); return [row] },
}
const Citas = {}
const adapters = {
  '../src/modules/visitas/visita.model': Visits,
  '../src/modules/citas/cita.model': Citas,
  '../src/modules/citas/cita.service': { references: async () => visitor, windowStatus: () => ({ valido: true }) },
  '../src/modules/consentimientos/consentimiento.service': { requireConsent: async () => ({ _id: ids.consent }) },
  '../src/utils/transaction': async callback => callback({}),
  '../src/utils/query': { required: async (Model, id) => Model === Citas ? cita : rows.find(row => String(row._id) === String(id)), ownScope: () => ({}) },
  '../src/modules/auditoria/auditoria.service': { record: async () => {} },
}
adapters['../src/utils/transaction'].read = operation => operation(null)
for (const [file, exports] of Object.entries(adapters)) require.cache[require.resolve(file)] = { id: require.resolve(file), filename: require.resolve(file), loaded: true, exports }
const service = require('../src/modules/visitas/visita.service')

test('ingreso directo guarda el vehículo; reintentos no duplican ni permiten cambiar placa con la misma clave', async () => {
  reset(); const data = { ...payload(), vehiculo: { placa: 'ABC123', descripcion: 'Moto negra' } }, key = randomUUID()
  const first = await service.enterDirect(data, key, actor), again = await service.enterDirect(data, key, actor)
  assert.equal(first.vehiculo.placa, 'ABC123'); assert.equal(again.vehiculo.presente, true); assert.equal(rows.length, 1)
  await assert.rejects(service.enterDirect({ ...data, vehiculo: { placa: 'XYZ987' } }, key, actor), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(rows.length, 1); assert.equal(rows[0].vehiculo.placa, 'ABC123')
})

test('sin vehículo mantiene el hash de un reintento anterior a esta versión', async () => {
  reset(); const data = payload(), key = randomUUID()
  await service.enterDirect(data, key, actor)
  const old = { operation: 'entrada_sin_cita', actor: ids.actor, visitante: ids.visitor, sede: ids.office, anfitrion: null, motivo: 'Prueba', area: null, identidadVerificada: true, equipos: [], observaciones: null }
  assert.equal(rows[0].requestHash, createHash('sha256').update(JSON.stringify(old)).digest('hex'))
  assert.equal(rows[0].vehiculo, undefined)
})

test('cita y solicitud autorizada conservan vehículo al registrar entrada y salida', async () => {
  reset(); const key = randomUUID(), data = { cita: ids.cita, identidadVerificada: true, vehiculo: { placa: 'ABC123' } }
  const entered = await service.enterAppointment(data, key, actor)
  assert.equal(entered.vehiculo.placa, 'ABC123'); assert.equal(cita.estado, 'ingresada')
  assert.equal((await service.enterAppointment(data, key, actor)).vehiculo.placa, 'ABC123'); assert.equal(rows.length, 1)
  await assert.rejects(service.enterAppointment({ ...data, vehiculo: { placa: 'XYZ987' } }, key, actor), { code: 'IDEMPOTENCY_CONFLICT' })
  const exited = await service.exit(entered._id, actor)
  assert.equal(exited.estado, 'finalizada'); assert.equal(exited.vehiculo.placa, 'ABC123'); assert.ok(exited.salidaEn)
  const [authorized] = await Visits.create([{ ...payload(), anfitrion: ids.actor, estado: 'autorizada', eventos: [] }])
  const legacy = await service.enter(authorized._id, actor, { vehiculo: { descripcion: 'Bicicleta' } })
  assert.equal(legacy.vehiculo.presente, true); assert.equal(legacy.vehiculo.descripcion, 'Bicicleta')
  const [withoutVehicle] = await Visits.create([{ ...payload(), anfitrion: ids.actor, estado: 'autorizada', vehiculo: { placa: 'XYZ987' }, eventos: [] }])
  const removal = await validate(visitValidators.entry, { identidadVerificada: true, vehiculo: null })
  assert.deepEqual(removal.errors, []); assert.equal(removal.data.vehiculo, null)
  assert.equal((await service.enter(withoutVehicle._id, actor, removal.data)).vehiculo, undefined)
})
