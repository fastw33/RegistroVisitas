const read = require('../../utils/transaction').read
const service = require('./visita.service')
exports.getAll = async (req, res) => res.json(await read(() => service.getAll(req.query, req.usuario)))
exports.getById = async (req, res) => res.json(await read(() => service.getById(req.params.id, req.usuario)))
exports.summary = async (req, res) => res.json(await read(() => service.summary(req.usuario)))
exports.create = async (req, res) => {
  const anfitrion = await require('../usuarios/receptor.service').resolve(req.datos.anfitrion, req.wmsToken, req.usuario)
  res.status(201).json(await service.create({ ...req.datos, anfitrion }, req.usuario))
}
exports.authorize = aprobar => async (req, res) => res.json(await service.authorize(req.params.id, aprobar, req.datos.motivo, req.usuario))
exports.enter = async (req, res) => res.json(await service.enter(req.params.id, req.usuario, req.datos))
exports.enterAppointment = async (req, res) => res.json(await service.enterAppointment(req.datos, req.get('Idempotency-Key'), req.usuario))
exports.enterDirect = async (req, res) => {
  const anfitrion = await require('../usuarios/receptor.service').resolve(req.datos.anfitrion, req.wmsToken, req.usuario)
  res.json(await service.enterDirect({ ...req.datos, ...(anfitrion ? { anfitrion } : {}) }, req.get('Idempotency-Key'), req.usuario))
}
exports.exit = async (req, res) => res.json(await service.exit(req.params.id, req.usuario))
