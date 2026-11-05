const ApiError = require('../utils/ApiError')
module.exports = (error, req, res, next) => {
  req.releasePhotoSlot?.()
  if (res.headersSent) return next(error)
  let status = error.status || 500
  let code = error.code || 'INTERNAL_ERROR'
  let message = error instanceof ApiError ? error.message : 'Error interno del servidor'
  if (error.code === 11000) { status = 409; code = 'CONFLICT'; message = 'Ya existe un registro con esos datos o una visita activa' }
  if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) { status = 400; code = 'INVALID_DATA'; message = 'Datos inválidos' }
  if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'JSON inválido' }
  if (error.type === 'entity.too.large' || error.code === 'LIMIT_FILE_SIZE') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Archivo o solicitud demasiado grande' }
  if (error.name === 'MulterError' && status === 500) { status = 400; code = 'INVALID_UPLOAD'; message = 'Carga de archivo inválida' }
  if (status >= 500) console.error(JSON.stringify({ level: 'error', requestId: req.id, name: error.name, code: error.code || 'INTERNAL_ERROR' }))
  res.status(status).json({ error: { code, message }, requestId: req.id })
}
