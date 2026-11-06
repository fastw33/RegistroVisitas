const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const env = require('../../config/env')
const Usuario = require('../usuarios/usuario.model')
const { publicUser } = require('../usuarios/usuario.service')
const { record } = require('../auditoria/auditoria.service')
const ApiError = require('../../utils/ApiError')
const dummyHash = bcrypt.hashSync('dummy-password-not-a-real-user', 12)
async function login({ email, password }) {
  if (env.authMode === 'wms') throw new ApiError(403, 'Use el inicio de sesión de WMS')
  const user = await Usuario.findOne({ email, activo: true, soloDirectorio: { $ne: true } }).select('+passwordHash')
  const valid = await bcrypt.compare(password, user?.passwordHash || dummyHash)
  if (!valid || !user?.passwordHash) throw new ApiError(401, 'Credenciales inválidas', 'UNAUTHORIZED')
  await record(user, 'login', 'usuarios', user._id)
  return { token: jwt.sign({}, env.jwtSecret, { algorithm: 'HS256', subject: String(user._id), issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: env.jwtExpiresIn }), tokenType: 'Bearer', usuario: publicUser(user) }
}
module.exports = { login }
