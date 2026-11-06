const { before, after, test } = require('node:test')
const assert = require('node:assert/strict')
const fsSync = require('node:fs')
const { Readable } = require('node:stream')
const { randomUUID } = require('node:crypto')
const { MongoMemoryReplSet } = require('mongodb-memory-server')
const request = require('supertest')
const jwt = require('jsonwebtoken')
const sharp = require('sharp')
let repl, app, mongoose, storage, users, tokens, sede, visitante, otherVisitor, cita, pass, visita, photo

before(async () => {
  storage = new Map()
  Object.assign(process.env, {
    NODE_ENV: 'test', JWT_SECRET: 'test-only-local-secret-at-least-thirty-two-characters',
    AUTH_MODE: 'both', WMS_AUTO_PROVISION: 'false', WMS_JWT_SECRET: 'test-only-wms-secret-at-least-thirty-two-characters',
    WMS_JWT_SUBJECT_CLAIM: 'id_usuario', CORS_ORIGINS: 'http://localhost:5173',
    AWS_REGION: 'us-east-1', S3_BUCKET: 'visitas-test', S3_PREFIX: 'registro-visitas', S3_ENDPOINT: '',
    PRIVACY_RESPONSIBLE: 'Empresa de prueba', PRIVACY_CONTACT: 'privacidad@example.test',
  })
  const installed = 'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe'
  const binary = process.env.MONGOMS_SYSTEM_BINARY || (fsSync.existsSync(installed) ? installed : undefined)
  repl = await MongoMemoryReplSet.create({ binary: binary ? { systemBinary: binary, checkMD5: false } : {}, replSet: { count: 1, storageEngine: 'wiredTiger' } })
  process.env.MONGODB_URI = repl.getUri('registro_visitas_test')
  app = require('../src/app')
  // Se prueba la API con el adaptador real y un cliente S3 aislado: no toca ningún bucket.
  require('../src/integrations/s3').getStorage().client = { async send(command) {
    const input = command.input
    switch (command.constructor.name) {
      case 'PutObjectCommand': storage.set(input.Key, Buffer.from(input.Body)); return { VersionId: 'version-test' }
      case 'GetObjectCommand':
        if (!storage.has(input.Key)) throw Object.assign(new Error(), { name: 'NoSuchKey' })
        return { Body: Readable.from([storage.get(input.Key)]), ContentLength: storage.get(input.Key).length }
      case 'HeadObjectCommand':
        if (!storage.has(input.Key)) throw Object.assign(new Error(), { name: 'NoSuchKey' })
        return { VersionId: 'version-test' }
      case 'DeleteObjectCommand': storage.delete(input.Key); return {}
      default: throw new Error(`Comando S3 no previsto: ${command.constructor.name}`)
    }
  } }
  const db = require('../src/config/db'); mongoose = db.mongoose; await db.connectDB()
  const Usuario = require('../src/modules/usuarios/usuario.model')
  const bcrypt = require('bcryptjs')
  users = {}
  for (const [name, rol] of Object.entries({ admin: 'admin', recepcion: 'recepcion', anfitrion: 'anfitrion', otro: 'anfitrion' })) {
    users[name] = await Usuario.create({ nombre: name, email: `${name}@example.test`, rol, wmsId: name === 'anfitrion' ? 'WMS-123' : undefined, passwordHash: await bcrypt.hash('Password-seguro-2026!', 4) })
  }
  const env = require('../src/config/env')
  tokens = Object.fromEntries(Object.entries(users).map(([name, user]) => [name, jwt.sign({}, env.jwtSecret, { subject: String(user._id), issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '1h' })]))
}, { timeout: 120000 })

after(async () => {
  if (mongoose) await mongoose.disconnect()
  if (repl) await repl.stop()
})
const call = (method, url, who = 'admin') => request(app)[method](url).set('Authorization', `Bearer ${tokens[who]}`)
const consent = async (visitor, finalidad = 'registro_visitas') => {
  const response = await call('post', '/api/consentimientos', 'recepcion').send({ visitante: visitor, finalidad, version: '1.0', aceptado: true, medio: 'casilla', evidencia: 'El visitante aceptó expresamente en el dispositivo de recepción' })
  assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body
}
async function appointment(visitor = visitante, anfitrion = users.anfitrion._id, overrides = {}) {
  const response = await call('post', '/api/citas', 'anfitrion').send({ visitante: visitor, sede, anfitrion: String(anfitrion), motivo: 'Reunión comercial', inicio: new Date(Date.now() + 5 * 60000).toISOString(), fin: new Date(Date.now() + 65 * 60000).toISOString(), ...overrides })
  assert.equal(response.status, 201, JSON.stringify(response.body))
  assert.equal(response.body.data[0].estado, 'aprobada'); assert.equal(response.body.pases.length, response.body.data.length)
  assert.equal(response.body.data[0].paseHash, undefined); assert.match(response.body.pases[0].qrDataUrl, /^data:image\/png;base64,/)
  return response.body.data[0]._id
}

