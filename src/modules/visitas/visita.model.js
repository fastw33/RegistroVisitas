const { Schema, model } = require('mongoose')
const { options, actor, eventSchema } = require('../../utils/model')
const schema = new Schema({
  visitante: { type: Schema.Types.ObjectId, ref: 'Visitante', required: true },
  sede: { type: Schema.Types.ObjectId, ref: 'Sede', required: true },
  anfitrion: { ...actor, required() { return !this.eventos?.some(item => item.accion === 'entrada_sin_cita') } },
  cita: { type: Schema.Types.ObjectId, ref: 'Cita' },
  motivo: { type: String, required: true, maxlength: 500 }, area: { type: String, maxlength: 150 },
  estado: { type: String, enum: ['pendiente', 'autorizada', 'dentro', 'finalizada', 'rechazada'], default: 'pendiente' },
  entradaEn: Date, salidaEn: Date, autorizadoPor: actor, entradaPor: actor, salidaPor: actor,
  identidadVerificada: { type: Boolean, default: false },
  consentimientoRegistro: { type: Schema.Types.ObjectId, ref: 'Consentimiento' },
  identidad: { tipoDocumento: String, numeroDocumento: String, nombres: String, apellidos: String, empresa: String },
  vehiculo: { type: require('./visita.vehiculo').schema, default: undefined },
  equipos: [{ _id: false, descripcion: { type: String, required: true, maxlength: 200 }, serial: { type: String, maxlength: 100 } }],
  observaciones: { type: String, maxlength: 1000 },
  eventos: [eventSchema],
  idempotencyKey: { type: String, select: false }, requestHash: { type: String, select: false },
}, options)
schema.index({ visitante: 1 }, { unique: true, partialFilterExpression: { estado: 'dentro' }, name: 'una_visita_activa_por_persona' })
schema.index({ cita: 1 }, { unique: true, partialFilterExpression: { cita: { $type: 'objectId' } } })
schema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } })
schema.index({ sede: 1, estado: 1, entradaEn: -1 })
schema.index({ visitante: 1, createdAt: -1 })
schema.index({ anfitrion: 1, createdAt: -1 })
module.exports = model('Visita', schema)
