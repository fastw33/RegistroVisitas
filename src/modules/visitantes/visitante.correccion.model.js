const { Schema, model } = require('mongoose')
const { options, actor } = require('../../utils/model')
const identity = new Schema({
  tipoDocumento: { type: String, required: true }, numeroDocumento: { type: String, required: true, maxlength: 30 },
  nombres: { type: String, required: true, maxlength: 100 }, apellidos: { type: String, required: true, maxlength: 100 },
}, { _id: false, strict: 'throw' })
const schema = new Schema({
  visitante: { type: Schema.Types.ObjectId, ref: 'Visitante', required: true },
  anterior: { type: identity, required: true }, correccion: { type: identity, required: true },
  motivo: { type: String, required: true, maxlength: 500 }, registradoPor: { ...actor, required: true },
  requestKey: { type: String, required: true, select: false }, requestHash: { type: String, required: true, select: false },
}, options)
schema.index({ visitante: 1, createdAt: -1 })
schema.index({ requestKey: 1 }, { unique: true })
module.exports = model('CorreccionVisitante', schema)