test('salud, contrato OpenAPI y rutas privadas', async () => {
  assert.equal((await request(app).get('/health')).status, 200)
  assert.equal((await request(app).get('/ready')).status, 200)
  const spec = await request(app).get('/openapi.json')
  assert.equal(spec.status, 200); assert.equal(spec.body.openapi, '3.0.3')
  await require('@apidevtools/swagger-parser').validate(spec.body)
  assert.ok(spec.body.paths['/api/visitas/entrada'].post)
  assert.equal((await request(app).get('/api/visitantes')).status, 401)
  assert.equal((await call('get', '/api/usuarios', 'recepcion')).status, 403)
  assert.equal((await call('get', '/api/visitantes').set('Origin', 'https://untrusted.example')).status, 403)
})

test('login local, credenciales inválidas y asociación explícita con WMS', async () => {
  let result = await request(app).post('/api/auth/login').send({ email: 'admin@example.test', password: 'Password-seguro-2026!' })
  assert.equal(result.status, 200); assert.ok(result.body.token); assert.equal(result.body.usuario.passwordHash, undefined)
  result = await request(app).post('/api/auth/login').send({ email: 'admin@example.test', password: 'incorrecta' })
  assert.equal(result.status, 401)
  const wms = jwt.sign({ id_usuario: 'WMS-123', rol: 'admin' }, process.env.WMS_JWT_SECRET, { expiresIn: '1h' })
  result = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${wms}`)
  assert.equal(result.status, 200); assert.equal(result.body.rol, 'anfitrion')
  const unknown = jwt.sign({ id_usuario: 'NO-MAPEADO' }, process.env.WMS_JWT_SECRET, { expiresIn: '1h' })
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${unknown}`)).status, 401)
})

test('crear sede, usuarios y visitantes, rechazar duplicados y campos privilegiados', async () => {
  const response = await call('post', '/api/sedes').send({ codigo: 'BOG', nombre: 'Oficina Bogotá' })
  assert.equal(response.status, 201, JSON.stringify(response.body)); sede = response.body._id
  const user = await call('post', '/api/usuarios').send({ nombre: 'Usuario WMS', email: 'wms@example.test', rol: 'recepcion', wmsId: 'WMS-456' })
  assert.equal(user.status, 201, JSON.stringify(user.body)); assert.equal(user.body.passwordHash, undefined)
  const fields = { tipoDocumento: 'CC', numeroDocumento: '123456789', nombres: 'Persona', apellidos: 'Prueba', empresa: 'Proveedor', atributos: { categoria: 'consultor' } }
  let result = await call('post', '/api/visitantes', 'recepcion').send(fields)
  assert.equal(result.status, 201, JSON.stringify(result.body)); visitante = result.body._id
  assert.equal((await call('post', '/api/visitantes').send(fields)).status, 409)
  result = await call('post', '/api/visitantes', 'anfitrion').send({ ...fields, numeroDocumento: '987654321' })
  assert.equal(result.status, 201); otherVisitor = result.body._id
  assert.equal((await call('post', '/api/visitantes').send({ ...fields, numeroDocumento: '111111', activo: false })).status, 400)
  assert.equal((await call('get', '/api/visitantes?q[$ne]=x')).status, 200) // La clave desconocida no se usa para consultar MongoDB.
  assert.equal((await call('get', '/api/visitantes?page=0')).status, 400)
  assert.equal((await call('patch', `/api/visitantes/${visitante}`).send({ numeroDocumento: 'otro' })).status, 400)
  const found = await call('get', '/api/visitantes?documento=123456789')
  assert.equal(found.body.data.length, 1)
  const identity = await call('get', '/api/visitantes/identidad?tipoDocumento=CC&numeroDocumento=123456789', 'anfitrion')
  assert.equal(identity.status, 200); assert.equal(identity.body.data._id, visitante)
  assert.equal(identity.body.data.telefono, undefined)
})

test('consentimiento explícito, versionado y validaciones sin filtrar datos', async () => {
  const result = await call('post', '/api/consentimientos').send({ visitante, finalidad: 'registro_visitas', version: '1.0', aceptado: false, medio: 'casilla', evidencia: 'No acepta' })
  assert.equal(result.status, 400); assert.ok(!JSON.stringify(result.body).includes('123456789'))
  await consent(visitante)
})

