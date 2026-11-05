const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3')
const { createHash } = require('node:crypto')
const { Transform } = require('node:stream')
const ApiError = require('../../utils/ApiError')

// Mismo patrón de GestorDocumental: SDK v3, proveedor estándar de credenciales,
// objetos privados y acceso a través de la API. No hay respaldo local.
class S3Storage {
  constructor(config, client) {
    this.config = config
    this.client = client || new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: config.forcePathStyle } : {}),
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
    })
  }

  validate(key, bucket = this.config.bucket) {
    if (!this.config.bucket || !this.config.region) throw new ApiError(503, 'Configure S3_BUCKET y AWS_REGION', 'STORAGE_NOT_CONFIGURED')
    if (bucket !== this.config.bucket) throw new ApiError(503, 'El bucket de la foto no coincide con el almacenamiento configurado', 'STORAGE_BUCKET_MISMATCH')
    const relative = key.startsWith(`${this.config.prefix}/fotos/`) ? key.slice(`${this.config.prefix}/fotos/`.length) : ''
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:jpg|webp)$/.test(relative)) throw new ApiError(400, 'Objeto fuera del prefijo de fotos de visitas', 'INVALID_STORAGE_KEY')
  }

  async send(command) {
    try { return await this.client.send(command) }
    catch (error) {
      const candidates = [error, error.cause, ...(Array.isArray(error.errors) ? error.errors : [])]
      const has = values => candidates.some(e => values.some(v => [e?.name, e?.code, e?.Code].includes(v)))
      if (has(['NoSuchBucket']) || (command instanceof HeadBucketCommand && error.$metadata?.httpStatusCode === 404)) throw new ApiError(503, 'El bucket configurado no existe o no está disponible', 'STORAGE_BUCKET_UNAVAILABLE')
      if (has(['NoSuchKey', 'NoSuchVersion', 'NotFound']) || error.$metadata?.httpStatusCode === 404) throw new ApiError(410, 'La imagen ya no está disponible en S3', 'STORAGE_OBJECT_GONE')
      if (has(['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'CredentialsProviderError', 'ExpiredToken']) || [401, 403].includes(error.$metadata?.httpStatusCode)) throw new ApiError(503, 'Revise las credenciales y permisos del almacenamiento S3', 'STORAGE_ACCESS_DENIED')
      throw new ApiError(503, 'No se pudo conectar u operar con el almacenamiento S3 configurado', 'STORAGE_UNAVAILABLE')
    }
  }

  async put(key, bytes, mime) {
    this.validate(key)
    const result = await this.send(new PutObjectCommand({
      Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: mime,
      CacheControl: 'private, no-store',
      ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
      Metadata: { sha256: createHash('sha256').update(bytes).digest('hex'), application: 'genika-registro-visitas' },
      // No se envía ACL pública ni se cambia el cifrado/política del bucket.
    }))
    return { bucket: this.config.bucket, versionId: result.VersionId }
  }

  async open(key, bucket, versionId) {
    this.validate(key, bucket)
    const result = await this.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(versionId ? { VersionId: versionId } : {}) }))
    if (result.ContentLength > this.config.maxBytes) {
      result.Body?.destroy?.()
      throw new ApiError(413, 'La imagen almacenada supera el tamaño permitido', 'STORAGE_OBJECT_TOO_LARGE')
    }
    if (!result.Body?.pipe) {
      result.Body?.destroy?.()
      throw new ApiError(503, 'Respuesta S3 sin flujo de imagen', 'STORAGE_INVALID_RESPONSE')
    }
    let size = 0
    const maximum = this.config.maxBytes
    const body = new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length
      callback(size > maximum ? new ApiError(413, 'La imagen almacenada supera el tamaño permitido', 'STORAGE_OBJECT_TOO_LARGE') : null, chunk)
    } })
    // Puede fallar mientras el servicio registra la auditoría, antes de conectar HTTP.
    // pipeline()/for-await observarán igualmente body.errored al comenzar a consumir.
    body.on('error', () => {})
    result.Body.once('error', error => body.destroy(error))
    body.once('close', () => result.Body.destroy())
    result.Body.pipe(body)
    return { body, length: result.ContentLength }
  }

  // Solo herramientas de comprobación. Las descargas HTTP usan open() sin concatenar.
  async get(key, bucket, versionId) {
    const { body } = await this.open(key, bucket, versionId)
    const chunks = []
    for await (const chunk of body) chunks.push(chunk)
    return Buffer.concat(chunks)
  }

  async remove(key, bucket, versionId) {
    this.validate(key, bucket)
    try {
      // Recupera VersionId de una carga interrumpida para no crear solo un delete marker.
      if (!versionId) versionId = (await this.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).VersionId
      await this.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, ...(versionId ? { VersionId: versionId } : {}) }))
    }
    catch (error) { if (error.code !== 'STORAGE_OBJECT_GONE') throw error }
  }

  async check() {
    if (!this.config.bucket || !this.config.region) throw new ApiError(503, 'Configure S3_BUCKET y AWS_REGION', 'STORAGE_NOT_CONFIGURED')
    await this.send(new HeadBucketCommand({ Bucket: this.config.bucket }))
    return { disponible: true }
  }
}
module.exports = { S3Storage }
