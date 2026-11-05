const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { S3Storage } = require('../src/integrations/s3/s3.storage')
const config = { bucket: 'bucket-test', region: 'us-east-1', prefix: 'registro-visitas', maxBytes: 100 }
const key = 'registro-visitas/fotos/8c7ea920-30c5-4cf0-8be4-a6c39017cf35.jpg'

test('adaptador S3 privado: bucket, checksum, versión y eliminación de la versión exacta', async () => {
  const commands = []
  const storage = new S3Storage(config, { async send(command) {
    commands.push(command)
    if (command.constructor.name === 'PutObjectCommand') return { VersionId: 'v1' }
    if (command.constructor.name === 'GetObjectCommand') return { Body: Readable.from([Buffer.from('foto')]), ContentLength: 4 }
    return {}
  } })
  const uploaded = await storage.put(key, Buffer.from('foto'), 'image/jpeg')
  assert.equal(uploaded.versionId, 'v1')
  assert.equal(commands[0].input.Bucket, config.bucket)
  assert.equal(commands[0].input.ACL, undefined)
  assert.equal(commands[0].input.CacheControl, 'private, no-store')
  assert.ok(commands[0].input.ChecksumSHA256)
  assert.deepEqual(await storage.get(key, config.bucket, 'v1'), Buffer.from('foto'))
  await storage.remove(key, config.bucket, 'v1')
  assert.equal(commands.at(-1).input.VersionId, 'v1')
  await assert.rejects(storage.get('radicados/ajeno.pdf', config.bucket), { code: 'INVALID_STORAGE_KEY' })
  await assert.rejects(storage.remove(key, 'otro-bucket'), { code: 'STORAGE_BUCKET_MISMATCH' })
  assert.equal(commands.length, 3)
})

test('recupera VersionId antes de eliminar una carga interrumpida', async () => {
  const commands = []
  const storage = new S3Storage(config, { async send(command) {
    commands.push(command)
    return command.constructor.name === 'HeadObjectCommand' ? { VersionId: 'interrumpida' } : {}
  } })
  await storage.remove(key, config.bucket)
  assert.equal(commands.length, 2); assert.equal(commands[1].input.VersionId, 'interrumpida')
})

test('errores de S3 son explícitos y no filtran datos del proveedor', async () => {
  for (const [provider, expected] of [['NoSuchBucket', 'STORAGE_BUCKET_UNAVAILABLE'], ['AccessDenied', 'STORAGE_ACCESS_DENIED'], ['CredentialsProviderError', 'STORAGE_ACCESS_DENIED'], ['ECONNREFUSED', 'STORAGE_UNAVAILABLE'], ['NoSuchKey', 'STORAGE_OBJECT_GONE']]) {
    const storage = new S3Storage(config, { async send() { throw Object.assign(new Error('detalle confidencial'), { name: provider }) } })
    await assert.rejects(storage.get(key, config.bucket), error => error.code === expected && !error.message.includes('confidencial'))
  }
})

test('limita el tamaño real durante la lectura S3', async () => {
  const storage = new S3Storage({ ...config, maxBytes: 3 }, { async send() { return { Body: Readable.from([Buffer.from('12'), Buffer.from('34')]) } } })
  await assert.rejects(storage.get(key, config.bucket), { status: 413 })
})
