const jwt = require('jsonwebtoken')
const env = require('../config/env')
const Usuario = require('../modules/usuarios/usuario.model')
const ApiError = require('../utils/ApiError')

module.exports = async (req, res, next) => {
  const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')
  if (!match) throw new ApiError(401, 'Token no proporcionado', 'UNAUTHORIZED')
  let user
  if (env.authMode !== 'wms') {
    try {
      const payload = jwt.verify(match[1], env.jwtSecret, { algorithms: ['HS256'], issuer: env.jwtIssuer, audience: env.jwtAudience })
      if (/^[a-f0-9]{24}$/i.test(payload.sub || '')) user = await Usuario.findOne({ _id: payload.sub, activo: true })
    } catch (error) { if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) throw error }
  }
  if (!user && env.authMode !== 'local') {
    try {
      const payload = jwt.verify(match[1], env.wmsSecret, { algorithms: ['HS256'], issuer: env.wmsIssuer, audience: env.wmsAudience })
      const subject = payload[env.wmsSubjectClaim]
      if (['string', 'number'].includes(typeof subject)) user = await require('../modules/auth/wms.service').resolve(payload, subject, env.wmsAutoProvision)
    } catch (error) { if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) throw error }
  }
  if (!user) throw new ApiError(401, 'Token inválido, expirado o usuario sin acceso', 'UNAUTHORIZED')
  req.usuario = user
  next()
}
