// Adaptadores aislados: no conecta MongoDB ni sube objetos a un bucket real.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ApiError = require('../src/utils/ApiError')
const ids = { visitor: '111111111111111111111111', visit: '222222222222222222222222', consent: '333333333333333333333333' }
let row, visit, grants, validConsent, puts, removals, compressed, audits, revokeOnPut
const consent = { _id: ids.consent }
const Visitante = {}, Visita = {}, Consentimiento = { findOneAndUpdate: async () => validConsent ? consent : null }
const Archivo = {
  async create([data]) {
    row = { ...data, _id: 'archivo-test', async save() {}, toObject() { return Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function')) } }
    return [row]
  },
  findOneAndUpdate(filter, update) { Object.assign(row, update.$set); return { select: async () => row } },
  async updateOne(filter, update) { Object.assign(row, update.$set) },
}
const storage = {
  validate() {},
  async put(key, buffer, mime) { puts.push({ key, buffer, mime }); if (revokeOnPut) validConsent = false; return { versionId: 'version-test' } },
  async remove(...args) { removals.push(args) },
}
function reset() {
  row = null; visit = { _id: ids.visit, visitante: ids.visitor, vehiculo: { presente: true } }
  grants = new Set(); validConsent = true; puts = []; removals = []; compressed = []; audits = []; revokeOnPut = false
}
const adapters = {
  '../src/modules/archivos/archivo.model': Archivo,
  '../src/modules/archivos/archivo.image': { compress: async (file, type) => { compressed.push(type); file.buffer = undefined; return { buffer: Buffer.from('foto-comprimida'), mime: 'image/webp', ancho: 1440, alto: 810 } } },
  '../src/modules/visitantes/visitante.model': Visitante,
  '../src/modules/visitas/visita.model': Visita,
  '../src/modules/consentimientos/consentimiento.model': Consentimiento,
  '../src/modules/consentimientos/consentimiento.service': { async requireConsent(id, type) { if (!grants.has(type)) throw new ApiError(422, 'Falta autorización', 'CONSENT_REQUIRED'); return consent } },
  '../src/integrations/s3': { getStorage: () => storage },
  '../src/config/env': { s3: { prefix: 'registro-visitas', bucket: 'bucket-test' }, photoRetentionDays: 90 },
  '../src/utils/transaction': async callback => callback({}),
  '../src/utils/query': { async required(Model, id, session, filter) {
    if (Model === Visitante) return { _id: ids.visitor }
    if (Model === Visita) { if (filter.visitante !== visit.visitante) throw new ApiError(404, 'Visita ajena'); return visit }
    return row
  } },
  '../src/modules/auditoria/auditoria.service': { record: async (...args) => audits.push(args) },
}
for (const [file, exports] of Object.entries(adapters)) require.cache[require.resolve(file)] = { id: require.resolve(file), filename: require.resolve(file), loaded: true, exports }
const service = require('../src/modules/archivos/archivo.service')
const data = tipo => ({ visitante: ids.visitor, visita: ids.visit, tipo })
const file = () => ({ buffer: Buffer.from('imagen-original') })
const actor = { _id: 'recepcion' }

test('vehículo y placa usan autorización específica, S3 privado, compresión y vínculo a la visita', async () => {
  for (const tipo of ['foto_vehiculo', 'foto_placa']) {
    reset(); grants.add(tipo)
    const original = file(), result = await service.upload(data(tipo), original, actor)
    assert.equal(original.buffer, undefined); assert.deepEqual(compressed, [tipo])
    assert.equal(result.tipo, tipo); assert.equal(result.visita, ids.visit); assert.equal(result.consentimiento, ids.consent)
    assert.equal(result.storageEstado, 'disponible'); assert.equal(result.storageKey, undefined); assert.equal(result.storageBucket, undefined); assert.equal(result.storageVersionId, undefined)
    assert.equal(puts.length, 1); assert.match(puts[0].key, /^registro-visitas\/fotos\/[a-f0-9-]+\.webp$/)
    assert.equal(puts[0].mime, 'image/webp'); assert.equal(row.storageVersionId, 'version-test'); assert.equal(audits.length, 1)
  }
})

test('no guarda foto sin autorización específica, sin vehículo o en una visita de otra persona', async () => {
  reset(); grants.add('foto_rostro')
  await assert.rejects(service.upload(data('foto_placa'), file(), actor), { code: 'CONSENT_REQUIRED' })
  grants.add('foto_placa'); visit.vehiculo = undefined
  await assert.rejects(service.upload(data('foto_placa'), file(), actor), { code: 'VEHICLE_REQUIRED' })
  visit.vehiculo = { presente: true }; visit.visitante = 'otro-visitante'
  await assert.rejects(service.upload(data('foto_placa'), file(), actor), { status: 404 })
  assert.equal(puts.length, 0)
})

test('si se revoca la autorización durante S3, la foto no queda disponible y elimina esa versión', async () => {
  reset(); grants.add('foto_vehiculo'); revokeOnPut = true
  await assert.rejects(service.upload(data('foto_vehiculo'), file(), actor), { code: 'CONSENT_REQUIRED' })
  assert.equal(row.storageEstado, 'fallido'); assert.equal(removals.length, 1)
  assert.deepEqual(removals[0], [puts[0].key, 'bucket-test', 'version-test'])
})
