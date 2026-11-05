const read = require('../../utils/transaction').read
const service = require('./consentimiento.service')
exports.policy = (req, res) => res.json(service.policy())
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query)))
exports.create = async (req, res) => res.status(201).json(await service.create(req.datos, req.usuario))
exports.revoke = async (req, res) => res.json(await service.revoke(req.params.id, req.datos.motivo, req.usuario))
