const read = require('../../utils/transaction').read
const service = require('./cita.service')
exports.create = async (req, res) => {
  const anfitrion = await require('../usuarios/receptor.service').resolve(req.datos.anfitrion, req.wmsToken, req.usuario)
  res.status(201).json(await service.create({ ...req.datos, anfitrion }, req.usuario))
}
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query, req.usuario)))
exports.getById = async (req, res) => res.json(await read(() => service.getById(req.params.id, req.usuario)))
exports.action = accion => async (req, res) => res.json(await service.action(req.params.id, accion, req.datos, req.usuario))
exports.issuePass = async (req, res) => res.json(await service.issuePass(req.params.id, req.usuario))
exports.resolvePass = async (req, res) => res.json(await read(() => service.resolvePass(req.datos.token)))
