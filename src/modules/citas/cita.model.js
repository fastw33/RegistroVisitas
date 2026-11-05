const { Schema, model } = require('mongoose')
const { options, actor, eventSchema } = require('../../utils/model')
const schema = new Schema({
  visitante: { type: Schema.Types.ObjectId, ref: 'Visitante', required: true },
  sede: { type: Schema.Types.ObjectId, ref: 'Sede', required: true },
  anfitrion: { ...actor, required: true }, creadoPor: { ...actor, required: true },
  motivo: { type: String, required: true, maxlength: 500 }, area: { type: String, maxlength: 150 },
  inicio: { type: Date, required: true }, fin: { type: Date, required: true },
  estado: { type: String, enum: ['pendiente', 'aprobada', 'cancelada', 'ingresada', 'finalizada', 'no_asistio'], default: 'pendiente' },
  serieId: String,
  paseHash: { type: String, select: false }, paseEmitidoEn: Date,
  eventos: [eventSchema],
}, options)
schema.index({ sede: 1, inicio: 1, estado: 1 })
schema.index({ anfitrion: 1, inicio: 1 })
schema.index({ visitante: 1, inicio: -1 })
schema.index({ paseHash: 1 }, { unique: true, partialFilterExpression: { paseHash: { $type: 'string' } } })
module.exports = model('Cita', schema)
