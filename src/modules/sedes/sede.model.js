const { Schema, model } = require('mongoose')
const { options } = require('../../utils/model')
module.exports = model('Sede', new Schema({
  codigo: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 30 },
  nombre: { type: String, required: true, trim: true, maxlength: 150 },
  direccion: { type: String, maxlength: 300 },
  zonaHoraria: { type: String, default: 'America/Bogota' },
  activa: { type: Boolean, default: true },
}, options))
