const { page, query, finish } = require('../../utils/validators')
exports.list = finish([...page, query('entidad').optional().isString().isLength({ max: 50 }), query('entidadId').optional().isString().isLength({ max: 100 })])
