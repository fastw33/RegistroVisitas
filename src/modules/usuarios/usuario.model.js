const { Schema, model } = require('mongoose')
const { options } = require('../../utils/model')
const schema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 150 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
  passwordHash: { type: String, select: false },
  rol: { type: String, enum: ['admin', 'recepcion', 'anfitrion'], required: true },
  activo: { type: Boolean, default: true },
  wmsId: { type: String, maxlength: 100 },
  wmsManaged: { type: Boolean, default: false },
  soloDirectorio: { type: Boolean, default: false },
}, options)
schema.index({ wmsId: 1 }, { unique: true, partialFilterExpression: { wmsId: { $type: 'string' } } })
module.exports = model('Usuario', schema)
