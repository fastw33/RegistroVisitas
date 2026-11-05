const { body, query, text, ref, id, page, finish } = require('../../utils/validators')
exports.create = finish([
  ref('visitante'), body('finalidad').isIn(['registro_visitas', 'foto_rostro', 'foto_documento', 'datos_documento', 'foto_vehiculo', 'foto_placa']),
  body('aceptado').equals('true').custom(v => v === true).withMessage('Se requiere aceptación expresa del titular'),
  text('version', 30), body('medio').isIn(['casilla', 'firma', 'verbal']), text('evidencia', 1000),
])
exports.revoke = finish([id(), text('motivo', 500)])
exports.list = finish([...page, query('visitante').isMongoId()])
