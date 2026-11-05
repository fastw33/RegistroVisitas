const sharp = require('sharp')
const env = require('../../config/env')
const ApiError = require('../../utils/ApiError')

// Libvips puede retener imágenes decodificadas en caché entre peticiones.
// Esta API prioriza memoria estable sobre procesar muchas fotos en paralelo.
sharp.cache(false)
sharp.concurrency(1)

async function compress(file, tipo) {
  if (!file?.buffer) throw new ApiError(400, 'Adjunte una imagen en el campo archivo')
  const bytesOriginales = file.buffer.length
  const document = ['foto_documento', 'foto_vehiculo', 'foto_placa'].includes(tipo)
  let quality = document ? env.photo.documentQuality : env.photo.faceQuality
  let buffer, info
  try {
    const image = sharp(file.buffer, { limitInputPixels: 20000000, sequentialRead: true, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('Formato inválido')
    const size = document ? env.photo.documentPixels : env.photo.facePixels
    ;({ data: buffer, info } = await image.rotate().flatten({ background: '#ffffff' })
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 3 }).toBuffer({ resolveWithObject: true }))
    // Soltar la foto original antes de Mongo/S3 y no volver a decodificarla.
    file.buffer = undefined
    // Reintentos acotados sobre la foto ya reducida; no se usan clones paralelos.
    for (let attempt = 0; buffer.length > env.photo.maxBytes && attempt < 2; attempt++) {
      quality = Math.max(document ? 60 : 45, quality - 8)
      ;({ data: buffer, info } = await sharp(buffer, { sequentialRead: true })
        .resize({ width: Math.max(document ? 1024 : 480, Math.floor(info.width * 0.85)), withoutEnlargement: true })
        .webp({ quality, effort: 3 }).toBuffer({ resolveWithObject: true }))
    }
  } catch {
    throw new ApiError(415, 'Imagen inválida. Use JPEG, PNG o WebP, sin animación y hasta 20 megapíxeles')
  } finally { file.buffer = undefined }
  if (buffer.length > env.photo.maxBytes) throw new ApiError(422, 'La foto sigue siendo demasiado grande; recorte la imagen o acérquese al objeto', 'PHOTO_OUTPUT_TOO_LARGE')
  return { buffer, mime: 'image/webp', bytesOriginales, ancho: info.width, alto: info.height, calidad: quality }
}
module.exports = { compress }
