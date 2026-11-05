const service = require('./auth.service')
const { publicUser } = require('../usuarios/usuario.service')
exports.login = async (req, res) => res.json(await service.login(req.datos))
exports.me = (req, res) => res.json(publicUser(req.usuario))
