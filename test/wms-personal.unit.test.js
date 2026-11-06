const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { agendaScope, ownScope } = require('../src/utils/query')
const ApiError = require('../src/utils/ApiError')
function fixture(fetch) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/integrations/wms-personal.js'), 'utf8'), {
    module, fetch, AbortSignal, Date, require(name) {
      if (name === '../config/env') return { wmsApiUrl: 'https://wms.example.test/api/' }
      if (name === '../utils/ApiError') return ApiError
      return require(name)
    },
  })
  return module.exports
}
test('el directorio conserva nombres, elimina datos personales extra y omite retirados', () => {
  const service = fixture(), rows = service.normalize([
    { id_usuario: 12, Nombre: '  Ana ', Apellido: 'Prueba', Id_personal: 'documento-no-exponer', password: 'no-exponer' },
    { id_usuario: 13, Nombre: 'Retirado', fecha_retiro: '2026-11-01' },
    { id_usuario: 14, Nombre: 'Vigente', fecha_retiro: '2026-12-01' },
    { id_usuario: 'invalido', Nombre: 'No usar' },
  ], new Date('2026-11-06T15:00:00Z'))
  assert.equal(rows.length, 2); assert.equal(rows[0].nombre, 'Ana Prueba')
  assert.match(rows[0]._id, /^[a-f0-9]{24}$/)
  assert.equal(rows[0]._id, service.receiverId('12'))
  assert.deepEqual(Object.keys(rows[0]).sort(), ['_id', 'nombre', 'wmsId'])
  assert.throws(() => service.normalize({ data: [] }), { code: 'WMS_DIRECTORY_UNAVAILABLE' })
})
test('consulta solo el WMS configurado, propaga la sesión y prohíbe redirecciones', async () => {
  const service = fixture(async (url, options) => {
    assert.equal(url, 'https://wms.example.test/api/personal')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    assert.equal(options.redirect, 'error'); assert.ok(options.signal)
    return { ok: true, json: async () => [{ id_usuario: 1, Nombre: 'Ana' }] }
  })
  assert.equal((await service.getPersonal('fixture-token'))[0].nombre, 'Ana')
})
test('errores remotos no exponen credenciales ni respuestas privadas', async () => {
  for (const fetch of [async () => { throw new Error('contenido-privado') }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ invalido: true }) })]) {
    await assert.rejects(fixture(fetch).getPersonal('fixture-token'), error => error.code === 'WMS_DIRECTORY_UNAVAILABLE' && !/privado|fixture-token/.test(error.message))
  }
})
test('el asistente ve únicamente citas que recibe o que creó; los permisos de visitas no se amplían', () => {
  const assistant = { _id: 'assistant', rol: 'anfitrion' }
  assert.deepEqual(agendaScope(assistant), { $or: [{ anfitrion: 'assistant' }, { creadoPor: 'assistant' }] })
  assert.deepEqual(ownScope(assistant), { anfitrion: 'assistant' })
  assert.deepEqual(agendaScope({ rol: 'recepcion' }), {})
})
