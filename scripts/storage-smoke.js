const { randomUUID } = require('node:crypto')
const sharp = require('sharp')
const { compress } = require('../src/modules/archivos/archivo.image')
const env = require('../src/config/env')
const { getStorage } = require('../src/integrations/s3')
const ApiError = require('../src/utils/ApiError')

async function main() {
  const storage = getStorage()
  const key = `${env.s3.prefix}/fotos/${randomUUID()}.webp`
  const original = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#426487' } }).jpeg({ quality: 95 }).toBuffer()
  const { buffer: image } = await compress({ buffer: original }, 'foto_documento')
  let object
  try {
    object = await storage.put(key, image, 'image/webp')
    const result = await storage.get(key, object.bucket, object.versionId)
    if (!result.equals(image)) throw new Error('La lectura no coincide con la imagen de prueba')
    // Validación anónima para MinIO/S3 compatible. No se usa una foto personal.
    if (env.s3.endpoint && env.s3.forcePathStyle) {
      const url = new URL(env.s3.endpoint)
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(object.bucket)}/${key}`
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      if (![401, 403, 404].includes(response.status)) throw new Error('La imagen de prueba permite acceso anónimo o devolvió un estado inesperado')
      console.log(`Lectura anónima bloqueada: HTTP ${response.status}.`)
    }
    console.log(`Carga y lectura S3 verificadas: JPEG sintético ${original.length} bytes → WebP ${image.length} bytes.`)
  } finally {
    if (object) {
      await storage.remove(key, object.bucket, object.versionId)
      console.log('Imagen sintética eliminada del bucket.')
    }
  }
}
main().catch(error => {
  console.error(error instanceof ApiError ? `${error.code}: ${error.message}` : 'No se pudo completar la prueba S3')
  process.exitCode = 1
})