test('agenda propia, fechas con zona horaria, aprobación y pase QR', async () => {
  cita = await appointment()
  const unauthorized = await call('get', `/api/citas/${cita}`, 'otro')
  assert.equal(unauthorized.status, 404)
  assert.equal((await call('post', `/api/citas/${cita}/aprobar`, 'recepcion').send({})).status, 403)
  assert.equal((await call('post', `/api/citas/${cita}/aprobar`, 'anfitrion').send({})).status, 200)
  const result = await call('post', `/api/citas/${cita}/pase`, 'anfitrion').send({})
  assert.equal(result.status, 200, JSON.stringify(result.body)); pass = result.body.token
  assert.match(pass, /^[a-f0-9]{64}$/); assert.ok(result.body.qrDataUrl.startsWith('data:image/png;base64,'))
  assert.equal(result.body.cita.paseHash, undefined)
  const validation = await call('post', '/api/citas/validar-pase', 'recepcion').send({ token: pass })
  assert.equal(validation.status, 200); assert.equal(validation.body.valido, true)
  const foreign = await call('post', '/api/citas', 'anfitrion').send({ visitante, sede, anfitrion: String(users.otro._id), motivo: 'Intento', inicio: new Date(Date.now() + 60000).toISOString(), fin: new Date(Date.now() + 3600000).toISOString() })
  assert.equal(foreign.status, 201)
  assert.equal(foreign.body.data[0].creadoPor, String(users.anfitrion._id))
  assert.equal((await call('get', `/api/citas/${foreign.body.data[0]._id}`, 'anfitrion')).status, 200)
  const invalid = await call('post', '/api/citas').send({ visitante, sede, anfitrion: String(users.anfitrion._id), motivo: 'Sin zona', inicio: '2026-11-04T09:00:00', fin: '2026-11-04T10:00:00' })
  assert.equal(invalid.status, 400)
})

test('entrada concurrente con cita es idempotente y consume el pase una sola vez', async () => {
  const key = randomUUID()
  const body = { token: pass, identidadVerificada: true, equipos: [{ descripcion: 'Portátil', serial: 'TEST-1' }] }
  const responses = await Promise.all(Array.from({ length: 4 }, () => call('post', '/api/visitas/entrada', 'recepcion').set('Idempotency-Key', key).send(body)))
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal(new Set(responses.map(r => r.body._id)).size, 1)
  visita = responses[0].body._id
  assert.equal(responses[0].body.idempotencyKey, undefined)
  assert.equal(await require('../src/modules/visitas/visita.model').countDocuments({ cita }), 1)
  assert.equal((await call('post', '/api/citas/validar-pase').send({ token: pass })).status, 404)
  const conflict = await call('post', '/api/visitas/entrada', 'recepcion').set('Idempotency-Key', key).send({ ...body, observaciones: 'Contenido diferente' })
  assert.equal(conflict.status, 409)
  const unverified = await call('post', '/api/visitas/entrada').set('Idempotency-Key', randomUUID()).send({ cita, identidadVerificada: false })
  assert.equal(unverified.status, 400)
})

test('historial, panel de presentes y salida idempotente', async () => {
  const history = await call('get', `/api/visitantes/${visitante}/historial`)
  assert.equal(history.status, 200); assert.equal(history.body.pagination.total, 1)
  assert.equal((await call('get', '/api/visitas?estado=dentro')).body.data.length, 1)
  assert.equal((await call('get', '/api/visitas', 'otro')).body.pagination.total, 0)
  let result = await call('post', `/api/visitas/${visita}/salida`, 'recepcion').send({})
  assert.equal(result.status, 200); assert.equal(result.body.estado, 'finalizada'); assert.ok(result.body.salidaEn)
  result = await call('post', `/api/visitas/${visita}/salida`, 'recepcion').send({})
  assert.equal(result.status, 200); assert.equal(result.body.eventos.filter(e => e.accion === 'salida').length, 1)
  assert.equal((await call('get', `/api/citas/${cita}`)).body.estado, 'finalizada')
})

test('las solicitudes del flujo previo requieren autorización del anfitrión y consentimiento', async () => {
  const result = await call('post', '/api/visitas', 'recepcion').send({ visitante: otherVisitor, sede, anfitrion: String(users.anfitrion._id), motivo: 'Entrega de propuesta' })
  assert.equal(result.status, 201, JSON.stringify(result.body)); const id = result.body._id
  assert.equal((await call('post', `/api/visitas/${id}/entrada`).send({ identidadVerificada: true })).status, 409)
  assert.equal((await call('post', `/api/visitas/${id}/autorizar`, 'otro').send({})).status, 404)
  assert.equal((await call('post', `/api/visitas/${id}/autorizar`, 'anfitrion').send({})).status, 200)
  assert.equal((await call('post', `/api/visitas/${id}/entrada`).send({ identidadVerificada: true })).status, 422)
  await consent(otherVisitor)
  const entries = await Promise.all([1, 2].map(() => call('post', `/api/visitas/${id}/entrada`, 'recepcion').send({ identidadVerificada: true })))
  entries.forEach(r => assert.equal(r.status, 200, JSON.stringify(r.body)))
  assert.equal(entries[0].body.eventos.filter(e => e.accion === 'entrada').length, 1)
  // Otra cita no puede crear una segunda presencia simultánea de la misma persona.
  const appointmentId = await appointment(otherVisitor)
  await call('post', `/api/citas/${appointmentId}/aprobar`, 'anfitrion').send({})
  const duplicate = await call('post', '/api/visitas/entrada').set('Idempotency-Key', randomUUID()).send({ cita: appointmentId, identidadVerificada: true })
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body))
  assert.equal((await call('get', `/api/citas/${appointmentId}`)).body.estado, 'aprobada')
  assert.equal((await call('post', `/api/visitas/${id}/salida`).send({})).status, 200)
})

