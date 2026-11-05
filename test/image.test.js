const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { randomBytes } = require('node:crypto')
process.env.JWT_SECRET = 'test-only-image-config-secret-at-least-32-characters'
const { compress } = require('../src/modules/archivos/archivo.image')

test('reduce una imagen grande, elimina EXIF y conserva más resolución para documentos', async () => {
  const original = await sharp(randomBytes(2400 * 1600 * 3), { raw: { width: 2400, height: 1600, channels: 3 } })
    .jpeg({ quality: 95 }).withMetadata({ exif: { IFD0: { Artist: 'metadata que no se debe conservar' } } }).toBuffer()
  const face = { buffer: original }
  const document = { buffer: original }
  const a = await compress(face, 'foto_rostro')
  const b = await compress(document, 'foto_documento')
  assert.equal(face.buffer, undefined); assert.equal(document.buffer, undefined)
  assert.equal(a.mime, 'image/webp'); assert.ok(a.ancho <= 720); assert.ok(a.alto <= 720)
  assert.ok(b.ancho <= 1440); assert.ok(b.ancho > a.ancho)
  assert.ok(a.buffer.length <= 256 * 1024); assert.ok(b.buffer.length <= 256 * 1024)
  assert.ok(a.buffer.length < original.length); assert.ok(b.buffer.length < original.length)
  const result = await sharp(b.buffer).metadata()
  assert.equal(result.format, 'webp'); assert.equal(result.exif, undefined); assert.equal(result.icc, undefined)
})

test('rechaza contenido falso y libera el buffer original también al fallar', async () => {
  const file = { buffer: Buffer.from('no es una imagen') }
  await assert.rejects(compress(file, 'foto_rostro'), error => error.status === 415)
  assert.equal(file.buffer, undefined)
})

test('vehículo y placa conservan detalle sin EXIF dentro del mismo límite comprimido', async () => {
  const input = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#d8e7f1' } }).jpeg().withMetadata({ exif: { IFD0: { Artist: 'prueba' } } }).toBuffer()
  for (const type of ['foto_vehiculo', 'foto_placa']) {
    const file = { buffer: input }, result = await compress(file, type)
    assert.equal(file.buffer, undefined); assert.equal(result.mime, 'image/webp')
    assert.ok(result.ancho > 720 && result.ancho <= 1440); assert.ok(result.buffer.length <= 256 * 1024)
    const metadata = await sharp(result.buffer).metadata()
    assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined)
  }
})

test('rechaza imágenes de más de 20 megapíxeles antes de generar la salida', async () => {
  const file = { buffer: await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#fff' } }).png().toBuffer() }
  await assert.rejects(compress(file, 'foto_documento'), error => error.status === 415)
  assert.equal(file.buffer, undefined)
})

test('no amplía fotos pequeñas y compone transparencia sobre fondo blanco', async () => {
  const file = { buffer: await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer() }
  const output = await compress(file, 'foto_documento')
  assert.equal(output.ancho, 32); assert.equal(output.alto, 24)
  const { data } = await sharp(output.buffer).raw().toBuffer({ resolveWithObject: true })
  assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240)
})
