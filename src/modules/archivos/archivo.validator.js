const { body, query, ref, id, page, finish } = require('../../utils/validators')
exports.upload = finish([ref('visitante'), ref('visita', true), body('tipo').isIn(['foto_rostro', 'foto_documento'])])
exports.get = finish([id()])
exports.list = finish([...page, query('visitante').isMongoId()])
