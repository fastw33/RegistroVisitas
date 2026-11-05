const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const { randomUUID } = require('node:crypto')
const { rateLimit } = require('express-rate-limit')
const mongoose = require('mongoose')
const env = require('./config/env')
const auth = require('./middlewares/auth.middleware')
const ApiError = require('./utils/ApiError')
const errorHandler = require('./middlewares/errorHandler')
require('./model')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', env.trustProxy)
app.set('query parser', 'simple')
app.use((req, res, next) => { req.id = randomUUID(); res.set('X-Request-ID', req.id); next() })
app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    callback(origin && !env.origins.includes(origin) ? new ApiError(403, 'Origen no permitido', 'CORS_DENIED') : null, true)
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  exposedHeaders: ['X-Request-ID'],
}))
app.use(express.json({ limit: '256kb' }))
app.get('/health', (req, res) => res.json({ status: 'up', service: 'registro-visitas-api' }))
app.get('/ready', async (req, res) => {
  const ready = mongoose.connection.readyState === 1 && await require('./utils/transaction').checkReady()
  res.status(ready ? 200 : 503).json({ ready })
})
app.get('/openapi.json', (req, res) => res.json(require('../docs/openapi')))
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next() })
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes' } } }))
app.use('/api/auth', require('./modules/auth/auth.routes'))
app.use('/api', auth)
app.use('/api/usuarios', require('./modules/usuarios/usuario.routes'))
app.use('/api/sedes', require('./modules/sedes/sede.routes'))
app.use('/api/visitantes', require('./modules/visitantes/visitante.routes'))
app.use('/api/consentimientos', require('./modules/consentimientos/consentimiento.routes'))
app.use('/api/citas', require('./modules/citas/cita.routes'))
app.use('/api/visitas', require('./modules/visitas/visita.routes'))
app.use('/api/archivos', require('./modules/archivos/archivo.routes'))
app.use('/api/auditoria', require('./modules/auditoria/auditoria.routes'))
app.use((req, res, next) => next(new ApiError(404, 'Ruta no encontrada', 'NOT_FOUND')))
app.use(errorHandler)
module.exports = app
