const ApiError = require('../utils/ApiError')
module.exports = (...roles) => (req, res, next) => {
  if (!roles.includes(req.usuario.rol)) throw new ApiError(403, 'No tiene permiso para esta operación', 'FORBIDDEN')
  next()
}