test('reprogramar o cancelar revoca pases; una llegada anticipada permite confirmar ingreso', async () => {
  const id = await appointment()
  await call('post', `/api/citas/${id}/aprobar`, 'anfitrion').send({})
  const oldPass = (await call('post', `/api/citas/${id}/pase`)).body.token
  const start = new Date(Date.now() + 2 * 86400000)
  const rescheduled = await call('patch', `/api/citas/${id}/reprogramar`, 'anfitrion').send({ inicio: start.toISOString(), fin: new Date(+start + 3600000).toISOString() })
  assert.equal(rescheduled.status, 200); assert.equal(rescheduled.body.estado, 'pendiente')
  assert.equal((await call('post', '/api/citas/validar-pase').send({ token: oldPass })).status, 404)
  await call('post', `/api/citas/${id}/aprobar`, 'anfitrion').send({})
  const early = await call('post', '/api/visitas/entrada').set('Idempotency-Key', randomUUID()).send({ cita: id, identidadVerificada: true })
  assert.equal(early.status, 200, JSON.stringify(early.body))
  assert.match(early.body.eventos[0].detalle, /Llegada anticipada/)
  await call('post', `/api/visitas/${early.body._id}/salida`)
  const cancelId = await appointment()
  await call('post', `/api/citas/${cancelId}/cancelar`, 'anfitrion').send({ motivo: 'Cancelada por el anfitrión' })
  assert.equal((await call('post', `/api/citas/${cancelId}/pase`)).status, 409)
})

test('llegada tardía: QR advierte, permite entrada, registra diferencia y se consume una sola vez', async () => {
  const basic = { tipoDocumento: 'CC', numeroDocumento: '999777456789', nombres: 'LLEGADA', apellidos: 'TARDÍA' }
  const person = await call('post', '/api/visitantes').send(basic)
  await consent(person.body._id)
  const id = await appointment(person.body._id)
  await call('post', `/api/citas/${id}/aprobar`, 'anfitrion')
  await require('../src/modules/citas/cita.model').updateOne({ _id: id }, { $set: { inicio: new Date(Date.now() - 7200000), fin: new Date(Date.now() - 3600000) } })
  const issued = await call('post', `/api/citas/${id}/pase`)
  assert.equal(issued.status, 200)
  const validation = await call('post', '/api/citas/validar-pase').send({ token: issued.body.token })
  assert.equal(validation.body.valido, true); assert.equal(validation.body.avisoHorario.tipo, 'tardia')
  const entered = await call('post', '/api/visitas/entrada').set('Idempotency-Key', randomUUID()).send({ token: issued.body.token, identidadVerificada: true })
  assert.equal(entered.status, 200, JSON.stringify(entered.body)); assert.match(entered.body.eventos[0].detalle, /Llegada tardía/)
  assert.equal((await call('post', '/api/citas/validar-pase').send({ token: issued.body.token })).status, 404)
  await call('post', `/api/visitas/${entered.body._id}/salida`)
})

test('series semanales y ausencia después del horario', async () => {
  const result = await call('post', '/api/citas', 'anfitrion').send({ visitante, sede, anfitrion: String(users.anfitrion._id), motivo: 'Reunión semanal', inicio: new Date(Date.now() + 86400000).toISOString(), fin: new Date(Date.now() + 90000000).toISOString(), repeticion: { cantidad: 3, cadaSemanas: 1 } })
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.data.length, 3)
  assert.equal(result.body.pases.length, 3); assert.equal(new Set(result.body.pases.map(pase => pase.token)).size, 3)
  for (const pase of result.body.pases) { assert.equal(pase.cita.estado, 'aprobada'); assert.equal(pase.cita.paseHash, undefined) }
  assert.equal(new Date(result.body.data[1].inicio) - new Date(result.body.data[0].inicio), 7 * 86400000)
  const ordered = await call('get', '/api/citas?limit=100')
  const times = ordered.body.data.map(row => +new Date(row.inicio))
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  const id = result.body.data[0]._id
  assert.equal((await call('post', `/api/citas/${id}/no-asistio`).send({})).status, 409)
  await require('../src/modules/citas/cita.model').updateOne({ _id: id }, { $set: { inicio: new Date(Date.now() - 7200000), fin: new Date(Date.now() - 3600000) } })
  assert.equal((await call('post', `/api/citas/${id}/no-asistio`).send({})).body.estado, 'no_asistio')
})

