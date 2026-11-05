const { Schema, model } = require('mongoose')
const { options, actor } = require('../../utils/model')
const schema = new Schema({
  visitante: { type: Schema.Types.ObjectId, ref: 'Visitante', required: true },
  finalidad: { type: String, enum: ['registro_visitas', 'foto_rostro', 'foto_documento', 'datos_documento', 'foto_vehiculo', 'foto_placa'], required: true },
  version: { type: String, required: true }, texto: { type: String, required: true },
  responsable: { type: String, required: true }, contacto: { type: String, required: true },
  medio: { type: String, enum: ['casilla', 'firma', 'verbal'], required: true },
  evidencia: { type: String, required: true, maxlength: 1000 },
  otorgadoEn: { type: Date, default: Date.now }, registradoPor: { ...actor, required: true },
  revocadoEn: Date, revocadoPor: actor, motivoRevocacion: { type: String, maxlength: 500 },
}, options)
schema.index({ visitante: 1, finalidad: 1, revocadoEn: 1 })
module.exports = model('Consentimiento', schema)
