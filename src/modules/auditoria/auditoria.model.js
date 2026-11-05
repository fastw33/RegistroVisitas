const { Schema, model } = require('mongoose')
const { actor, options } = require('../../utils/model')
module.exports = model('Auditoria', new Schema({
  actor: { ...actor, required: true }, accion: { type: String, required: true },
  entidad: { type: String, required: true }, entidadId: { type: String, required: true },
  requestId: String,
}, options).index({ entidad: 1, entidadId: 1, createdAt: -1 }))
