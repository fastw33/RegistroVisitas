const service = require('./auditoria.service')
exports.getAll = async (req, res) => res.json(await service.getAll(req.query))
