const read = require('../../utils/transaction').read
const service = require('./visitante.service')
exports.identity = async (req, res) => res.json({ data: await read(() => service.identity(req.query)) })
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query)))
exports.getById = async (req, res) => res.json(await read(() => service.getById(req.params.id)))
exports.create = async (req, res) => res.status(201).json(await service.create(req.datos, req.usuario))
exports.update = async (req, res) => res.json(await service.update(req.params.id, req.datos, req.usuario))
exports.saveDocument = async (req, res) => res.json(await service.saveDocument(req.params.id, req.datos, req.usuario))
exports.correct = async (req, res) => res.json(await require('./visitante.correccion.service').correct(req.params.id, req.datos, req.usuario))
exports.corrections = async (req, res) => res.json(await read(() => require('./visitante.correccion.service').history(req.params.id, req.query, req.usuario)))
exports.historial = async (req, res) => {
  const result = await read(async () => {
    await service.getById(req.params.id)
    return require('../visitas/visita.service').getAll({ ...req.query, visitante: req.params.id }, req.usuario)
  })
  res.json(result)
}
