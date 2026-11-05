const { body, query, ref, id, page, finish } = require('../../utils/validators')
exports.upload = finish([
  ref('visitante'), ref('visita', true),
  body('tipo').isIn(['foto_rostro', 'foto_documento', 'foto_vehiculo', 'foto_placa'])
    .custom((value, { req }) => !['foto_vehiculo', 'foto_placa'].includes(value) || Boolean(req.body.visita))
    .withMessage('Las fotos de vehículo y placa deben pertenecer a una visita'),
])
exports.get = finish([id()])
exports.list = finish([...page, query('visitante').isMongoId(), query('visita').optional().isMongoId()])
