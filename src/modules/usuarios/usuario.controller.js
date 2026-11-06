const read = require('../../utils/transaction').read
const service = require('./usuario.service')
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query)))
exports.anfitriones = async (req, res) => res.json(await require('./receptor.service').list(req.wmsToken))
exports.create = async (req, res) => res.status(201).json(await service.create(req.datos, req.usuario))
exports.update = async (req, res) => res.json(await service.update(req.params.id, req.datos, req.usuario))
