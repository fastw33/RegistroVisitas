const { header } = require('express-validator')
const { body, query, id, ref, text, page, finish } = require('../../utils/validators')
const vehiculo = require('./visita.vehiculo').validators
const equipos = [
  body('equipos').optional().isArray({ max: 20 }),
  text('equipos.*.descripcion', 200), text('equipos.*.serial', 100, true),
  text('observaciones', 1000, true),
  ...vehiculo(),
]
const verified = body('identidadVerificada').custom(v => v === true).withMessage('Recepción debe verificar la identidad antes del ingreso')
exports.create = finish([ref('visitante'), ref('sede', true), ref('anfitrion'), text('motivo', 500), text('area', 150, true), ...equipos])
exports.directEntry = finish([
  ref('visitante'), ref('sede', true), ref('anfitrion', true), text('motivo', 500), text('area', 150, true),
  verified, header('Idempotency-Key').isUUID().withMessage('Idempotency-Key debe ser UUID'), ...equipos,
])
exports.fromAppointment = finish([
  ref('cita', true), text('token', 100, true).bail().matches(/^[a-f0-9]{64}$/),
  header('Idempotency-Key').isUUID().withMessage('Idempotency-Key debe ser UUID'),
  body('identidadVerificada').custom(v => v === true).withMessage('Recepción debe verificar la identidad')
    .custom((value, { req }) => Boolean(req.body.cita) !== Boolean(req.body.token)).withMessage('Envíe cita o token, exactamente uno'),
  ...equipos,
])
exports.entry = finish([id(), verified, ...vehiculo(true)])
exports.action = finish([id(), text('motivo', 500, true)])
exports.get = finish([id()])
exports.list = finish([
  ...page, query('visitante').optional().isMongoId(), query('sede').optional().isMongoId(), query('anfitrion').optional().isMongoId(),
  query('estado').optional().isIn(['pendiente', 'autorizada', 'dentro', 'finalizada', 'rechazada']),
  query('desde').optional().isISO8601({ strict: true }), query('hasta').optional().isISO8601({ strict: true }),
])
