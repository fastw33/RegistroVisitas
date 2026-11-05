// Pruebas del servicio real con adaptadores aislados, sin iniciar MongoDB/API/S3.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const QRCode = require('qrcode')
let rows = [], audits = [], failAudit = false
const visitor = { _id: 'visitor', nombres: 'ANA', apellidos: 'PRUEBA' }
const host = { _id: 'host', nombre: 'Anfitrión' }
const actor = { _id: 'host', rol: 'anfitrion' }
const Cita = {
  create: async entries => {
    rows = entries.map((entry, index) => ({ ...entry, _id: String(index), toObject() { return Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function')) }, async save() {} }))
    return rows
  },
}
const Usuario = {}, Sede = {}
const adapters = {
  '../src/modules/citas/cita.model': Cita,
  '../src/modules/visitantes/visitante.model': { findOneAndUpdate: async () => visitor },
  '../src/modules/usuarios/usuario.model': Usuario,
  '../src/modules/sedes/sede.model': Sede,
  '../src/config/env': { lateMinutes: 30 },
  '../src/modules/auditoria/auditoria.service': { record: async (...args) => { if (failAudit) throw new Error('Auditoría no disponible'); audits.push(args) } },
  '../src/utils/query': { required: async (Model, id) => Model === Usuario ? host : Model === Sede ? { _id: 'office' } : rows.find(row => row._id === id), ownScope: () => ({}) },
  '../src/utils/transaction': async callback => { const oldRows = [...rows], oldAudits = [...audits]; try { return await callback({}) } catch (error) { rows = oldRows; audits = oldAudits; throw error } },
}
for (const [file, exports] of Object.entries(adapters)) require.cache[require.resolve(file)] = { id: require.resolve(file), filename: require.resolve(file), loaded: true, exports }
const service = require('../src/modules/citas/cita.service')
const payload = () => ({ visitante: 'visitor', sede: 'office', anfitrion: 'host', motivo: 'Reunión', inicio: new Date(Date.now() + 3600000), fin: new Date(Date.now() + 7200000) })
test('recepción agenda con aprobación y QR automáticos, solo hash almacenado y autor registrado', async () => {
  rows = []; audits = []; failAudit = false
  const scheduler = { _id: 'recepcion', rol: 'recepcion' }
  const result = await service.create(payload(), scheduler), pase = result.pases[0]
  assert.equal(result.data[0].estado, 'aprobada'); assert.match(pase.qrDataUrl, /^data:image\/png;base64,/)
  assert.equal(pase.invitacion.visitante, 'ANA PRUEBA'); assert.equal(pase.invitacion.anfitrion, host.nombre)
  assert.equal(rows[0].paseHash, createHash('sha256').update(pase.token).digest('hex'))
  assert.equal(result.data[0].paseHash, undefined); assert.equal(pase.cita.paseHash, undefined); assert.equal(rows[0].token, undefined)
  assert.equal(rows[0].eventos.find(event => event.accion === 'aprobar').actor, scheduler._id)
  assert.deepEqual(audits.map(entry => entry[1]), ['crear', 'aprobar', 'emitir_pase'])
})
test('cada fecha repetida tiene un pase distinto y renovar uno conserva los otros', async () => {
  const result = await service.create({ ...payload(), repeticion: { cantidad: 3, cadaSemanas: 1 } }, actor)
  assert.equal(result.data.length, 3); assert.equal(result.pases.length, 3); assert.equal(new Set(result.pases.map(pase => pase.token)).size, 3)
  assert.equal(+result.data[1].inicio - +result.data[0].inicio, 7 * 86400000)
  const secondHash = rows[1].paseHash
  const renewed = await service.issuePass('0', actor)
  assert.notEqual(renewed.token, result.pases[0].token); assert.equal(rows[1].paseHash, secondHash)
})
test('un anfitrión no agenda en nombre de otro ni deja citas parciales si falla el pase', async () => {
  rows = []; audits = []
  await assert.rejects(service.create({ ...payload(), anfitrion: 'other' }, actor), { status: 403 })
  assert.equal(rows.length, 0)
  const original = QRCode.toDataURL
  QRCode.toDataURL = async () => { throw new Error('No se pudo generar QR') }
  try { await assert.rejects(service.create(payload(), actor), /generar QR/); assert.equal(rows.length, 0); assert.equal(audits.length, 0) }
  finally { QRCode.toDataURL = original }
  failAudit = true
  try { await assert.rejects(service.create(payload(), actor), /Auditoría/); assert.equal(rows.length, 0) }
  finally { failAudit = false }
})