test('fotos privadas: consentimiento, contenido real, permisos y auditoría de consulta', async () => {
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#336699' } }).png().toBuffer()
  let response = await call('post', '/api/archivos', 'recepcion').field('visitante', visitante).field('tipo', 'foto_rostro').attach('archivo', image, 'rostro.png')
  assert.equal(response.status, 422)
  const permission = await consent(visitante, 'foto_rostro')
  response = await call('post', '/api/archivos', 'recepcion').field('visitante', visitante).field('tipo', 'foto_rostro').attach('archivo', Buffer.from('no es imagen'), { filename: 'falsa.jpg', contentType: 'image/jpeg' })
  assert.equal(response.status, 415)
  response = await call('post', '/api/archivos', 'recepcion').field('visitante', visitante).field('visita', visita).field('tipo', 'foto_rostro').attach('archivo', image, 'rostro.png')
  assert.equal(response.status, 201, JSON.stringify(response.body)); photo = response.body._id
  assert.equal(response.body.storageKey, undefined); assert.equal(response.body.mime, 'image/webp')
  assert.ok(response.body.bytes <= 256 * 1024)
  assert.equal(response.body.bytesOriginales, image.length)
  assert.equal(response.body.storageBucket, undefined); assert.equal(response.body.storageVersionId, undefined)
  assert.equal(storage.size, 1); assert.match([...storage.keys()][0], /^registro-visitas\/fotos\//)
  assert.equal((await request(app).get(`/api/archivos/${photo}/contenido`)).status, 401)
  assert.equal((await call('get', `/api/archivos/${photo}/contenido`, 'anfitrion')).status, 403)
  const content = await call('get', `/api/archivos/${photo}/contenido`, 'recepcion')
  assert.equal(content.status, 200); assert.match(content.headers['content-type'], /image\/webp/)
  assert.match(content.headers['cache-control'], /no-store/)
  const audits = await call('get', `/api/auditoria?entidad=archivos&entidadId=${photo}`)
  assert.ok(audits.body.data.some(e => e.accion === 'consultar_imagen'))
  assert.equal((await call('post', `/api/consentimientos/${permission._id}/revocar`).send({ motivo: 'Solicitud del titular' })).status, 200)
  assert.equal((await call('get', `/api/archivos/${photo}/contenido`)).status, 410)
  const listed = await call('get', `/api/archivos?visitante=${visitante}`)
  assert.equal(listed.body.pagination.total, 0)
  await require('../src/modules/archivos/archivo.service').purge()
  assert.equal(storage.size, 0)
})

test('si S3 falla, responde 503 y no publica fotos ni guarda un respaldo local', async () => {
  await consent(visitante, 'foto_documento')
  const adapter = require('../src/integrations/s3').getStorage()
  const original = adapter.client
  adapter.client = { async send() { throw Object.assign(new Error('detalle confidencial del proveedor'), { code: 'ECONNREFUSED' }) } }
  try {
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#112233' } }).jpeg().toBuffer()
    const result = await call('post', '/api/archivos').field('visitante', visitante).field('tipo', 'foto_documento').attach('archivo', image, 'documento.jpg')
    assert.equal(result.status, 503); assert.equal(result.body.error.code, 'STORAGE_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(result.body), /confidencial/)
    assert.equal((await call('get', `/api/archivos?visitante=${visitante}`)).body.pagination.total, 0)
    assert.equal(storage.size, 0)
    assert.ok(await require('../src/modules/archivos/archivo.model').exists({ visitante, storageEstado: 'fallido', eliminadoEn: { $ne: null } }))
  } finally { adapter.client = original }
  const result = await require('../src/modules/archivos/archivo.service').purge()
  assert.equal(result.pendientes, 0)
})

test('limita la carga antes de Multer y libera capacidad después de finalizar S3', async () => {
  const adapter = require('../src/integrations/s3').getStorage()
  const original = adapter.client.send
  let signal, release
  const entered = new Promise(resolve => { signal = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  adapter.client.send = async function (command) {
    if (command.constructor.name === 'PutObjectCommand') { signal(); await blocked }
    return original.call(this, command)
  }
  let first
  try {
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#112233' } }).png().toBuffer()
    first = call('post', '/api/archivos').field('visitante', visitante).field('tipo', 'foto_documento').attach('archivo', image, 'documento.png').then(result => result)
    await entered
    const second = await call('post', '/api/archivos').field('visitante', visitante).field('tipo', 'foto_documento').attach('archivo', image, 'documento.png')
    assert.equal(second.status, 503); assert.equal(second.body.error.code, 'PHOTO_BUSY')
    assert.equal(second.headers['retry-after'], '2')
  } finally { release(); adapter.client.send = original }
  const result = await first
  assert.equal(result.status, 201)
  assert.equal((await call('delete', `/api/archivos/${result.body._id}`)).status, 200)
  // Las validaciones fallidas tampoco deben dejar el cupo ocupado.
  assert.equal((await call('post', '/api/archivos').send({})).status, 400)
  assert.equal((await call('post', '/api/archivos').send({})).status, 400)
})

test('asigna la oficina actual sin configuración ni sede en citas y visitas nuevas', async () => {
  const Sede = require('../src/modules/sedes/sede.model')
  const before = await Sede.countDocuments()
  const { ensureDefault } = require('../src/modules/sedes/sede.service')
  const current = await ensureDefault()
  await ensureDefault()
  assert.equal(await Sede.countDocuments(), before)
  const cita = await call('post', '/api/citas', 'anfitrion').send({ visitante, anfitrion: String(users.anfitrion._id), motivo: 'Sin seleccionar oficina', inicio: new Date(Date.now() + 60000).toISOString(), fin: new Date(Date.now() + 3600000).toISOString() })
  assert.equal(cita.status, 201, JSON.stringify(cita.body))
  assert.equal(cita.body.data[0].sede, String(current._id))
  const visit = await call('post', '/api/visitas', 'recepcion').send({ visitante, anfitrion: String(users.anfitrion._id), motivo: 'Visita a la oficina actual' })
  assert.equal(visit.status, 201, JSON.stringify(visit.body))
  assert.equal(visit.body.sede, String(current._id))
})

test('la integración WMS provisiona únicamente roles respaldados por permisos firmados', async () => {
  const { resolve, roleFromPermissions } = require('../src/modules/auth/wms.service')
  assert.equal(roleFromPermissions({ permisos: { visitasAgendar: true } }), 'anfitrion')
  assert.equal(roleFromPermissions({ permisos: JSON.stringify({ visitasRecepcion: true }) }), 'recepcion')
  assert.equal(roleFromPermissions({ permisos: { visitasAdministrar: true } }), 'admin')
  assert.equal(roleFromPermissions({ permisos: { esAdmin: 'true' }, rol: 'admin' }), null)
  const row = await resolve({ permisos: { visitasAgendar: true }, username: 'Usuario de prueba' }, 'WMS-FIXTURE-NEW', true)
  assert.equal(row.rol, 'anfitrion'); assert.equal(row.wmsManaged, true)
  const elevated = await resolve({ permisos: { visitasRecepcion: true }, username: 'Usuario de prueba' }, 'WMS-FIXTURE-NEW', true)
  assert.equal(elevated.rol, 'recepcion')
  await assert.rejects(resolve({ permisos: {} }, 'WMS-FIXTURE-NEW', true), error => error.status === 403)
  await require('../src/modules/usuarios/usuario.model').updateOne({ _id: row._id }, { $set: { activo: false } })
  assert.equal(await resolve({ permisos: { esAdmin: true } }, 'WMS-FIXTURE-NEW', true), null)
})

test('usuarios desactivados pierden acceso aunque el token siga vigente', async () => {
  const result = await call('patch', `/api/usuarios/${users.otro._id}`).send({ activo: false })
  assert.equal(result.status, 200)
  assert.equal((await call('get', '/api/auth/me', 'otro')).status, 401)
  assert.equal((await call('patch', `/api/usuarios/${users.admin._id}`).send({ activo: false })).status, 409)
})

test('recepción registra directamente sin cita, conserva consentimiento y no inventa aprobación del anfitrión', async () => {
  const person = await call('post', '/api/visitantes', 'recepcion').send({ tipoDocumento: 'CC', numeroDocumento: '999888777111', nombres: 'Ingreso', apellidos: 'Directo' })
  assert.equal(person.status, 201)
  const body = { visitante: person.body._id, motivo: 'Visita sin cita', identidadVerificada: true }
  const post = (data, who = 'recepcion', key = randomUUID()) => call('post', '/api/visitas/ingreso-directo', who).set('Idempotency-Key', key).send(data)
  assert.equal((await post(body, 'anfitrion')).status, 403)
  assert.equal((await post({ ...body, identidadVerificada: false })).status, 400)
  assert.equal((await call('post', '/api/visitas/ingreso-directo', 'recepcion').send(body)).status, 400)
  assert.equal((await post({ ...body, cita })).status, 400)
  const missing = await post(body)
  assert.equal(missing.status, 422); assert.equal(missing.body.error.code, 'CONSENT_REQUIRED')
  assert.equal(await require('../src/modules/visitas/visita.model').countDocuments({ visitante: person.body._id }), 0)
  const permission = await consent(person.body._id)
  const result = await post(body)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.estado, 'dentro'); assert.ok(result.body.entradaEn)
  assert.equal(result.body.cita, undefined)
  assert.equal(result.body.anfitrion, undefined)
  assert.equal(result.body.autorizadoPor, String(users.recepcion._id))
  assert.equal(result.body.entradaPor, String(users.recepcion._id))
  assert.equal(result.body.consentimientoRegistro, permission._id)
  assert.deepEqual(result.body.eventos.map(item => item.accion), ['entrada_sin_cita'])
  assert.equal(result.body.idempotencyKey, undefined); assert.equal(result.body.requestHash, undefined)
  const audit = await require('../src/modules/auditoria/auditoria.model').find({ entidad: 'visitas', entidadId: result.body._id })
  assert.equal(audit.length, 1); assert.equal(audit[0].accion, 'entrada_sin_cita'); assert.equal(String(audit[0].actor), String(users.recepcion._id))
  assert.equal((await post(body)).status, 409) // Otra clave no puede crear dos presencias activas.
  const exit = await call('post', `/api/visitas/${result.body._id}/salida`, 'recepcion').send({})
  assert.equal(exit.status, 200) // El documento sigue siendo válido al guardar una salida sin anfitrión.
})

test('ingreso directo concurrente usa la misma visita y su reintento después de salida no vuelve a ingresar', async () => {
  const person = await call('post', '/api/visitantes', 'recepcion').send({ tipoDocumento: 'CC', numeroDocumento: '999888777222', nombres: 'Concurrente', apellidos: 'Directo' })
  assert.equal(person.status, 201); await consent(person.body._id)
  const body = { visitante: person.body._id, anfitrion: String(users.anfitrion._id), motivo: 'Prueba directa', identidadVerificada: true }
  const key = randomUUID()
  const post = (data = body, who = 'recepcion') => call('post', '/api/visitas/ingreso-directo', who).set('Idempotency-Key', key).send(data)
  const results = await Promise.all(Array.from({ length: 4 }, () => post()))
  results.forEach(result => assert.equal(result.status, 200, JSON.stringify(result.body)))
  const id = results[0].body._id
  assert.equal(new Set(results.map(item => item.body._id)).size, 1)
  assert.equal(await require('../src/modules/visitas/visita.model').countDocuments({ visitante: person.body._id }), 1)
  assert.equal((await post({ ...body, motivo: 'Otra visita' })).status, 409)
  assert.equal((await post(body, 'admin')).status, 409)
  assert.equal((await call('post', `/api/visitas/${id}/salida`, 'recepcion').send({})).status, 200)
  const replay = await post()
  assert.equal(replay.status, 200); assert.equal(replay.body._id, id); assert.equal(replay.body.estado, 'finalizada')
})

test('la oficina permite nuevas autorizaciones con Fastwaysas predeterminada y no presta su contacto a otra empresa', async () => {
  const saved = { responsible: process.env.PRIVACY_RESPONSIBLE, contact: process.env.PRIVACY_CONTACT }
  try {
    process.env.PRIVACY_RESPONSIBLE = ' '
    process.env.PRIVACY_CONTACT = ''
    const policy = await call('get', '/api/consentimientos/politica', 'recepcion')
    assert.equal(policy.status, 200); assert.equal(policy.body.responsable, 'Fastwaysas')
    assert.match(policy.body.contacto, /https:\/\/www\.fastwaysas\.com\/contacto/)
    const person = await call('post', '/api/visitantes', 'recepcion').send({ tipoDocumento: 'CC', numeroDocumento: '999888777333', nombres: 'Autorización', apellidos: 'Predeterminada' })
    assert.equal(person.status, 201)
    const granted = await consent(person.body._id)
    assert.equal(granted.responsable, 'Fastwaysas'); assert.equal(granted.contacto, policy.body.contacto)
    delete process.env.PRIVACY_RESPONSIBLE; delete process.env.PRIVACY_CONTACT
    const omitted = await call('get', '/api/consentimientos/politica', 'recepcion')
    assert.equal(omitted.body.responsable, granted.responsable); assert.equal(omitted.body.contacto, granted.contacto)
    process.env.PRIVACY_RESPONSIBLE = 'Otra empresa'
    const other = await call('get', '/api/consentimientos/politica', 'recepcion')
    assert.equal(other.body.contacto, '')
    const blocked = await call('post', '/api/consentimientos', 'recepcion').send({ visitante: person.body._id, finalidad: 'registro_visitas', version: '1.0', aceptado: true, medio: 'casilla', evidencia: 'Confirmación en la oficina' })
    assert.equal(blocked.status, 503)
  } finally {
    for (const [name, value] of [['PRIVACY_RESPONSIBLE', saved.responsible], ['PRIVACY_CONTACT', saved.contact]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  }
})

test('datos opcionales del documento: autorización expresa, validación, acceso mínimo y revocación', async () => {
  const basic = { tipoDocumento: 'CC', numeroDocumento: '9990007890', nombres: 'PRUEBA', apellidos: 'DOCUMENTO' }
  const created = await call('post', '/api/visitantes', 'recepcion').send(basic)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body._id, url = `/api/visitantes/${id}/datos-documento`
  const datosDocumento = { fechaNacimiento: '1990-10-30', sexo: 'F', grupoSanguineo: 'AB+', estaturaCm: 170, lugarNacimiento: 'Bogotá', codigoLugarNacimiento: '15001', fechaExpedicion: '2008-11-20', lugarExpedicion: 'Bogotá' }
  const payload = { datosDocumento, aceptado: true, version: '1.0' }
  assert.equal((await call('patch', url, 'anfitrion').send(payload)).status, 403)
  assert.equal((await call('patch', url).send({ ...payload, aceptado: false })).status, 400)
  assert.equal((await call('patch', url).send({ ...payload, datosDocumento: { ...datosDocumento, huellas: 'prohibido' } })).status, 400)
  for (const invalid of [{ fechaNacimiento: '2000-02-30' }, { grupoSanguineo: 'ZZ+' }, { estaturaCm: 500 }, { fechaNacimiento: '2999-01-01' }, { fechaExpedicion: '1980-01-01' }]) {
    assert.equal((await call('patch', url).send({ ...payload, datosDocumento: { ...datosDocumento, ...invalid } })).status, 400)
  }
  assert.equal((await call('post', '/api/visitantes').send({ ...basic, numeroDocumento: '9990007891', datosDocumento })).status, 400)
  const result = await call('patch', url, 'recepcion').send(payload)
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(result.body.datosDocumento, datosDocumento)
  assert.equal(result.body.consentimientoDocumento, undefined)
  const Consentimiento = require('../src/modules/consentimientos/consentimiento.model')
  const first = await Consentimiento.findOne({ visitante: id, finalidad: 'datos_documento' })
  assert.ok(first); assert.match(first.texto, /dato sensible/)
  assert.equal((await call('patch', url, 'recepcion').send(payload)).status, 200)
  assert.equal(await Consentimiento.countDocuments({ visitante: id, finalidad: 'datos_documento' }), 1)
  const identity = await call('get', `/api/visitantes/identidad?tipoDocumento=CC&numeroDocumento=${basic.numeroDocumento}`, 'anfitrion')
  assert.equal(identity.body.data.datosDocumento, undefined)
  assert.deepEqual((await call('get', `/api/visitantes/${id}`, 'recepcion')).body.datosDocumento, datosDocumento)
  assert.equal((await call('patch', `/api/visitantes/${id}`).send({ datosDocumento })).status, 400)
  assert.equal((await call('post', `/api/consentimientos/${first._id}/revocar`, 'recepcion').send({ motivo: 'El titular revocó los datos opcionales' })).status, 200)
  assert.equal((await call('get', `/api/visitantes/${id}`, 'recepcion')).body.datosDocumento, undefined)
  // Revoking additional data never prevents entering with the basic identity.
  await consent(id)
  assert.equal((await call('post', '/api/visitas/ingreso-directo', 'recepcion').set('Idempotency-Key', randomUUID()).send({ visitante: id, sede, motivo: 'Visita sin datos opcionales', identidadVerificada: true })).status, 200)
})

test('correcciones administrativas: autorización, concurrencia, reintentos, historial y revocación del QR', async () => {
  const anterior = { tipoDocumento: 'CC', numeroDocumento: '999000456700', nombres: 'ANA', apellidos: 'PRUEBA' }
  const created = await call('post', '/api/visitantes').send(anterior)
  assert.equal(created.status, 201)
  const id = created.body._id, url = `/api/visitantes/${id}/correcciones`
  await consent(id)
  const entry = await call('post', '/api/visitas/ingreso-directo', 'recepcion').set('Idempotency-Key', randomUUID()).send({ visitante: id, sede, motivo: 'Prueba anterior', identidadVerificada: true })
  assert.equal(entry.status, 200)
  assert.equal((await call('post', `/api/visitas/${entry.body._id}/salida`, 'recepcion')).status, 200)
  const open = await call('post', '/api/visitas/ingreso-directo', 'recepcion').set('Idempotency-Key', randomUUID()).send({ visitante: id, sede, motivo: 'Prueba abierta', identidadVerificada: true })
  assert.equal(open.status, 200)
  const citaId = await appointment(id)
  assert.equal((await call('post', `/api/citas/${citaId}/aprobar`, 'anfitrion')).status, 200)
  const issued = await call('post', `/api/citas/${citaId}/pase`, 'anfitrion')
  assert.equal(issued.status, 200); assert.equal(issued.body.invitacion.visitante, 'ANA PRUEBA')
  const data = { anterior, correccion: { ...anterior, numeroDocumento: '999000456701', nombres: 'ANA MARÍA' }, motivo: 'Verificado con documento físico', requestKey: randomUUID() }
  assert.equal((await call('post', url, 'recepcion').send(data)).status, 403)
  assert.equal((await call('get', url, 'recepcion')).status, 403)
  assert.equal((await call('patch', `/api/visitantes/${id}`).send({ nombres: 'Sin auditoría' })).status, 400)
  const duplicate = await call('post', '/api/visitantes').send({ ...anterior, numeroDocumento: data.correccion.numeroDocumento })
  assert.equal(duplicate.status, 201)
  assert.equal((await call('post', url).send(data)).status, 409)
  data.correccion.numeroDocumento = '999000456702'
  const corrected = await call('post', url).send(data)
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body)); assert.equal(corrected.body.correccion.requestHash, undefined)
  const retried = await call('post', url).send(data)
  assert.equal(retried.status, 200); assert.equal(retried.body.reutilizada, true)
  assert.equal((await call('post', url).send({ ...data, motivo: 'Otro motivo' })).status, 409)
  assert.equal((await call('post', url).send({ ...data, requestKey: randomUUID() })).status, 409)
  const changes = await call('get', url)
  assert.equal(changes.body.pagination.total, 1); assert.deepEqual(changes.body.data[0].anterior, anterior)
  assert.equal(changes.body.data[0].registradoPor.nombre, users.admin.nombre); assert.equal(changes.body.data[0].requestHash, undefined)
  const closed = await call('get', `/api/visitas/${entry.body._id}`), current = await call('get', `/api/visitas/${open.body._id}`)
  assert.equal(closed.body.identidad.numeroDocumento, anterior.numeroDocumento)
  assert.equal(current.body.identidad.numeroDocumento, data.correccion.numeroDocumento)
  assert.ok(current.body.eventos.some(event => event.accion === 'corregir_identidad'))
  assert.equal((await call('post', '/api/citas/validar-pase', 'recepcion').send({ token: issued.body.token })).status, 404)
  const newPass = await call('post', `/api/citas/${citaId}/pase`, 'anfitrion')
  assert.equal(newPass.status, 200); assert.equal(newPass.body.invitacion.visitante, 'ANA MARÍA PRUEBA')
})
