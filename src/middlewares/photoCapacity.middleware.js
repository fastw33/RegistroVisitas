const env = require('../config/env')
const ApiError = require('../utils/ApiError')
let active = 0
// Se adquiere antes de Multer: también limita la memoria de archivos originales.
module.exports = (req, res, next) => {
  if (active >= env.photo.concurrency) {
    res.set('Retry-After', '2')
    return next(new ApiError(503, 'Hay otra foto procesándose; intente nuevamente en unos segundos', 'PHOTO_BUSY'))
  }
  active++
  let released = false
  req.releasePhotoSlot = () => {
    if (released) return
    released = true
    if (req.file) req.file.buffer = undefined
    active--
  }
  res.once('finish', req.releasePhotoSlot)
  // En una desconexión durante S3/Sharp se conserva el cupo hasta finalizar,
  // evitando abrir un segundo trabajo mientras el primero aún consume memoria.
  next()
}
