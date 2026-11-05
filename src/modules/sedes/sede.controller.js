const read = require('../../utils/transaction').read
const service = require('./sede.service')
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query, req.usuario)))
exports.create = async (req, res) => res.status(201).json(await service.create(req.datos, req.usuario))
exports.update = async (req, res) => res.json(await service.update(req.params.id, req.datos, req.usuario))
