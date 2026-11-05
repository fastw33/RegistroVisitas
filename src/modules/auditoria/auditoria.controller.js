const read = require('../../utils/transaction').read
const service = require('./auditoria.service')
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query)))
