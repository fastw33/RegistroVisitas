const { body, query, ref, text, date, id, page, finish } = require('../../utils/validators')
exports.create = finish([
  ref('visitante'), ref('sede', true), ref('anfitrion'), text('motivo', 500), text('area', 150, true), date('inicio'), date('fin'),
  body('repeticion').optional().isObject(),
  body('repeticion.cantidad').optional().isInt({ min: 2, max: 30 }).toInt(),
  body('repeticion.cadaSemanas').optional().isInt({ min: 1, max: 4 }).toInt(),
  body('repeticion').optional().custom(v => Number.isInteger(v.cantidad) && Number.isInteger(v.cadaSemanas) && Object.keys(v).every(k => ['cantidad', 'cadaSemanas'].includes(k))),
])
exports.reschedule = finish([id(), date('inicio'), date('fin')])
exports.action = finish([id(), text('motivo', 500, true)])
exports.get = finish([id()])
exports.validatePass = finish([text('token', 100).bail().matches(/^[a-f0-9]{64}$/)])
exports.list = finish([
  ...page, query('sede').optional().isMongoId(), query('visitante').optional().isMongoId(), query('anfitrion').optional().isMongoId(),
  query('estado').optional().isIn(['pendiente', 'aprobada', 'cancelada', 'ingresada', 'finalizada', 'no_asistio']),
  query('desde').optional().isISO8601({ strict: true }), query('hasta').optional().isISO8601({ strict: true }),
])
