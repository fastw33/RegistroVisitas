const { Schema, model } = require('mongoose')
const { options, actor } = require('../../utils/model')
const schema = new Schema({
  visitante: { type: Schema.Types.ObjectId, ref: 'Visitante', required: true },
  visita: { type: Schema.Types.ObjectId, ref: 'Visita' },
  consentimiento: { type: Schema.Types.ObjectId, ref: 'Consentimiento', required: true },
  tipo: { type: String, enum: ['foto_rostro', 'foto_documento', 'foto_vehiculo', 'foto_placa'], required: true },
  storageKey: { type: String, required: true, select: false },
  storageBucket: { type: String, required: true, select: false },
  storageVersionId: { type: String, select: false },
  storageEstado: { type: String, enum: ['pendiente', 'disponible', 'fallido'], default: 'pendiente', required: true },
  storageEliminadoEn: Date,
  mime: { type: String, default: 'image/jpeg' }, bytes: { type: Number, required: true },
  bytesOriginales: Number, ancho: Number, alto: Number, calidad: Number,
  sha256: { type: String, required: true }, subidoPor: { ...actor, required: true },
  venceEn: { type: Date, required: true }, eliminadoEn: Date,
}, options)
schema.index({ visitante: 1, createdAt: -1 })
schema.index({ venceEn: 1 }) // Sin TTL: purge:files elimina primero el objeto S3.
module.exports = model('Archivo', schema)
