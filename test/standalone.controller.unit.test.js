const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable, Writable } = require('node:stream')
let failCommit = false, opened
const transaction = { async read(operation) { const result = await operation(); if (failCommit) throw new Error('confirmación incierta'); return result } }
const service = { async download() { opened = Readable.from([Buffer.from('foto-prueba')]); return { row: { _id: 'foto-test', mime: 'image/webp' }, body: opened } } }
for (const [file, exports] of [['../src/utils/transaction', transaction], ['../src/modules/archivos/archivo.service', service]]) require.cache[require.resolve(file)] = { id: require.resolve(file), filename: require.resolve(file), loaded: true, exports }
const controller = require('../src/modules/archivos/archivo.controller')
const request = { params: { id: 'foto-test' }, usuario: {}, id: 'request-test' }
function response() {
  const chunks = [], res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done() } })
  res.set = headers => { res.headers = headers }
  return { res, chunks }
}
test('una confirmación incierta destruye el stream S3 sin enviar bytes ni cabeceras de foto', async () => {
  failCommit = true; const { res, chunks } = response()
  await assert.rejects(controller.download(request, res), /confirmación incierta/)
  assert.equal(opened.destroyed, true); assert.equal(chunks.length, 0); assert.equal(res.headers, undefined)
})
test('la consulta confirmada transmite por stream, fuera del bloqueo de la base', async () => {
  failCommit = false; const { res, chunks } = response()
  await controller.download(request, res)
  assert.equal(Buffer.concat(chunks).toString(), 'foto-prueba')
  assert.equal(res.headers['Content-Type'], 'image/webp'); assert.equal(res.headers['Cache-Control'], 'private, no-store')
})
